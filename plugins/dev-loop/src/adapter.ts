import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_HEARTBEAT = 1800; // 兩次重試間預設間隔(秒)
export const MAX_SLEEP_SECONDS = 3600; // 單次睡眠上限(harness wakeup 上限)
export const OUTPUT_TAIL_CHARS = 500; // log 保留的命令輸出尾巴長度

/** 回 exit code,或 [exit code, 輸出尾巴]。兩種形狀都要支援(Python 同此)。 */
export type RunFn = (cmd: string[]) => number | [number, string];
export type SleepFn = (seconds: number) => void | Promise<void>;

/**
 * 預設睡眠。Python 是同步的 time.sleep;Node 沒有同步 sleep,所以整個
 * runWatcher 是 async。
 *
 * **這個 async 會往上傳染**:M2b-2b 的 `watch` 子命令得 await 它,而 cli.ts 的
 * main() 目前是同步回 number。屆時要嘛讓 main 回 number | Promise<number>,
 * 要嘛讓 watch 走一條獨立的進入路徑。這裡先標記,不在本 task 解。
 */
const defaultSleep: SleepFn = (seconds) => {
  // Python 的 time.sleep(-1) 拋 ValueError("sleep length must be non-negative"),
  // run_watcher 不接,watcher 在寫完第一行 log 之後就死。setTimeout(-1000) 反而
  // 大約 1 ms 就觸發,對一個永遠失敗的 exec 就是全速空轉、每毫秒往
  // watcher-log.jsonl 追加一行 —— 一個沒人看的背景程序把磁碟寫爆。
  //   實測 Python(run_watcher(["x"], heartbeat=-1, run_fn=lambda c: 1, log_path=...)):
  //     log 寫了 1 行 {"exit_code": 1, "action": "retry", "heartbeat": -1},
  //     然後 RAISED ValueError sleep length must be non-negative,run_fn 只被叫 1 次。
  // 注入 sleep_fn 時 Python 不會拋(實測 heartbeat=-5 + sleep_fn=list.append 正常
  // 收斂,slept == [-5, -5]),所以守門放在 defaultSleep 而不是 runWatcher。
  if (seconds < 0) {
    return Promise.reject(new Error("sleep length must be non-negative"));
  }
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

/**
 * 執行續跑命令,回傳 [exit code, 輸出尾巴]。detached watcher 的 stdout 無人看,
 * 輸出改捕捉進 log 供排障。
 */
export const defaultRun: RunFn = (cmd) => {
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, {
    encoding: "utf8",
    // Python 的 subprocess.run(capture_output=True) 對輸出量沒有上限;Node 預設
    // 1 MiB,超過就整個 spawnSync 變成 error.code === "ENOBUFS"。實測:
    //   PY _default_run(寫 2 MiB) -> code=0, tail_len=500
    //   TS(修前)                  -> throw "spawnSync ... ENOBUFS"
    // 而下面的 rethrow 會把它一路丟出 runWatcher —— detached watcher 第一次嘗試
    // 就死,watcher-log.jsonl 一行都沒有。ENOBUFS 正是那個 rethrow 過度捕捉的東西。
    maxBuffer: Infinity,
  });
  // When the executable does not exist at all, spawnSync never starts a
  // process: `status` is null and `error` carries the ENOENT. Python's
  // subprocess.run() in the same situation raises FileNotFoundError, which
  // run_watcher does not catch — it propagates and the watcher dies. Rethrow
  // here to match: silently folding this into [1, ""] would make the
  // watcher retry forever against a command that can never succeed, and the
  // log — the only window into a detached process nobody watches — would
  // show nothing but empty-output retries with no trace of the real cause.
  if (proc.error) {
    throw proc.error;
  }
  // Python 的 [-500:] 數的是 **code point**;JS 的 .slice 數的是 UTF-16 unit,
  // astral 字元(emoji)一個算兩個。實測寫 "A"*100 + "🎉"*300(400 code points):
  //   PY  -> tail 長 400,開頭是 'AAA'(整串保留)
  //   TS(修前) -> tail 長 500 但只有 250 個 code point,"A" 前綴整段掉光,
  //               而且邊界落在 surrogate pair 中間,JSON.stringify 會把落單的
  //               \ud83c 寫進共用的 watcher-log.jsonl。
  // 單位是 code point 而非 grapheme cluster:Python 的 str 索引就是 code point。
  const tail = [...((proc.stdout ?? "") + (proc.stderr ?? ""))]
    .slice(-OUTPUT_TAIL_CHARS).join("");
  return [proc.status ?? 1, tail];
};

/** best-effort 追加一行 JSON 到 watcher log;失敗靜默(不得反噬 watcher)。 */
function appendLog(logPath: string | undefined, entry: Record<string, unknown>): void {
  if (!logPath) {
    return;
  }
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // 靜默:log 是觀測資料,壞了不該讓 watcher 停擺
  }
}

/**
 * 無 reset 時間 · 週期重試的續跑 watcher(resume-trigger 規格)。
 *
 * 反覆執行 execCommand:回 0 即視為 loop 已被重新推進,停止並回 0;回非 0
 * 視為仍被限流,睡一個 heartbeat 後重試。heartbeat 夾到 MAX_SLEEP_SECONDS
 * (harness wakeup 上限),**log 記的是夾過的值**。
 */
export async function runWatcher(
  execCommand: string[],
  opts: { heartbeat?: number; sleepFn?: SleepFn; runFn?: RunFn; logPath?: string } = {},
): Promise<number> {
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const runFn = opts.runFn ?? defaultRun;
  const interval = Math.min(opts.heartbeat ?? DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS);
  for (;;) {
    const result = runFn(execCommand);
    const [code, tail] = Array.isArray(result) ? result : [result, ""];
    appendLog(opts.logPath, {
      ts: new Date().toISOString(),
      exit_code: code,
      output_tail: tail,
      action: code === 0 ? "stop" : "retry",
      heartbeat: interval,
    });
    if (code === 0) {
      return 0;
    }
    await sleepFn(interval);
  }
}

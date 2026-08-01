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
const defaultSleep: SleepFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * 執行續跑命令,回傳 [exit code, 輸出尾巴]。detached watcher 的 stdout 無人看,
 * 輸出改捕捉進 log 供排障。
 */
const defaultRun: RunFn = (cmd) => {
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, { encoding: "utf8" });
  const tail = ((proc.stdout ?? "") + (proc.stderr ?? "")).slice(-OUTPUT_TAIL_CHARS);
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

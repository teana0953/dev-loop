import { spawnSync } from "node:child_process";

export interface GateResult {
  passed: boolean;
  failed_command: string[] | null;
  output: string;
}

export interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 可注入以便測試。真實實作對應 Python 的 subprocess.run(capture_output, timeout)。 */
export type CommandRunner = (cmd: string[], cwd: string | undefined, timeout: number) => RunOutcome;

export const defaultRunner: CommandRunner = (cmd, cwd, timeout) => {
  // timeout <= 0:Python 的 subprocess.run(timeout=0) 立刻 TimeoutExpired,負數
  // 亦然;Node 的 spawnSync 把 0 當「不設限」、負數直接 RangeError。`--timeout`
  // 是 argparse type=int 沒有下界,0 與負數都是合法輸入,所以這裡必須在碰到
  // spawnSync 之前就短路。
  //   實測 Python(devloop.gate.run_gate([["python3","-c","time.sleep(2)"]], timeout=t)):
  //     t=0  -> passed=False, output='timeout after 0s',  0.00s
  //     t=-1 -> passed=False, output='timeout after -1s', 0.00s
  //   實測 TS(修前):t=0 -> passed=True 且命令跑滿 2.01s;t=-1 -> RangeError。
  //
  // 但「直接短路、根本不 spawn」也不對:Python 的 subprocess.run(timeout=0) 是
  // 先 fork/exec 再殺,所以執行檔不存在時仍然是 FileNotFoundError,而不是逾時。
  //   實測 run_gate([["definitely-not-a-cmd-xyz"]], timeout=0)
  //     -> FileNotFoundError [Errno 2]
  // 所以照樣 spawn(用 1 ms 讓它立刻被殺),spawn 層級的失敗照常往外拋,只是
  // 不管實際上是不是 ETIMEDOUT,一律回報成逾時。
  const nonPositiveTimeout = timeout <= 0;
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, {
    cwd, encoding: "utf8", timeout: nonPositiveTimeout ? 1 : timeout * 1000,
    // Python 的 subprocess.run 對輸出量沒有上限;Node 預設 1 MiB,超過就把
    // 整個 spawnSync 變成 error.code === "ENOBUFS"。實測寫 2 MiB 並 exit 1:
    //   PY run_gate -> passed=False, len(output)=2097152
    //   TS runGate  -> throw "spawnSync ... ENOBUFS"(邊界:1048576 過、1048577 炸)
    // `pytest -v` / `npm test` 本身就常常超過 1 MiB,這是常態不是邊角。
    maxBuffer: Infinity,
  });
  // spawnSync 逾時會殺掉行程並把 error.code 設成 ETIMEDOUT;Python 那邊是
  // TimeoutExpired 例外。兩邊都必須表現成「該命令失敗」而非整個 gate 崩潰。
  const timedOut =
    nonPositiveTimeout || (proc.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const spawnFailed =
    proc.error && (proc.error as NodeJS.ErrnoException).code !== "ETIMEDOUT";
  if (spawnFailed) {
    throw proc.error;
  }
  return {
    code: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", timedOut,
  };
};

/**
 * 依序執行 commands;任一失敗即短路回報(規格 4)。
 *
 * 每個命令最多執行 timeout 秒;逾時視為該命令失敗,避免 hang 住的 gate 命令
 * 永久阻塞 loop。
 *
 * 注意空清單回 passed=true——模組層就是這個語意。封死「空清單假綠」是 CLI
 * 層的責任(Python 的 _resolve_gate_cmds 皆空時 exit 2),不要在這裡多加守門,
 * 那會讓兩個引擎的模組語意分家。
 */
export function runGate(
  commands: string[][],
  opts: { cwd?: string; timeout?: number; runner?: CommandRunner } = {},
): GateResult {
  const timeout = opts.timeout ?? 600;
  const run = opts.runner ?? defaultRunner;
  for (const cmd of commands) {
    const r = run(cmd, opts.cwd, timeout);
    if (r.timedOut) {
      return { passed: false, failed_command: cmd, output: `timeout after ${timeout}s` };
    }
    if (r.code !== 0) {
      return { passed: false, failed_command: cmd, output: r.stdout + r.stderr };
    }
  }
  return { passed: true, failed_command: null, output: "" };
}

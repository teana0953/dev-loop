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
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, {
    cwd, encoding: "utf8", timeout: timeout * 1000,
  });
  // spawnSync 逾時會殺掉行程並把 error.code 設成 ETIMEDOUT;Python 那邊是
  // TimeoutExpired 例外。兩邊都必須表現成「該命令失敗」而非整個 gate 崩潰。
  const timedOut = (proc.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (proc.error && !timedOut) {
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

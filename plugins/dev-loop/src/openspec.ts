import { spawnSync } from "node:child_process";

export interface OpenSpecResult {
  ok: boolean;
  command: string[];
  output: string;
}

export type Runner = (cmd: string[]) => [number, string];

/**
 * Real subprocess runner. Mirrors Python's `_default_runner`:
 * `subprocess.run(cmd, capture_output=True, text=True)` then
 * `proc.returncode, (proc.stdout or "") + (proc.stderr or "")`.
 */
export const defaultRunner: Runner = (cmd) => {
  const [command, ...args] = cmd;
  const proc = spawnSync(command as string, args, { encoding: "utf8" });
  // When the executable does not exist at all, spawnSync never starts a
  // process: `status` is null and `error` carries the ENOENT. Python's
  // subprocess.run() in the same situation raises FileNotFoundError,
  // which devloop/openspec.py does not catch — it propagates to the
  // caller. Rethrow here to match: silently returning a non-zero code
  // would mask "command not found" as an ordinary CLI failure.
  if (proc.error) {
    throw proc.error;
  }
  const code = proc.status ?? 1;
  return [code, (proc.stdout ?? "") + (proc.stderr ?? "")];
};

function run(cmd: string[], runner: Runner = defaultRunner): OpenSpecResult {
  const [code, output] = runner(cmd);
  return { ok: code === 0, command: cmd, output };
}

/** propose 後、人工關卡前用,確認 OpenSpec change 結構合法(規格 §2、§11)。 */
export function validateChange(changeId: string, runner?: Runner): OpenSpecResult {
  return run(["openspec", "validate", changeId, "--strict", "--no-interactive"], runner);
}

/** merge 階段歸檔已完成的 change,同步 main specs(規格 §4 階段 8)。 */
export function archiveChange(changeId: string, runner?: Runner): OpenSpecResult {
  return run(["openspec", "archive", changeId, "--yes"], runner);
}

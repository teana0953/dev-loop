import { describe, it, expect } from "vitest";
import { runGate, defaultRunner, type CommandRunner } from "./gate.js";

describe("runGate", () => {
  it("passes vacuously with no commands", () => {
    const r = runGate([]);
    expect(r).toEqual({ passed: true, failed_command: null, output: "" });
  });

  it("all commands passing succeeds", () => {
    const runner: CommandRunner = () => ({ code: 0, stdout: "", stderr: "", timedOut: false });
    const r = runGate([["a"], ["b"]], { runner });
    expect(r).toEqual({ passed: true, failed_command: null, output: "" });
  });

  it("short-circuits on the first failure and never calls the runner again", () => {
    let calls = 0;
    const runner: CommandRunner = () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("runner called more times than the short-circuit should allow");
      }
      return { code: 1, stdout: "out\n", stderr: "err\n", timedOut: false };
    };
    const r = runGate([["a"], ["b"]], { runner });
    expect(r).toEqual({ passed: false, failed_command: ["a"], output: "out\nerr\n" });
    expect(calls).toBe(1);
  });

  it("orders stdout before stderr in the reported output", () => {
    const runner: CommandRunner = () => ({ code: 1, stdout: "S", stderr: "E", timedOut: false });
    const r = runGate([["a"]], { runner });
    expect(r.output).toBe("SE");
  });

  it("treats a timeout as a failure of that command, embedding the timeout value", () => {
    const runner: CommandRunner = () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    const r = runGate([["slow"]], { runner, timeout: 1 });
    expect(r).toEqual({ passed: false, failed_command: ["slow"], output: "timeout after 1s" });
  });

  it("real subprocess: captures stdout and stderr on failure via defaultRunner", () => {
    const r = runGate([["sh", "-c", "echo boom >&2; exit 1"]]);
    expect(r.passed).toBe(false);
    expect(r.output).toContain("boom");
  });

  it("real subprocess: a hung command is reported as a timeout, not a thrown exception", () => {
    const r = runGate([["sh", "-c", "sleep 5"]], { timeout: 1 });
    expect(r.passed).toBe(false);
    expect(r.failed_command).toEqual(["sh", "-c", "sleep 5"]);
    expect(r.output.toLowerCase()).toContain("timeout");
  });

  it("real subprocess: more than Node's 1 MiB spawnSync default is captured whole, not ENOBUFS", () => {
    // Python 的 subprocess.run 沒有輸出上限;Node 的 spawnSync 預設 maxBuffer
    // 1 MiB,超過就整個變成 error.code === "ENOBUFS"。實測同一條命令
    // (寫 2 MiB 到 stdout 後 exit 1):
    //   PY run_gate -> passed=False, len(output)=2097152
    //   TS(修前)   -> throw Error "spawnSync ... ENOBUFS"
    // 邊界:1048576 bytes 過,1048577 炸。`pytest -v` / `npm test` 本身就常常
    // 超過,所以這裡用真的子行程,不用假 runner。
    const size = 2 * 1024 * 1024;
    const r = runGate([[
      process.execPath, "-e",
      `process.stdout.write("x".repeat(${size})); process.exitCode = 1;`,
    ]]);
    expect(r.passed).toBe(false);
    expect(r.output.length).toBe(size);
  });

  it("real subprocess: exactly one byte past the old 1 MiB ceiling still survives", () => {
    const size = 1048577;
    const r = runGate([[
      process.execPath, "-e",
      `process.stdout.write("x".repeat(${size})); process.exitCode = 1;`,
    ]]);
    expect(r.passed).toBe(false);
    expect(r.output.length).toBe(size);
  });

  // --- timeout <= 0 ---
  //
  // `--timeout` 是 argparse type=int 且沒有下界(devloop/cli.py),0 與負數都是
  // 合法輸入。Node 把 timeout: 0 當「不設限」、負數直接 RangeError,兩者都跟
  // Python 相反。實測 Python:
  //   run_gate([["python3","-c","time.sleep(2)"]], timeout=0)
  //     -> passed=False, failed_command=[...], output='timeout after 0s', 0.00s
  //   timeout=-1 -> output='timeout after -1s';timeout=-5 -> 'timeout after -5s'
  // 實測 TS(修前):timeout=0 -> passed=True / output='' / 命令跑滿 2.01s;
  //                 timeout=-1 -> RangeError ERR_OUT_OF_RANGE。

  it("real subprocess: timeout 0 expires immediately instead of meaning 'no timeout'", () => {
    const started = Date.now();
    const r = runGate([["sh", "-c", "sleep 2"]], { timeout: 0 });
    expect(r).toEqual({
      passed: false, failed_command: ["sh", "-c", "sleep 2"], output: "timeout after 0s",
    });
    // 命令不該真的跑完
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("real subprocess: a negative timeout expires immediately and keeps the sign in the message", () => {
    const r = runGate([["sh", "-c", "sleep 2"]], { timeout: -1 });
    expect(r).toEqual({
      passed: false, failed_command: ["sh", "-c", "sleep 2"], output: "timeout after -1s",
    });
    expect(runGate([["sh", "-c", "sleep 2"]], { timeout: -5 }).output).toBe("timeout after -5s");
  });

  it("timeout 0 still short-circuits: the second command never runs", () => {
    let calls = 0;
    const commands = [["sh", "-c", "true"], ["sh", "-c", "true"]];
    const runner: CommandRunner = (cmd, cwd, timeout) => {
      calls += 1;
      return defaultRunner(cmd, cwd, timeout);
    };
    const r = runGate(commands, { runner, timeout: 0 });
    expect(r.failed_command).toEqual(commands[0]);
    expect(calls).toBe(1);
  });
});

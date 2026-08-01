import { describe, it, expect } from "vitest";
import { runGate, type CommandRunner } from "./gate.js";

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
});

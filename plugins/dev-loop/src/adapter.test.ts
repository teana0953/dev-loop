import { describe, it, expect } from "vitest";
import { DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS, OUTPUT_TAIL_CHARS, runWatcher, defaultRun } from "./adapter.js";

describe("adapter constants", () => {
  it("matches the Python values", () => {
    expect(DEFAULT_HEARTBEAT).toBe(1800);
    expect(MAX_SLEEP_SECONDS).toBe(3600);
    expect(OUTPUT_TAIL_CHARS).toBe(500);
  });
});

describe("runWatcher log failures", () => {
  it("does not stop the watcher when the log cannot be written", () => {
    // log 是觀測資料。寫不進去(權限、磁碟滿)不得反噬 watcher——
    // 這裡把 logPath 指向一個不可能建立的路徑。
    const impossible = "/dev/null/nope/w.jsonl";
    return expect(runWatcher(["x"], {
      heartbeat: 1, runFn: () => 0, logPath: impossible,
    })).resolves.toBe(0);
  });
});

describe("runWatcher sleep", () => {
  it("awaits an async sleepFn before retrying", async () => {
    const order: string[] = [];
    let n = 0;
    await runWatcher(["x"], {
      heartbeat: 1,
      runFn: () => { order.push("run"); return n++ === 0 ? 1 : 0; },
      sleepFn: async () => { order.push("sleep-start"); await Promise.resolve(); order.push("sleep-end"); },
    });
    expect(order).toEqual(["run", "sleep-start", "sleep-end", "run"]);
  });
});

describe("defaultRun spawn-level failures", () => {
  // Python's subprocess.run() raises FileNotFoundError when the executable
  // cannot be spawned at all, and run_watcher does not catch it — the
  // watcher process dies. spawnSync does not throw on its own: it returns
  // status: null with the cause on proc.error. Verified against real
  // Python: subprocess.run(["/nonexistent/binary-xyz"]) raises
  // FileNotFoundError [Errno 2]. defaultRun must rethrow to match, not fold
  // this into an ordinary [1, ""] that would make the watcher retry forever
  // against a command that can never succeed.
  it("rethrows when the executable cannot be spawned, instead of returning [1, \"\"]", () => {
    expect(() => defaultRun(["/nonexistent/binary-xyz-devloop-test"])).toThrow();
  });

  it("propagates that failure out of runWatcher rather than logging a silent retry", async () => {
    await expect(
      runWatcher(["/nonexistent/binary-xyz-devloop-test"], { heartbeat: 1 }),
    ).rejects.toThrow();
  });
});

describe("defaultRun output tail", () => {
  // Every fixture case uses output far shorter than OUTPUT_TAIL_CHARS, so
  // nothing there distinguishes "keep the last N" from "keep the first N".
  // Verified against real Python: _default_run(["python3", "-c",
  // "import sys; sys.stdout.write('a'*600 + 'b'*600)"]) returns a tail of
  // length 500 equal to "b" * 500 — the *last* 500 characters of the 1200
  // written, not the first 500 (which would be "a"*500).
  it("keeps the tail, not the head, and the boundary length is exact", () => {
    const [code, tail] = defaultRun([
      process.execPath,
      "-e",
      "process.stdout.write('a'.repeat(600) + 'b'.repeat(600))",
    ]);
    expect(code).toBe(0);
    expect(tail.length).toBe(OUTPUT_TAIL_CHARS);
    expect(tail).toBe("b".repeat(OUTPUT_TAIL_CHARS));
  });
});

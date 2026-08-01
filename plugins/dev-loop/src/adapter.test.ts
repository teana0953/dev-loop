import { describe, it, expect } from "vitest";
import { DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS, OUTPUT_TAIL_CHARS, runWatcher } from "./adapter.js";

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

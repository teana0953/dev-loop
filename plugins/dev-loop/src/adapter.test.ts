import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // Python 的 [-500:] 數 code point;JS 的 .slice 數 UTF-16 unit,astral 字元
  // (emoji)一個算兩個。實測 Python 的 _default_run:
  //   輸出 "A"*100 + "🎉"*300(400 code points)-> tail 長 400、開頭 'AAA'
  //   輸出 "🎉"*400                            -> tail 長 400(全留)
  // 實測 TS(修前):前者 tail 只剩最後 250 個 emoji,"A" 前綴整段掉光,而且
  // 切點落在 surrogate pair 中間,JSON.stringify 會把落單的 \ud83c 寫進
  // 共用的 watcher-log.jsonl。
  it("counts code points, not UTF-16 units, when the output contains astral characters", () => {
    const [code, tail] = defaultRun([
      process.execPath, "-e",
      "process.stdout.write('A'.repeat(100) + '\\u{1F389}'.repeat(300))",
    ]);
    expect(code).toBe(0);
    expect([...tail].length).toBe(400);
    expect(tail.startsWith("AAA")).toBe(true);
    expect(tail).toBe("A".repeat(100) + "🎉".repeat(300));
  });

  it("never leaves a lone surrogate at the boundary", () => {
    // 600 個 emoji = 1200 UTF-16 unit;截 500 個 code point 應剛好 500 個 emoji。
    const [, tail] = defaultRun([
      process.execPath, "-e", "process.stdout.write('\\u{1F389}'.repeat(600))",
    ]);
    expect([...tail].length).toBe(OUTPUT_TAIL_CHARS);
    expect(tail).toBe("🎉".repeat(OUTPUT_TAIL_CHARS));
    // 落單的 surrogate 會被 JSON.stringify 寫成 \udXXX escape
    expect(JSON.stringify(tail)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("captures more than Node's 1 MiB spawnSync default instead of throwing ENOBUFS", () => {
    // 實測 Python 的 _default_run(寫 2 MiB)-> code=0, tail_len=500。
    // 實測 TS(修前)-> spawnSync 回 error.code === "ENOBUFS",而 defaultRun 的
    // rethrow 會把它一路丟出 runWatcher:detached watcher 第一次嘗試就死,
    // watcher-log.jsonl 一行都沒有。
    const [code, tail] = defaultRun([
      process.execPath, "-e", `process.stdout.write("x".repeat(${2 * 1024 * 1024}))`,
    ]);
    expect(code).toBe(0);
    expect(tail).toBe("x".repeat(OUTPUT_TAIL_CHARS));
  });

  it("a >1 MiB producer does not kill the watcher on its first attempt", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "adapter-buf-"));
    const logPath = join(logDir, "w.jsonl");
    await expect(runWatcher([
      process.execPath, "-e", `process.stdout.write("x".repeat(${2 * 1024 * 1024}))`,
    ], { heartbeat: 0, logPath })).resolves.toBe(0);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0]!) as { action: string }).action).toBe("stop");
  });
});

describe("runWatcher with a negative heartbeat", () => {
  // Python 的 time.sleep(-1) 拋 ValueError("sleep length must be non-negative"),
  // run_watcher 不接 —— 實測 run_watcher(["x"], heartbeat=-1, run_fn=…回 1) 的
  // 結果是:log 寫了 1 行(heartbeat: -1、action: retry),然後
  //   RAISED ValueError sleep length must be non-negative
  // 且 run_fn 只被呼叫 1 次。
  //
  // TS(修前)Math.min(-1, 3600) === -1,setTimeout(-1000) 約 1 ms 就觸發 →
  // 對一個持續失敗的 exec 全速空轉,每毫秒往 watcher-log.jsonl 追加一行,
  // 一個沒人看的背景程序把磁碟寫爆。
  it("throws after the first attempt instead of hot-looping", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "adapter-neg-"));
    const logPath = join(logDir, "w.jsonl");
    let calls = 0;
    await expect(runWatcher(["x"], {
      heartbeat: -1,
      runFn: () => { calls += 1; return 1; },
      logPath,
    })).rejects.toThrow("sleep length must be non-negative");
    expect(calls, "只該嘗試一次").toBe(1);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ exit_code: 1, action: "retry", heartbeat: -1 });
  });

  it("does not throw when the run succeeds first time (sleep is never reached)", async () => {
    await expect(runWatcher(["x"], { heartbeat: -1, runFn: () => 0 })).resolves.toBe(0);
  });

  it("an injected sleepFn keeps control, matching Python's injected sleep_fn", async () => {
    // 實測 Python:run_watcher(["x"], heartbeat=-5, run_fn=…, sleep_fn=list.append)
    // 正常收斂回 0,slept == [-5, -5] —— 例外來自 time.sleep,不是 run_watcher。
    const slept: number[] = [];
    let n = 0;
    const r = await runWatcher(["x"], {
      heartbeat: -5,
      runFn: () => (++n > 2 ? 0 : 1),
      sleepFn: (s) => { slept.push(s); },
    });
    expect(r).toBe(0);
    expect(slept).toEqual([-5, -5]);
  });

  it("heartbeat 0 is still allowed (Python's time.sleep(0) does not raise)", async () => {
    let n = 0;
    await expect(runWatcher(["x"], {
      heartbeat: 0, runFn: () => (++n > 1 ? 0 : 1),
    })).resolves.toBe(0);
  });
});

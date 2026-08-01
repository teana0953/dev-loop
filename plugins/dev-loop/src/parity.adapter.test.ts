import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import { runWatcher, type RunFn } from "./adapter.js";

const SECTIONS = ["runWatcher", "noLogPath"];
const TS_PREFIX_LEN = "2026-08-01T00:00:00".length;

async function drive(c: ParityCase, logPath: string | undefined) {
  const pending = [...(c.outcomes as unknown[])];
  const slept: number[] = [];
  const runFn: RunFn = (cmd) => {
    expect(cmd, "exec_command 沒有原樣傳給 runFn").toEqual(c.exec_command);
    expect(pending.length, "runFn 被呼叫的次數超過 fixture 提供的 outcomes").toBeGreaterThan(0);
    const o = pending.shift();
    return (Array.isArray(o) ? (o as [number, string]) : (o as number));
  };
  const returned = await runWatcher(c.exec_command as string[], {
    heartbeat: c.heartbeat as number,
    sleepFn: (s) => { slept.push(s); },
    runFn,
    logPath,
  });
  const entries: Record<string, unknown>[] = [];
  if (logPath !== undefined && existsSync(logPath)) {
    for (const ln of readFileSync(logPath, "utf-8").split("\n")) {
      if (ln.trim()) entries.push(JSON.parse(ln) as Record<string, unknown>);
    }
  }
  return { returned, slept, entries };
}

describe("parity: runWatcher", () => {
  for (const c of parityCases("adapter", "runWatcher", SECTIONS)) {
    it(c.name, async () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "runWatcher cases do not raise").toBe(false);
      const logPath = join(mkdtempSync(join(tmpdir(), "adapter-")), "w.jsonl");
      const { returned, slept, entries } = await drive(c, logPath);
      for (const e of entries) {
        expect(String(e.ts ?? "").length, c.name).toBeGreaterThanOrEqual(TS_PREFIX_LEN);
        delete e.ts;
      }
      expectSubset({ returned, slept, log: entries }, want!, c.name);
    });
  }
});

describe("parity: runWatcher without a log path", () => {
  for (const c of parityCases("adapter", "noLogPath", SECTIONS)) {
    it(c.name, async () => {
      const { expect: want } = resolveExpectation(c);
      const dir = mkdtempSync(join(tmpdir(), "adapter-"));
      const { returned, slept } = await drive(c, undefined);
      expectSubset({ returned, slept }, want!, c.name);
      expect(readdirSync(dir), "logPath 為空時不該寫任何檔案").toEqual([]);
    });
  }
});

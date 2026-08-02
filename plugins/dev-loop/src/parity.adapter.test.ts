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

/**
 * 這一段本來只做「開一個 temp dir、**不**把它交給 runWatcher、然後斷言它是空的」
 * ——那對任何實作都成立,包括一個把 log 寫死到別處的實作,也包括一個 appendLog
 * 什麼都不做的實作。改成先跑一次「有 logPath」的,釘住檔案確實出現在**指定的
 * 那個路徑**且行數等於嘗試次數(這條就把「寫死路徑」與「根本沒寫」兩種實作
 * 打掉),再跑一次「無 logPath」的,釘住同一個檔案 byte 不變、目錄裡也沒多出
 * 別的檔案。
 */
describe("parity: runWatcher without a log path", () => {
  for (const c of parityCases("adapter", "noLogPath", SECTIONS)) {
    it(c.name, async () => {
      const { expect: want } = resolveExpectation(c);
      const dir = mkdtempSync(join(tmpdir(), "adapter-"));
      const logPath = join(dir, "w.jsonl");

      const logged = await drive(c, logPath);
      const linesAfterLogged = logged.entries.length;
      const bytesAfterLogged = readFileSync(logPath);

      const unlogged = await drive(c, undefined);
      expect(unlogged.returned, "有無 logPath 不該改變回傳值").toBe(logged.returned);
      expect(unlogged.slept, "有無 logPath 不該改變睡眠序列").toEqual(logged.slept);
      const linesAfterUnlogged = readFileSync(logPath, "utf-8")
        .split("\n").filter((l) => l.trim()).length;
      expect(readFileSync(logPath).equals(bytesAfterLogged), "無 logPath 的那次不得動到檔案").toBe(true);

      expectSubset({
        returned: unlogged.returned,
        slept: unlogged.slept,
        lines_after_logged_run: linesAfterLogged,
        lines_after_unlogged_run: linesAfterUnlogged,
        files_in_dir_after: readdirSync(dir).sort(),
      }, want!, c.name);
    });
  }
});

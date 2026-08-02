import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { watcherState, lastWatcherAttempt } from "./watcher.js";

const SECTIONS = ["watcherState", "lastWatcherAttempt"];

/** 真的產生一個已被收屍的 pid——比猜一個大數字可靠。 */
function reapedPid(): number {
  const proc = spawnSync("/usr/bin/true");
  return proc.pid as number;
}

/** pid 值無法寫死在 fixture 裡,兩側各自把 <SELF>/<DEAD> 換成實際值。 */
function subst(v: unknown, self: number, dead: number): unknown {
  if (v === "<SELF>") return self;
  if (v === "<DEAD>") return dead;
  if (typeof v === "string") {
    return v.split("<SELF>").join(String(self)).split("<DEAD>").join(String(dead));
  }
  return v;
}

describe("parity: watcherState", () => {
  for (const c of parityCases("watcher", "watcherState", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "watcherState never raises for these inputs").toBe(false);
      const self = process.pid;
      const dead = reapedPid();
      const dir = mkdtempSync(join(tmpdir(), "parity-watcher-"));
      const cp = join(dir, "cp.json");
      writeFileSync(cp, "{}", "utf-8");
      const pidFile = (c.input as Record<string, unknown>).pid_file;
      if (pidFile !== null) {
        // 檔案內容一律轉字串:整個值就是 "<SELF>" 時 subst 回的是 number。
        writeFileSync(join(dir, "watcher.pid"), String(subst(pidFile, self, dead)), "utf-8");
      }
      const [state, pid] = watcherState(cp);
      const expected = Object.fromEntries(
        Object.entries(want!).map(([k, v]) => [k, subst(v, self, dead)]));
      expectSubset({ state, pid }, expected, c.name);
    });
  }
});

describe("parity: lastWatcherAttempt", () => {
  for (const c of parityCases("watcher", "lastWatcherAttempt", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "lastWatcherAttempt never raises for these inputs").toBe(false);
      const dir = mkdtempSync(join(tmpdir(), "parity-watcher-"));
      const cp = join(dir, "cp.json");
      writeFileSync(cp, "{}", "utf-8");
      const log = (c.input as Record<string, unknown>).log;
      if (log !== null) {
        writeFileSync(join(dir, "watcher-log.jsonl"), log as string, "utf-8");
      }
      expectSubset({ value: lastWatcherAttempt(cp) }, want!, c.name);
    });
  }
});

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { ensureArmed, watcherState, lastWatcherAttempt } from "./watcher.js";

const SECTIONS = ["ensureArmedWithoutSpawning", "watcherState", "lastWatcherAttempt"];

/** 真的產生一個已被收屍的 pid——比猜一個大數字可靠。 */
function reapedPid(): number {
  const proc = spawnSync("/usr/bin/true");
  return proc.pid as number;
}

/**
 * 「這個呼叫必須拋錯」的斷言。**不要**直接用 `expect(fn).toThrow()`。
 *
 * 裸的 toThrow() 連「測試自己壞掉」都算通過:呼叫一個不存在的名字會拋
 * ReferenceError,那也是一個 throw。實測把這裡的 `ensureArmed` 改成
 * `ensureArmedTYPO`,六條 reject case 會全綠——等於什麼都沒測。
 * watcher.test.ts 有一份同樣的 helper(測試檔之間不能互相 import,
 * 一 import 就會把對方的 describe 也跑一遍)。
 */
function expectThrows(fn: () => unknown, label: string): unknown {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `${label}: 必須拋錯`).toBeInstanceOf(Error);
  expect(caught, `${label}: 拋的是 ReferenceError —— 測試自己壞了,不是受測行為`)
    .not.toBeInstanceOf(ReferenceError);
  return caught;
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

/**
 * ensureArmed 只有「skipped」與「拒絕」兩條路徑進得了 fixture。
 *
 * 第三條路徑(接受一個字串命令)會真的 spawn 一個背景行程,fixture harness
 * 沒有對應的收尾機制,所以那半邊留在 watcher.test.ts 的單元測試裡。這個
 * section 蒐集的是「不會 spawn 的那些輸入」——正因為不會 spawn,才守得住
 *「拒絕的路徑一定不留下行程」:每個 case 都額外斷言 watcher.pid 不存在。
 */
describe("parity: ensureArmed without spawning", () => {
  for (const c of parityCases("watcher", "ensureArmedWithoutSpawning", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      const dir = mkdtempSync(join(tmpdir(), "parity-watcher-"));
      const cp = join(dir, "cp.json");
      writeFileSync(cp, JSON.stringify({
        phase: "apply", change_id: "c", branch: "b",
        resume_exec: (c.input as Record<string, unknown>).resume_exec,
      }), "utf-8");
      if (throws) {
        expectThrows(() => ensureArmed(cp, { heartbeat: 1 }), c.name);
      } else {
        const [status, info] = ensureArmed(cp, { heartbeat: 1 });
        expectSubset({ status, info }, want!, c.name);
      }
      expect(
        existsSync(join(dir, "watcher.pid")),
        `${c.name}: 不得寫下 pid 檔(也就是不得 spawn)`,
      ).toBe(false);
    });
  }
});

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

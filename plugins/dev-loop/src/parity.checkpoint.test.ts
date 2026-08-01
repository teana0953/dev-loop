import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint.js";

const SECTIONS = ["loadCheckpoint", "roundTrip", "structKeys"];

// 兩引擎共通的時間戳保證(小數位與時區後綴的文法差異是已知延後項,不在此斷言)
const TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "checkpoint.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

describe("parity: loadCheckpoint", () => {
  for (const c of parityCases("checkpoint", "loadCheckpoint", SECTIONS)) {
    it(c.name, () => {
      const path = write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadCheckpoint(path)).toThrow();
        return;
      }
      expectSubset(loadCheckpoint(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

describe("parity: checkpoint round trip", () => {
  for (const c of parityCases("checkpoint", "roundTrip", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "roundTrip cases must not expect a throw").toBe(false);
      const cp = loadCheckpoint(write(c.input));
      // dst 刻意放在一層還不存在的子目錄下,順便驗 saveCheckpoint 會自己建目錄
      const dst = join(mkdtempSync(join(tmpdir(), "parity-")), "nested", "reloaded.json");
      saveCheckpoint(cp, dst);
      const reloaded = loadCheckpoint(dst);
      expectSubset(reloaded as unknown as Record<string, unknown>, want!, c.name);
      // save 一定重寫 updated_at;文法差異是延後項,只斷言兩邊共通的部分
      expect(TS_PREFIX.test(reloaded.updated_at), `${c.name}: updated_at = ${reloaded.updated_at}`).toBe(true);
    });
  }
});

describe("parity: checkpoint structKeys", () => {
  // Checkpoint 是雙軌交接的磁碟契約——這裡鎖住完整鍵集合,而不只是子集,
  // 因為一個只加在單一引擎的欄位,在其餘全是子集比對的測試裡完全隱形。
  for (const c of parityCases("checkpoint", "structKeys", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "structKeys cases must not expect a throw").toBe(false);
      const cp = loadCheckpoint(write(c.input));
      const actual = { keys: Object.keys(cp).sort() };
      expectSubset(actual as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

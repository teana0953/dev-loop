import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { loadChangeMeta, isSerial } from "./changemeta.js";

const SECTIONS = ["loadChangeMeta", "isSerial"];

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "change-meta.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

describe("parity: loadChangeMeta", () => {
  for (const c of parityCases("changemeta", "loadChangeMeta", SECTIONS)) {
    it(c.name, () => {
      const path = c.file_absent === true
        ? join(mkdtempSync(join(tmpdir(), "parity-")), "absent.json")
        : write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadChangeMeta(path)).toThrow();
        return;
      }
      expectSubset(loadChangeMeta(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

describe("parity: isSerial", () => {
  for (const c of parityCases("changemeta", "isSerial", SECTIONS)) {
    it(c.name, () => {
      const path = write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        // load 或 isSerial 任一步拋錯都算——兩引擎驗證時機不同,
        // 但「這份設定不能安靜地選一條分支」的保證相同。
        expect(() => isSerial(loadChangeMeta(path))).toThrow();
        return;
      }
      expectSubset({ value: isSerial(loadChangeMeta(path)) }, want!, c.name);
    });
  }
});

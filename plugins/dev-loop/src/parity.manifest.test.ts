/**
 * 確保每個 fixtures/parity/*.json 都有人消費——F5。
 *
 * 每個 `parity.*.test.ts` 檔內的 SECTIONS 只守住「檔內的 section」與「該檔
 * consumer 讀的 section」一致;但如果整個測試檔被刪掉(或忘了寫),
 * fixtures/parity/ 下多出來的一個 module 檔案不會讓任何測試變紅。這裡補上
 * 目錄層級的守門:parity 目錄下的 .json module 集合,必須恰好等於本側消費的
 * module 集合。
 *
 * 新增第五個 fixture 檔時,必須同步把 module 名字加進下面的 CONSUMED_MODULES,
 * 否則這個測試會紅。
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { PARITY_DIR } from "./parityFixture.js";

const CONSUMED_MODULES = new Set(["adapter", "changemeta", "checkpoint", "cli", "config", "followup", "gate", "review", "shlex", "teardown", "units", "worktree"]);

describe("parity: fixture manifest", () => {
  it("every fixtures/parity/*.json module is consumed by some test file", () => {
    const found = new Set(
      readdirSync(PARITY_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length)),
    );
    expect(found, "fixtures/parity/*.json modules").toEqual(CONSUMED_MODULES);
  });
});

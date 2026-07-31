/**
 * 跨引擎 parity fixture 的 TS 側 loader。
 *
 * fixtures/parity/*.json 同時被本檔與 tests/conftest.py 消費。兩側必須斷言
 * 同一張預期表——只改一側即為錯誤。契約見 fixtures/parity/README.md。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { expect } from "vitest";

// src/ -> plugins/dev-loop/ -> plugins/ -> repo root
const PARITY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/parity");

export interface Expectation {
  expect?: Record<string, unknown>;
  expect_throws?: boolean;
}

export interface ParityCase extends Expectation {
  name: string;
  divergence_reason?: string;
  py?: Expectation;
  ts?: Expectation;
  [key: string]: unknown;
}

/**
 * 取 <module>.json 的一個 section。順帶守住「檔內每個 section 都有人消費」
 * ——加了 section 卻沒人讀,會靜默通過,fixture 就變成裝飾品。
 */
export function parityCases(
  module_: string,
  section: string,
  expectedSections: string[],
): ParityCase[] {
  const raw: unknown = JSON.parse(readFileSync(join(PARITY_DIR, `${module_}.json`), "utf-8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${module_}.json root must be an object`);
  }
  const data = raw as Record<string, ParityCase[]>;
  expect(Object.keys(data).sort(), `${module_}.json sections`).toEqual([...expectedSections].sort());
  const cases = data[section];
  expect(cases.length, `${module_}.json section ${section}`).toBeGreaterThan(0);
  const names = cases.map((c) => c.name);
  expect(new Set(names).size, `${module_}/${section} duplicate case names`).toBe(names.length);
  return cases;
}

/** 把 case 攤成 { expect, throws }。分歧 case 取 TS 那份區塊。 */
export function resolveExpectation(c: ParityCase): {
  expect: Record<string, unknown> | undefined;
  throws: boolean;
} {
  let block: Expectation = c;
  if (c.divergence_reason !== undefined) {
    expect(c.divergence_reason.trim(), "divergence_reason must be non-empty").not.toBe("");
    if (c.py === undefined || c.ts === undefined) {
      throw new Error(`case ${c.name}: divergence case needs both py and ts blocks`);
    }
    if (c.expect !== undefined || c.expect_throws !== undefined) {
      throw new Error(`case ${c.name}: divergence case must not also carry a top-level expectation`);
    }
    block = c.ts;
  }
  const throws = block.expect_throws === true;
  if ((block.expect === undefined) === !throws) {
    throw new Error(`case ${c.name} must have exactly one of expect / expect_throws`);
  }
  return { expect: block.expect, throws };
}

/** expected 是欄位子集;用 toStrictEqual,false 與 0 不得互通。 */
export function expectSubset(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  label: string,
): void {
  for (const [key, want] of Object.entries(expected)) {
    expect(Object.prototype.hasOwnProperty.call(actual, key), `${label}: missing field ${key}`).toBe(true);
    expect(actual[key], `${label}: field ${key}`).toStrictEqual(want);
  }
}

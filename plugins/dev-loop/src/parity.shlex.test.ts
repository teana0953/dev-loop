import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { shlexSplit, shlexJoin, shlexQuote } from "./shlex.js";

const SECTIONS = ["split", "quote", "join", "roundTrip"];

describe("parity: shlexSplit", () => {
  for (const c of parityCases("shlex", "split", SECTIONS)) {
    it(c.name, () => {
      const input = c.input as string;
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => shlexSplit(input)).toThrow();
        return;
      }
      expectSubset({ value: shlexSplit(input) }, want!, c.name);
    });
  }
});

describe("parity: shlexQuote", () => {
  for (const c of parityCases("shlex", "quote", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "quote never raises").toBe(false);
      expectSubset({ value: shlexQuote(c.input as string) }, want!, c.name);
    });
  }
});

describe("parity: shlexJoin", () => {
  for (const c of parityCases("shlex", "join", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "join never raises").toBe(false);
      expectSubset({ value: shlexJoin(c.input as string[]) }, want!, c.name);
    });
  }
});

describe("parity: shlex round trip", () => {
  for (const c of parityCases("shlex", "roundTrip", SECTIONS)) {
    it(c.name, () => {
      // split(join(split(x))) === split(x)。roundTrip 的 case 刻意沒有 expect,
      // 所以不走 resolveExpectation。
      const parts = shlexSplit(c.input as string);
      expect(shlexSplit(shlexJoin(parts)), c.name).toEqual(parts);
    });
  }
});

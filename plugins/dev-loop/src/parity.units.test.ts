import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { allDone, allMerged, buildUnits, mark, pendingUnits, type Unit } from "./units.js";

const SECTIONS = ["buildUnits", "pendingUnits", "mark", "allDone", "allMerged"];

function units(c: { units?: unknown }): Unit[] {
  // mark 就地改動,所以每個 case 各拿一份副本,避免跨 case 汙染
  return structuredClone(c.units) as Unit[];
}

describe("parity: buildUnits", () => {
  for (const c of parityCases("units", "buildUnits", SECTIONS)) {
    it(c.name, () => {
      const call = () => buildUnits(
        c.parallel_groups as unknown[], c.branch as string, c.wt_root as string,
      );
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(call).toThrow();
        return;
      }
      expectSubset({ value: call() }, want!, c.name);
    });
  }
});

describe("parity: pendingUnits", () => {
  for (const c of parityCases("units", "pendingUnits", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => pendingUnits(units(c))).toThrow();
        return;
      }
      expectSubset({ value: pendingUnits(units(c)) }, want!, c.name);
    });
  }
});

describe("parity: mark", () => {
  for (const c of parityCases("units", "mark", SECTIONS)) {
    it(c.name, () => {
      const u = units(c);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => mark(u, c.unit_id as string, c.status as string)).toThrow();
        return;
      }
      mark(u, c.unit_id as string, c.status as string);
      expectSubset({ value: u }, want!, c.name);
    });
  }
});

describe("parity: allDone", () => {
  for (const c of parityCases("units", "allDone", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => allDone(units(c))).toThrow();
        return;
      }
      expectSubset({ value: allDone(units(c)) }, want!, c.name);
    });
  }
});

describe("parity: allMerged", () => {
  for (const c of parityCases("units", "allMerged", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => allMerged(units(c))).toThrow();
        return;
      }
      expectSubset({ value: allMerged(units(c)) }, want!, c.name);
    });
  }
});

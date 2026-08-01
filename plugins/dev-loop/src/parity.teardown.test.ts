import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { classifyBranchDeleteError } from "./teardown.js";

const SECTIONS = ["classifyBranchDeleteError"];

describe("parity: classifyBranchDeleteError", () => {
  for (const c of parityCases("teardown", "classifyBranchDeleteError", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "classifyBranchDeleteError never raises").toBe(false);
      const got = classifyBranchDeleteError(c.code as number, c.stderr as string);
      expectSubset({ value: got }, want!, c.name);
    });
  }
});

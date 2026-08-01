import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { parseWorktreePaths } from "./worktree.js";

const SECTIONS = ["parseWorktreePaths"];

describe("parity: parseWorktreePaths", () => {
  for (const c of parityCases("worktree", "parseWorktreePaths", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "parseWorktreePaths never raises").toBe(false);
      const got = parseWorktreePaths(c.porcelain as string, c.repo_resolved as string);
      expectSubset({ value: got }, want!, c.name);
    });
  }
});

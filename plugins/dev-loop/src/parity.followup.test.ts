import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { renderFollowup } from "./finish.js";

const SECTIONS = ["renderFollowup"];

describe("parity: renderFollowup", () => {
  for (const c of parityCases("followup", "renderFollowup", SECTIONS)) {
    it(c.name, () => {
      const notes = c.notes as string[];
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => renderFollowup(notes)).toThrow();
        return;
      }
      expectSubset({ value: renderFollowup(notes) }, want!, c.name);
    });
  }
});

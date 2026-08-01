import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import {
  aggregateFindings, classify, classifyProposal, classifyQa,
  nonBlockingNotes, parseReviewReport, type Finding,
} from "./review.js";

const SECTIONS = [
  "classify", "classifyProposal", "classifyQa",
  "nonBlockingNotes", "parseReviewReport", "aggregateFindings",
];

function write(payload: unknown, name = "report.json"): string {
  const p = join(mkdtempSync(join(tmpdir(), "review-")), name);
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

function pureSection(section: string, fn: (f: Finding[]) => unknown): void {
  describe(`parity: ${section}`, () => {
    for (const c of parityCases("review", section, SECTIONS)) {
      it(c.name, () => {
        const findings = c.findings as Finding[];
        const { expect: want, throws } = resolveExpectation(c);
        if (throws) {
          expect(() => fn(findings)).toThrow();
          return;
        }
        expectSubset({ value: fn(findings) }, want!, c.name);
      });
    }
  });
}

pureSection("classify", classify);
pureSection("classifyProposal", classifyProposal);
pureSection("classifyQa", classifyQa);
pureSection("nonBlockingNotes", nonBlockingNotes);

function reportPath(c: ParityCase): string {
  return c.file_absent === true
    ? join(mkdtempSync(join(tmpdir(), "review-")), "absent.json")
    : write(c.input);
}

describe("parity: parseReviewReport", () => {
  for (const c of parityCases("review", "parseReviewReport", SECTIONS)) {
    it(c.name, () => {
      const path = reportPath(c);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => parseReviewReport(path)).toThrow();
        return;
      }
      expectSubset({ value: parseReviewReport(path) }, want!, c.name);
    });
  }
});

describe("parity: aggregateFindings", () => {
  for (const c of parityCases("review", "aggregateFindings", SECTIONS)) {
    it(c.name, () => {
      const paths = (c.inputs as unknown[]).map((p, i) => write(p, `r${i}.json`));
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => aggregateFindings(paths)).toThrow();
        return;
      }
      expectSubset({ value: aggregateFindings(paths) }, want!, c.name);
    });
  }
});

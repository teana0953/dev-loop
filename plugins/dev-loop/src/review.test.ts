import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportError, parseReviewReport } from "./review.js";

function write(payload: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "review-")), "r.json");
  writeFileSync(p, payload, "utf-8");
  return p;
}

describe("ReportError", () => {
  // M2b-2 的 CLI 要靠 instanceof 把「報告壞掉」跟其他例外分開,
  // 所以這個子類身分本身就是契約。
  it("is thrown for a malformed report, not a bare Error", () => {
    expect(() => parseReviewReport(write("{not json"))).toThrow(ReportError);
  });
  it("is thrown for a missing file", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "review-")), "nope.json");
    expect(() => parseReviewReport(missing)).toThrow(ReportError);
  });
  it("names the offending finding index", () => {
    const p = write(JSON.stringify({ findings: [{ severity: "blocking" }, { severity: "x" }] }));
    expect(() => parseReviewReport(p)).toThrow("findings[1]");
  });
});

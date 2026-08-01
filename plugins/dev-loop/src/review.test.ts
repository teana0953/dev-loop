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

  // 這兩個 case 刻意不放進 fixtures/parity/review.json:parity 那份 fixture
  // 只斷言「有沒有丟」,不比對錯誤型別(兩語言的例外文法本就不同)。所以
  // 拿掉 `data === null || Array.isArray(data)` 這道 guard 也不會讓
  // parity 的 null-root / array-root case 變紅——`hasOwnProperty.call(null, ...)`
  // 一樣會丟一個(裸的 TypeError),parity harness 分辨不出來。只有在這裡
  // 直接斷言 `instanceof ReportError`,才抓得到「丟對了錯誤但型別不對」這種
  // 迴歸。不要為了「統一」把它們搬進 fixture。
  it("is thrown (not a bare TypeError) for a null root", () => {
    const p = write("null");
    expect(() => parseReviewReport(p)).toThrow(ReportError);
  });
  it("is thrown (not a bare TypeError) for an array root", () => {
    const p = write("[]");
    expect(() => parseReviewReport(p)).toThrow(ReportError);
  });
});

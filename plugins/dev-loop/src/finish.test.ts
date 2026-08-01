import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFollowup, writeFollowup } from "./finish.js";

describe("renderFollowup", () => {
  it("renders an empty string when there are no notes", () => {
    expect(renderFollowup([])).toBe("");
  });
  it("renders a heading, a blank line, and one bullet per note", () => {
    expect(renderFollowup(["rename x", "add docstring"]))
      .toBe("## Follow-up(non-blocking)\n\n- rename x\n- add docstring\n");
  });
});

describe("writeFollowup", () => {
  it("writes the rendered content to disk", () => {
    const p = join(mkdtempSync(join(tmpdir(), "fu-")), "followup.md");
    writeFollowup(p, ["note one"]);
    expect(readFileSync(p, "utf-8")).toBe("## Follow-up(non-blocking)\n\n- note one\n");
  });
  it("writes an empty file when there are no notes", () => {
    const p = join(mkdtempSync(join(tmpdir(), "fu-")), "followup.md");
    writeFollowup(p, []);
    expect(readFileSync(p, "utf-8")).toBe("");
  });
});

describe("renderFollowup input validation", () => {
  // note 一路從 review 報告經 checkpoint 流到這裡,兩段都不驗元素型別。
  // 型別標註在執行期不存在,所以這些呼叫要 cast 才寫得出來——這正是
  // 真實資料進來的樣子。
  it("rejects a non-string note", () => {
    expect(() => renderFollowup([1] as unknown as string[])).toThrow(TypeError);
  });
  it("rejects a non-string note among valid ones", () => {
    expect(() => renderFollowup(["ok", 2] as unknown as string[])).toThrow(TypeError);
  });
  it("rejects a bare string instead of a list", () => {
    expect(() => renderFollowup("ab" as unknown as string[])).toThrow(TypeError);
  });
  it("rejects null instead of a list", () => {
    expect(() => renderFollowup(null as unknown as string[])).toThrow(TypeError);
  });
  it("names the offending index", () => {
    expect(() => renderFollowup(["ok", 2] as unknown as string[])).toThrow("notes[1]");
  });
});

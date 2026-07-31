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

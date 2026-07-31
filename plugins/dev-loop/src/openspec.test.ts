import { describe, it, expect } from "vitest";
import { validateChange, archiveChange } from "./openspec.js";

describe("validateChange", () => {
  it("issues the exact openspec validate command", () => {
    let seen: string[] = [];
    validateChange("add-foo", (cmd) => { seen = cmd; return [0, ""]; });
    expect(seen).toEqual(["openspec", "validate", "add-foo", "--strict", "--no-interactive"]);
  });
  it("reports ok on exit code zero", () => {
    const r = validateChange("add-foo", () => [0, "fine"]);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("fine");
  });
  it("reports not ok on a non-zero exit code and keeps the output", () => {
    const r = validateChange("add-foo", () => [1, "spec broken"]);
    expect(r.ok).toBe(false);
    expect(r.output).toBe("spec broken");
    expect(r.command).toEqual(["openspec", "validate", "add-foo", "--strict", "--no-interactive"]);
  });
});

describe("archiveChange", () => {
  it("issues the exact openspec archive command", () => {
    let seen: string[] = [];
    archiveChange("add-foo", (cmd) => { seen = cmd; return [0, ""]; });
    expect(seen).toEqual(["openspec", "archive", "add-foo", "--yes"]);
  });
  it("reports not ok on a non-zero exit code", () => {
    expect(archiveChange("add-foo", () => [2, "boom"]).ok).toBe(false);
  });
});

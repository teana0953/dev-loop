import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChangeMeta, isSerial } from "./changemeta.js";

function tmpMeta(content: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "meta-")), "meta.json");
  writeFileSync(p, JSON.stringify(content), "utf-8");
  return p;
}

describe("loadChangeMeta", () => {
  it("returns defaults when the file does not exist", () => {
    const m = loadChangeMeta(join(mkdtempSync(join(tmpdir(), "meta-")), "missing.json"));
    expect(m.parallel_groups).toEqual([]);
    expect(m.needs_uiux).toBe(false);
    expect(m.finish).toBeNull();
    expect(m.flow_profile).toBeNull();
  });

  it("reads the two orthogonal flow axes", () => {
    const m = loadChangeMeta(tmpMeta({ flow_profile: "light", needs_uiux: true }));
    expect(m.flow_profile).toBe("light");
    expect(m.needs_uiux).toBe(true);
  });

  it("throws on an invalid flow_profile at load time", () => {
    expect(() => loadChangeMeta(tmpMeta({ flow_profile: "medium" }))).toThrow();
  });

  it("throws on a malformed JSON root: array", () => {
    expect(() => loadChangeMeta(tmpMeta([1, 2, 3]))).toThrow();
  });

  it("throws on a malformed JSON root: string", () => {
    expect(() => loadChangeMeta(tmpMeta("just a string"))).toThrow();
  });

  it("throws on a malformed JSON root: number", () => {
    expect(() => loadChangeMeta(tmpMeta(42))).toThrow();
  });

  it("throws on a malformed JSON root: null", () => {
    expect(() => loadChangeMeta(tmpMeta(null))).toThrow();
  });
});

describe("isSerial", () => {
  it("treats zero or one parallel group as serial", () => {
    expect(isSerial({ parallel_groups: [], needs_uiux: false, finish: null, flow_profile: null })).toBe(true);
    expect(isSerial({ parallel_groups: ["g1"], needs_uiux: false, finish: null, flow_profile: null })).toBe(true);
  });
  it("treats two or more groups as parallel", () => {
    expect(isSerial({ parallel_groups: ["g1", "g2"], needs_uiux: false, finish: null, flow_profile: null })).toBe(false);
  });
});

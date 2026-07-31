import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPath, appendHistory } from "./history.js";

describe("history", () => {
  it("places history.jsonl beside the checkpoint", () => {
    expect(historyPath("/a/b/.devloop/checkpoint.json")).toBe("/a/b/.devloop/history.jsonl");
  });

  it("appends one JSON object per line with the exact Python key names", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const cp = join(dir, "checkpoint.json");
    appendHistory(cp, "apply_done", "apply", "gate", 0);
    appendHistory(cp, "gate_pass", "gate", "qa", 1);
    const lines = readFileSync(join(dir, "history.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(Object.keys(first).sort()).toEqual(["event", "from", "iteration", "to", "ts"]);
    expect(first.event).toBe("apply_done");
    expect(first.from).toBe("apply");
    expect(first.to).toBe("gate");
    expect(first.iteration).toBe(0);
    expect(typeof first.ts).toBe("string");
    expect(JSON.parse(lines[1]).to).toBe("qa");
  });

  it("creates the parent directory when it does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const cp = join(dir, "nested", "checkpoint.json");
    appendHistory(cp, "apply_done", "apply", "gate", 0);
    expect(readFileSync(join(dir, "nested", "history.jsonl"), "utf-8")).toContain("apply_done");
  });
});

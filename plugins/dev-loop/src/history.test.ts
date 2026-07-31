import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPath, appendHistory } from "./history.js";

describe("history", () => {
  it("places history.jsonl beside the checkpoint (absolute path)", () => {
    expect(historyPath("/a/b/.devloop/checkpoint.json")).toBe("/a/b/.devloop/history.jsonl");
  });

  it("leaves relative paths relative (bare filename)", () => {
    expect(historyPath("checkpoint.json")).toBe("history.jsonl");
  });

  it("leaves relative paths relative (path with directory)", () => {
    expect(historyPath("./x/checkpoint.json")).toBe("x/history.jsonl");
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

  it("writes and reads correctly via relative path", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const origCwd = process.cwd();
    try {
      process.chdir(dir);
      // Create a subdirectory and checkpoint file (relatively)
      writeFileSync("rel_checkpoint.json", JSON.stringify({ phase: "apply" }));
      appendHistory("rel_checkpoint.json", "test_event", "phase_a", "phase_b", 0);

      // Verify history file exists and contains the entry
      const histPath = "history.jsonl";
      expect(existsSync(histPath)).toBe(true);
      const content = readFileSync(histPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.event).toBe("test_event");
      expect(entry.from).toBe("phase_a");
      expect(entry.to).toBe("phase_b");
    } finally {
      process.chdir(origCwd);
    }
  });
});

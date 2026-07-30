import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCheckpoint, saveCheckpoint, loadCheckpoint } from "./checkpoint.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cp-"));
}

describe("checkpoint", () => {
  it("save then load roundtrip", () => {
    const p = join(tmp(), "checkpoint.json");
    const cp = makeCheckpoint({
      phase: "apply", change_id: "add-foo", branch: "loop/add-foo",
      iteration: 2, last_artifact: "docs/review-1.md",
      non_blocking: ["rename x", "add docstring"],
    });
    saveCheckpoint(cp, p);
    const loaded = loadCheckpoint(p);
    expect(loaded.phase).toBe("apply");
    expect(loaded.change_id).toBe("add-foo");
    expect(loaded.iteration).toBe(2);
    expect(loaded.non_blocking).toEqual(["rename x", "add docstring"]);
  });

  it("save sets updated_at", () => {
    const p = join(tmp(), "checkpoint.json");
    const cp = makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" });
    expect(cp.updated_at).toBe("");
    saveCheckpoint(cp, p);
    expect(loadCheckpoint(p).updated_at).not.toBe("");
  });

  it("applies defaults", () => {
    const cp = makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" });
    expect(cp.iteration).toBe(0);
    expect(cp.non_blocking).toEqual([]);
    expect(cp.resume_exec).toBeNull();
    expect(cp.flow_profile).toBe("full");
    expect(cp.needs_uiux).toBe(false);
  });

  it("creates missing parent dirs on save", () => {
    const p = join(tmp(), ".devloop", "checkpoint.json");
    saveCheckpoint(makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" }), p);
    expect(loadCheckpoint(p).phase).toBe("apply");
  });

  it("loads legacy checkpoint missing newer keys via defaults", () => {
    const p = join(tmp(), "legacy.json");
    writeFileSync(p, JSON.stringify({
      phase: "apply", change_id: "c", branch: "b",
      iteration: 0, last_artifact: "", non_blocking: [],
      updated_at: "", resume_exec: null,
    }), "utf-8");
    const loaded = loadCheckpoint(p);
    expect(loaded.units).toEqual([]);
    expect(loaded.review_legs).toEqual([]);
    expect(loaded.propose_attempts).toBe(0);
    expect(loaded.gate_failures).toBe(0);
    expect(loaded.finish_mode).toBeNull();
    expect(loaded.flow_profile).toBe("full");
    expect(loaded.needs_uiux).toBe(false);
  });
});

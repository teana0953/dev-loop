import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
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

  it("emits exactly the 15-key schema Python's Checkpoint dataclass expects", () => {
    // Authoritative key list transcribed from
    // plugins/dev-loop/devloop/checkpoint.py (the @dataclass field order),
    // NOT from checkpoint.ts -- this must assert the TS output against the
    // Python contract, not against itself. If Python rejects an emitted
    // checkpoint with Checkpoint(**data), it means this list (or the
    // Python dataclass) changed and this test must be updated deliberately.
    const PYTHON_CHECKPOINT_KEYS = [
      "phase",
      "change_id",
      "branch",
      "iteration",
      "last_artifact",
      "non_blocking",
      "updated_at",
      "resume_exec",
      "units",
      "review_legs",
      "propose_attempts",
      "gate_failures",
      "finish_mode",
      "flow_profile",
      "needs_uiux",
    ];
    const p = join(tmp(), "checkpoint.json");
    const cp = makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" });
    saveCheckpoint(cp, p);
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    const keys = Object.keys(raw).sort();
    expect(keys).toEqual([...PYTHON_CHECKPOINT_KEYS].sort());
    expect(keys.length).toBe(15);
  });

  describe("root and shape validation (F2)", () => {
    // Python's Checkpoint.load is `cls(**data)`. A non-dict root can't be
    // unpacked as keyword arguments at all -> TypeError. An array root
    // spread in TS (`{...[1,2,3]}`) silently becomes `{0:1,1:2,2:3}` with no
    // error and a checkpoint with phase: undefined -- exactly the bug this
    // guards against.
    it("throws on a malformed JSON root: array", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify([1, 2, 3]), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });

    it("throws on a malformed JSON root: string", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify("oops"), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });

    it("throws on a malformed JSON root: number", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify(42), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });

    it("throws on a malformed JSON root: null", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify(null), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });

    it("throws when a required key (phase/change_id/branch) is missing", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify({ change_id: "c", branch: "b" }), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });

    it("throws on an unknown key, matching Python's TypeError on Checkpoint(**data)", () => {
      const p = join(tmp(), "checkpoint.json");
      writeFileSync(p, JSON.stringify({
        phase: "apply", change_id: "c", branch: "b", bogus_future_field: 1,
      }), "utf-8");
      expect(() => loadCheckpoint(p)).toThrow();
    });
  });
});

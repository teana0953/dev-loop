import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, resolveModel, resolveFinish, validateGateCmds, validateModelConfig,
} from "./config.js";

function tmpFile(content: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
  writeFileSync(p, JSON.stringify(content), "utf-8");
  return p;
}

describe("loadConfig", () => {
  it("returns defaults when the file does not exist", () => {
    const c = loadConfig(join(mkdtempSync(join(tmpdir(), "cfg-")), "missing.json"));
    expect(c.finish).toBeNull();
    expect(c.auto_arm).toBe(true);
    expect(c.gate_cmds).toEqual([]);
    expect(c.superpowers).toBeNull();
    expect(c.auto_approve).toBe(false);
    expect(c.model_profile).toBeNull();
    expect(c.models).toEqual({});
  });

  it("reads values from the file", () => {
    const c = loadConfig(tmpFile({ finish: "merge", auto_arm: false, gate_cmds: ["pytest"] }));
    expect(c.finish).toBe("merge");
    expect(c.auto_arm).toBe(false);
    expect(c.gate_cmds).toEqual(["pytest"]);
  });

  it("treats auto_approve as true only for JSON true", () => {
    expect(loadConfig(tmpFile({ auto_approve: true })).auto_approve).toBe(true);
    expect(loadConfig(tmpFile({ auto_approve: "yes" })).auto_approve).toBe(false);
    expect(loadConfig(tmpFile({ auto_approve: 1 })).auto_approve).toBe(false);
  });

  it("throws on an invalid model_profile at load time", () => {
    expect(() => loadConfig(tmpFile({ model_profile: "cheap" }))).toThrow();
  });

  it("throws on a malformed JSON root instead of silently discarding it", () => {
    expect(() => loadConfig(tmpFile([1, 2, 3]))).toThrow();
    expect(() => loadConfig(tmpFile("hello"))).toThrow();
    expect(() => loadConfig(tmpFile(42))).toThrow();
    expect(() => loadConfig(tmpFile(null))).toThrow();
  });

  describe("explicit null vs. absent key (F1 — Python dict.get parity)", () => {
    // Python's data.get(k, default) substitutes `default` only when `k` is
    // ABSENT; an explicit JSON `null` is a present key, so .get returns
    // None, not the default. These pin down that distinction per field,
    // matching plugins/dev-loop/devloop/config.py's load_config exactly.

    it("auto_arm: null is a present key -> bool(None) is False (Python parity)", () => {
      // PY: bool(data.get("auto_arm", True)) with auto_arm=None -> False.
      expect(loadConfig(tmpFile({ auto_arm: null })).auto_arm).toBe(false);
    });

    it("auto_arm: absent key -> default True", () => {
      expect(loadConfig(tmpFile({})).auto_arm).toBe(true);
    });

    it("gate_cmds: null is preserved (not defaulted to []) for validateGateCmds to reject", () => {
      // PY: data.get("gate_cmds", []) with gate_cmds=None -> None, which
      // later fails validate_gate_cmds's isinstance(list) check.
      expect(loadConfig(tmpFile({ gate_cmds: null })).gate_cmds).toBeNull();
    });

    it("gate_cmds: absent key -> default []", () => {
      expect(loadConfig(tmpFile({})).gate_cmds).toEqual([]);
    });

    it("models: null reaches validateModelConfig and throws, matching Python's ValueError", () => {
      // PY: data.get("models", {}) with models=None -> None; then
      // isinstance(None, dict) is False -> validate_model_config raises.
      expect(() => loadConfig(tmpFile({ models: null }))).toThrow();
    });

    it("models: absent key -> default {}", () => {
      expect(loadConfig(tmpFile({}))).toMatchObject({ models: {} });
    });

    it("finish: null and absent both resolve to null (Python default is already None)", () => {
      expect(loadConfig(tmpFile({ finish: null })).finish).toBeNull();
      expect(loadConfig(tmpFile({})).finish).toBeNull();
    });

    it("superpowers: null and absent both resolve to null (Python default is already None)", () => {
      expect(loadConfig(tmpFile({ superpowers: null })).superpowers).toBeNull();
      expect(loadConfig(tmpFile({})).superpowers).toBeNull();
    });

    it("model_profile: null and absent both resolve to null (Python default is already None)", () => {
      expect(loadConfig(tmpFile({ model_profile: null })).model_profile).toBeNull();
      expect(loadConfig(tmpFile({})).model_profile).toBeNull();
    });

    it("auto_approve: null and absent both resolve to false (neither `is True`)", () => {
      expect(loadConfig(tmpFile({ auto_approve: null })).auto_approve).toBe(false);
      expect(loadConfig(tmpFile({})).auto_approve).toBe(false);
    });
  });
});

describe("validateModelConfig", () => {
  it("accepts valid profiles and stage aliases", () => {
    expect(() => validateModelConfig("budget", { apply: "sonnet" })).not.toThrow();
    expect(() => validateModelConfig(null, {})).not.toThrow();
  });
  it("rejects an unknown stage key", () => {
    expect(() => validateModelConfig(null, { deploy: "sonnet" })).toThrow();
  });
  it("rejects a full model id instead of an alias", () => {
    expect(() => validateModelConfig(null, { apply: "claude-sonnet-5" })).toThrow();
  });
  it("rejects a non-object models value", () => {
    expect(() => validateModelConfig(null, ["sonnet"])).toThrow();
  });
});

describe("resolveModel", () => {
  const base = { finish: null, auto_arm: true, gate_cmds: [], superpowers: null,
                 auto_approve: false, model_profile: null, models: {} };
  it("returns null when nothing is configured (inherit session model)", () => {
    expect(resolveModel("apply", base)).toBeNull();
  });
  it("prefers an explicit per-stage override", () => {
    expect(resolveModel("apply", { ...base, models: { apply: "opus" } })).toBe("opus");
  });
  it("routes apply and fix to sonnet under the budget profile", () => {
    const budget = { ...base, model_profile: "budget" };
    expect(resolveModel("apply", budget)).toBe("sonnet");
    expect(resolveModel("fix", budget)).toBe("sonnet");
  });
  it("leaves gatekeeping stages inheriting under the budget profile", () => {
    const budget = { ...base, model_profile: "budget" };
    expect(resolveModel("brainstorm", budget)).toBeNull();
    expect(resolveModel("review", budget)).toBeNull();
  });
  it("throws for an unknown stage", () => {
    expect(() => resolveModel("deploy", base)).toThrow();
  });
});

describe("validateGateCmds", () => {
  it("accepts a list of non-empty strings", () => {
    expect(validateGateCmds(["pytest", "ruff check"])).toEqual(["pytest", "ruff check"]);
  });
  it("rejects a non-list, an empty string, and a non-string element", () => {
    expect(() => validateGateCmds("pytest")).toThrow();
    expect(() => validateGateCmds([""])).toThrow();
    expect(() => validateGateCmds(["  "])).toThrow();
    expect(() => validateGateCmds([1])).toThrow();
  });
});

describe("resolveFinish", () => {
  const cfg = (finish: string | null) => ({ finish, auto_arm: true, gate_cmds: [],
    superpowers: null, auto_approve: false, model_profile: null, models: {} });
  it("defaults to ask when neither source sets it", () => {
    expect(resolveFinish(cfg(null), { finish: null })).toBe("ask");
  });
  it("lets change metadata override the global config", () => {
    expect(resolveFinish(cfg("merge"), { finish: "pr" })).toBe("pr");
  });
  it("falls back to the config value when metadata is unset", () => {
    expect(resolveFinish(cfg("merge"), { finish: null })).toBe("merge");
  });
  it("throws on an invalid value even when it would be overridden", () => {
    expect(() => resolveFinish(cfg("bogus"), { finish: "merge" })).toThrow();
    expect(() => resolveFinish(cfg("merge"), { finish: "bogus" })).toThrow();
  });
});

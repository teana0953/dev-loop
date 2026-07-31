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

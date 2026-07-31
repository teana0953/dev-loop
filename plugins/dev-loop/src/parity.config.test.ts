import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import {
  loadConfig, resolveModel, resolveFinish, validateGateCmds, type Config,
} from "./config.js";

const SECTIONS = ["loadConfig", "resolveModel", "resolveFinish", "validateGateCmds"];

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "config.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

function absentPath(): string {
  return join(mkdtempSync(join(tmpdir(), "parity-")), "absent.json");
}

describe("parity: loadConfig", () => {
  for (const c of parityCases("config", "loadConfig", SECTIONS)) {
    it(c.name, () => {
      const path = c.file_absent === true ? absentPath() : write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadConfig(path)).toThrow();
        return;
      }
      expectSubset(loadConfig(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

function configOf(c: ParityCase): Config {
  return loadConfig(write(c.config));
}

describe("parity: resolveModel", () => {
  for (const c of parityCases("config", "resolveModel", SECTIONS)) {
    it(c.name, () => {
      const stage = c.stage as string;
      // configOf(c) is hoisted outside the throws/non-throws branch (and outside
      // any toThrow closure) so a case whose config merely fails to LOAD can't be
      // mistaken for a satisfied "resolveModel throws" expectation -- matching the
      // Python side, which builds `cfg` outside `pytest.raises`.
      const cfg = configOf(c);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => resolveModel(stage, cfg)).toThrow();
        return;
      }
      expectSubset({ value: resolveModel(stage, cfg) }, want!, c.name);
    });
  }
});

describe("parity: resolveFinish", () => {
  for (const c of parityCases("config", "resolveFinish", SECTIONS)) {
    it(c.name, () => {
      const cfg = loadConfig(write({ finish: c.config_finish }));
      const meta = { finish: c.meta_finish as string | null };
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => resolveFinish(cfg, meta)).toThrow();
        return;
      }
      expectSubset({ value: resolveFinish(cfg, meta) }, want!, c.name);
    });
  }
});

describe("parity: validateGateCmds", () => {
  for (const c of parityCases("config", "validateGateCmds", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => validateGateCmds(c.input)).toThrow();
        return;
      }
      expectSubset({ value: validateGateCmds(c.input) }, want!, c.name);
    });
  }
});

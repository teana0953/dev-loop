import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TS_COMMANDS } from "./cli.js";

/**
 * I7: cross-engine command matrix.
 *
 * Every command TS claims to own (TS_COMMANDS) must produce byte-identical
 * stdout and exit code to `python3 -m devloop.cli` for a small matrix of
 * inputs. C1 (status served incompletely), C2 (units-status KeyError vs.
 * `undefined`), and I3 (unrecognized flags silently accepted) would all have
 * been caught by a test like this one, had it existed before those
 * regressions shipped.
 *
 * The matrix is keyed by command and this file iterates TS_COMMANDS itself
 * (not a hardcoded list of command names), so a command promoted into
 * TS_COMMANDS in a later milestone is covered automatically — the "matrix
 * has coverage" assertion below fails loudly if nobody added rows for it,
 * rather than the new command silently going untested.
 *
 * stderr is intentionally not compared: argparse and this hand-written
 * parser word their errors differently (see fixtures/parity/README.md), and
 * that wording mismatch is an accepted, deliberate divergence, not a bug.
 */

const CLI = join(process.cwd(), "dist", "cli.js");
// src/ -> plugins/dev-loop/ is the plugin root delegateToPython also uses
// for PYTHONPATH.
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface EngineResult {
  stdout: string;
  exit_code: number;
}

function runTs(argv: string[]): EngineResult {
  const proc = spawnSync("node", [CLI, ...argv], { encoding: "utf-8" });
  return { stdout: proc.stdout ?? "", exit_code: proc.status ?? 1 };
}

function runPy(argv: string[]): EngineResult {
  const proc = spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    encoding: "utf-8",
    env: { ...process.env, PYTHONPATH: PLUGIN_ROOT },
  });
  return { stdout: proc.stdout ?? "", exit_code: proc.status ?? 1 };
}

const CHECKPOINT_DEFAULTS = {
  iteration: 0, last_artifact: "", non_blocking: [], updated_at: "",
  resume_exec: null, units: [], review_legs: [], propose_attempts: 0,
  gate_failures: 0, finish_mode: null, flow_profile: "full", needs_uiux: false,
};

function writeCheckpoint(dir: string, fields: Record<string, unknown>): string {
  const p = join(dir, "cp.json");
  writeFileSync(p, JSON.stringify({ ...CHECKPOINT_DEFAULTS, ...fields }), "utf-8");
  return p;
}

function writeConfig(dir: string, fields: Record<string, unknown>): string {
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(fields), "utf-8");
  return p;
}

interface MatrixCase {
  name: string;
  build: (dir: string) => string[];
}

const MATRIX: Partial<Record<(typeof TS_COMMANDS)[number], MatrixCase[]>> = {
  "units-status": [
    {
      name: "a checkpoint with units",
      build: (dir) => [
        "units-status",
        "--file",
        writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b",
          units: [{ id: "g1", status: "pending" }, { id: "g2", status: "done" }],
        }),
      ],
    },
    {
      name: "a checkpoint with no units",
      build: (dir) => [
        "units-status",
        "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      ],
    },
  ],
  model: [
    {
      name: "a budget profile",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "budget" }),
      ],
    },
    {
      name: "an explicit models override",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "budget", models: { apply: "opus" } }),
      ],
    },
    {
      name: "a missing config file",
      build: (dir) => ["model", "--stage", "apply", "--config", join(dir, "absent.json")],
    },
    {
      name: "an invalid config",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "cheap" }),
      ],
    },
  ],
  archive: [
    {
      name: "archive fails identically for a nonexistent openspec change",
      // Both engines shell out to the same real `openspec archive` binary
      // with the same argv from the same cwd, so this is deterministic
      // without needing to inject a fake archiveChange.
      build: (dir) => [
        "archive", "--file",
        writeCheckpoint(dir, { phase: "merge", change_id: "cross-engine-no-such-change-xyz", branch: "b" }),
      ],
    },
  ],
};

describe("cross-engine command matrix (I7)", () => {
  for (const cmd of TS_COMMANDS) {
    const cases = MATRIX[cmd];

    it(`${cmd}: has cross-engine matrix coverage`, () => {
      expect(
        cases,
        `"${cmd}" is in TS_COMMANDS but crossEngine.test.ts has no matrix rows for it — `
        + "add coverage instead of letting a promoted command go untested",
      ).toBeDefined();
      expect(cases?.length ?? 0).toBeGreaterThan(0);
    });

    for (const c of cases ?? []) {
      it(`${cmd}: ${c.name}`, () => {
        const dir = mkdtempSync(join(tmpdir(), "cross-engine-"));
        const argv = c.build(dir);
        const ts = runTs(argv);
        const py = runPy(argv);
        expect(ts.exit_code, `${cmd}/${c.name}: exit code`).toBe(py.exit_code);
        expect(ts.stdout, `${cmd}/${c.name}: stdout`).toBe(py.stdout);
      });
    }
  }
});

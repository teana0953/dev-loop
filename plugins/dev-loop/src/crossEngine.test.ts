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
  /** 比對前的歸一化;dir 已被換成 <DIR>,這裡處理 pid、時間戳之類的易變欄位。 */
  normalize?: (stdout: string) => string;
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
    {
      name: "the --flag=value form",
      build: (dir) => [
        "units-status",
        `--file=${writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b",
          units: [{ id: "g1", status: "pending" }],
        })}`,
      ],
    },
    {
      name: "--file left without a value",
      build: (dir) => {
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" });
        return ["units-status", "--file"];
      },
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
    {
      name: "the --flag=value form",
      build: (dir) => [
        "model", "--stage=apply",
        `--config=${writeConfig(dir, { model_profile: "budget" })}`,
      ],
    },
    {
      name: "--stage left without a value",
      build: () => ["model", "--stage"],
    },
  ],
  // 這些 case 一律不放 `resume_exec`,矩陣測試才不會 spawn watcher。
  // auto-arm 的跨引擎行為由後續的交叉臂測試負責。
  event: [
    {
      name: "a plain transition",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done",
      ],
    },
    {
      name: "qa_skip refused outside the light profile",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "qa", change_id: "c1", branch: "b", flow_profile: "full" }),
        "--event", "qa_skip",
      ],
    },
    {
      name: "qa_skip allowed on light without uiux",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, {
          phase: "qa", change_id: "c1", branch: "b",
          flow_profile: "light", needs_uiux: false,
        }),
        "--event", "qa_skip",
      ],
    },
    {
      name: "a human resume that clears the counters",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, {
          phase: "escalated", change_id: "c1", branch: "b",
          iteration: 2, propose_attempts: 3, gate_failures: 4,
        }),
        "--event", "human_resume_fix",
      ],
    },
    {
      name: "a --finish-mode outside the choices",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "qa", change_id: "c1", branch: "b" }),
        "--event", "qa_pass", "--finish-mode", "zzz",
      ],
    },
    {
      name: "an invalid event",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "no_such_event",
      ],
    },
    {
      // fix round 1 / F1:argparse 接受 --flag=value,舊的 parseArgs 不接受,
      // 於是 PY 推進 loop、TS 回 2 —— 一模一樣的命令列讓兩引擎狀態分岔。
      name: "the --flag=value form",
      build: (dir) => [
        "event",
        `--file=${writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" })}`,
        "--event=apply_done",
      ],
    },
    {
      // fix round 1 / F2:已知旗標在行尾沒有值。舊的 parseArgs 把它整個吞掉,
      // 命令帶著預設值繼續跑並真的寫了 checkpoint,PY 則什麼都不寫直接回 2。
      name: "a known flag left without a value",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done", "--max",
      ],
    },
    {
      name: "an unambiguous long-option abbreviation",
      build: (dir) => [
        "event", "--fil",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--even", "apply_done",
      ],
    },
    {
      name: "an ambiguous long-option abbreviation",
      build: (dir) => [
        "event", "--fi",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done",
      ],
    },
    {
      name: "a bare -- with nothing after it",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done", "--",
      ],
    },
    {
      name: "a non-integer --max",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done", "--max", "x",
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
        // 每個引擎各自的 dir:變更型命令(event 起)會改 checkpoint,共用 dir
        // 會讓第二個引擎看到第一個引擎改過的狀態,比出來的差異全是假的。
        const dirTs = mkdtempSync(join(tmpdir(), "cross-engine-ts-"));
        const dirPy = mkdtempSync(join(tmpdir(), "cross-engine-py-"));
        const ts = runTs(c.build(dirTs));
        const py = runPy(c.build(dirPy));
        const norm = (s: string, dir: string): string => {
          const withoutDir = s.split(dir).join("<DIR>");
          return c.normalize ? c.normalize(withoutDir) : withoutDir;
        };
        expect(ts.exit_code, `${cmd}/${c.name}: exit code`).toBe(py.exit_code);
        expect(norm(ts.stdout, dirTs), `${cmd}/${c.name}: stdout`)
          .toBe(norm(py.stdout, dirPy));
      });
    }
  }
});

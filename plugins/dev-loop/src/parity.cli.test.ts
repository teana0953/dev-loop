import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import { TS_COMMANDS } from "./cli.js";

const SECTIONS = ["unitsStatus", "model"];
const CLI = join(process.cwd(), "dist", "cli.js");

const CHECKPOINT_DEFAULTS = {
  iteration: 0, last_artifact: "", non_blocking: [], updated_at: "",
  resume_exec: null, units: [], review_legs: [], propose_attempts: 0,
  gate_failures: 0, finish_mode: null, flow_profile: "full", needs_uiux: false,
};

function argvFor(c: ParityCase): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cli-parity-"));
  mkdirSync(dir, { recursive: true });
  const subs: Record<string, string> = {};
  if (c.checkpoint !== undefined) {
    const p = join(dir, "cp.json");
    // Python 側是 Checkpoint(**case["checkpoint"]),欄位會補上 dataclass 預設值;
    // 這裡補同一份,否則 loadCheckpoint 會因缺欄位而拒收。
    writeFileSync(p, JSON.stringify({ ...CHECKPOINT_DEFAULTS, ...(c.checkpoint as object) }), "utf-8");
    subs["<CHECKPOINT>"] = p;
  }
  if (c.config !== undefined) {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify(c.config), "utf-8");
    subs["<CONFIG>"] = p;
  }
  if (c.config_absent === true) {
    subs["<CONFIG>"] = join(dir, "absent.json");
  }
  return (c.argv as string[]).map((a) => subs[a] ?? a);
}

function run(argv: string[]): { stdout: string; exit_code: number } {
  try {
    return { stdout: execFileSync("node", [CLI, ...argv], { encoding: "utf-8" }), exit_code: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", exit_code: err.status ?? 1 };
  }
}

for (const section of SECTIONS) {
  describe(`parity: cli ${section}`, () => {
    for (const c of parityCases("cli", section, SECTIONS)) {
      it(c.name, () => {
        const argv = c.argv as string[];
        const cmd = argv[0];
        // I5 guard: a fixture section for a command not yet in TS_COMMANDS
        // would run `node dist/cli.js <argv>`, which just delegates to
        // Python — asserting Python against Python, green on both sides,
        // while the TS implementation doesn't exist yet. Fail loudly instead
        // of passing vacuously; add the command to TS_COMMANDS first.
        expect(
          (TS_COMMANDS as readonly string[]).includes(cmd as string),
          `case ${c.name}: command ${JSON.stringify(cmd)} is not in TS_COMMANDS — this fixture `
          + "would silently assert Python against Python instead of exercising TypeScript",
        ).toBe(true);
        const { expect: want, throws } = resolveExpectation(c);
        expect(throws, "cli cases assert on exit codes, not exceptions").toBe(false);
        expectSubset(run(argvFor(c)), want!, c.name);
      });
    }
  });
}

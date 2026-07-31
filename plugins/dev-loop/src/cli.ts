#!/usr/bin/env node
import { loadCheckpoint } from "./checkpoint.js";
import { nextHint } from "./statemachine.js";

/**
 * status subcommand only (M1 proof point). Mirrors Python's `_cmd_status`
 * output format exactly, minus the deferred M2 pieces:
 *  - no --json flag
 *  - no config.json / gate_cmds sourcing (nextHint called without gateCmds)
 *  - no watcher-missing warning
 */
function cmdStatus(file: string): number {
  const cp = loadCheckpoint(file);
  const hint = nextHint(cp.phase, file, {
    units: cp.units as Array<{ id: string; status?: string }>,
    reviewLegs: cp.review_legs as Array<{ kind: string; status?: string }>,
    finishMode: cp.finish_mode,
    flowProfile: cp.flow_profile,
    needsUiux: cp.needs_uiux,
  });
  process.stdout.write(
    `phase=${cp.phase} iteration=${cp.iteration} change_id=${cp.change_id} branch=${cp.branch}\n`,
  );
  process.stdout.write(`${hint}\n`);
  if (cp.updated_at) {
    process.stdout.write(`updated_at=${cp.updated_at}\n`);
  }
  return 0;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === "status") {
    const i = rest.indexOf("--file");
    if (i === -1 || !rest[i + 1]) {
      process.stderr.write("status requires --file\n");
      return 2;
    }
    return cmdStatus(rest[i + 1]);
  }
  process.stderr.write(`unknown command: ${cmd ?? ""}\n`);
  return 2;
}

process.exit(main(process.argv.slice(2)));

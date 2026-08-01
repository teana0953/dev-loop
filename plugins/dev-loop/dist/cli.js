#!/usr/bin/env node

// src/cli.ts
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/jsonio.ts
import { readFileSync } from "node:fs";
function readJsonObject(path, label) {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object, got ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

// src/checkpoint.ts
var DEFAULTS = {
  iteration: 0,
  last_artifact: "",
  non_blocking: [],
  updated_at: "",
  resume_exec: null,
  units: [],
  review_legs: [],
  propose_attempts: 0,
  gate_failures: 0,
  finish_mode: null,
  flow_profile: "full",
  needs_uiux: false
};
function makeCheckpoint(partial) {
  return { ...DEFAULTS, ...partial };
}
var REQUIRED_CHECKPOINT_KEYS = ["phase", "change_id", "branch"];
var KNOWN_CHECKPOINT_KEYS = /* @__PURE__ */ new Set([
  ...REQUIRED_CHECKPOINT_KEYS,
  ...Object.keys(DEFAULTS)
]);
function loadCheckpoint(path) {
  const data = readJsonObject(path, "checkpoint");
  for (const key of Object.keys(data)) {
    if (!KNOWN_CHECKPOINT_KEYS.has(key)) {
      throw new Error(`checkpoint has unknown key ${JSON.stringify(key)}`);
    }
  }
  for (const key of REQUIRED_CHECKPOINT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`checkpoint missing required key ${JSON.stringify(key)}`);
    }
  }
  return makeCheckpoint(data);
}

// src/statemachine.ts
var DETERMINISTIC_HINTS = {
  proposal_review: (f) => `next: devloop proposal-review --file ${f} --report <pr.json>`,
  gate: (f) => `next: devloop gate --file ${f} --cmd "<test-cmd>" [--cmd "<lint-cmd>"]`,
  qa: (f) => `next: devloop qa --file ${f} --report <qa.json>`,
  review: (f) => `next: devloop review --file ${f} --from-legs`,
  merge: (f) => `next: devloop finish --file ${f} --config <config.json> --meta <meta.json> --followup <followup.md>`
};
var JUDGMENT_HINTS = {
  brainstorm: "next: dispatch brainstorming(\u7522\u51FA\u8A2D\u8A08\u6587\u4EF6,\u6279\u51C6\u5F8C propose)",
  propose: "next: dispatch propose(\u5EFA\u7ACB OpenSpec change,\u5B8C\u6210\u5F8C event --event propose_done)",
  apply: "next: dispatch apply(TDD \u5BE6\u4F5C tasks,\u5B8C\u6210\u5F8C event --event apply_done)",
  fix: "next: dispatch fix(\u8655\u7406 blocking \u9805,\u5B8C\u6210\u5F8C event --event fix_done)"
};
var TERMINAL_HINTS = {
  done: "next: (done)",
  escalated: "next: (escalated)\u4EBA\u5DE5\u5347\u7D1A\u5F8C\u7E8C\u8DD1:event --event human_resume_propose \u6216 human_resume_fix"
};
function nextHint(phase, checkpointPath, opts = {}) {
  const { units, reviewLegs, gateCmds, finishMode, flowProfile, needsUiux } = opts;
  if (phase === "qa" && flowProfile === "light" && !needsUiux) {
    return `next: devloop event --file ${checkpointPath} --event qa_skip`;
  }
  if (phase === "gate" && gateCmds && gateCmds.length) {
    return `next: devloop gate --file ${checkpointPath}`;
  }
  if (phase === "teardown") {
    const mode = finishMode || "<merge|pr>";
    return `next: devloop teardown --file ${checkpointPath} --repo . --mode ${mode}`;
  }
  if ((phase === "apply" || phase === "fix") && units) {
    const pending = units.filter((u) => u.status === "pending" || u.status === "in_progress").map((u) => u.id);
    if (pending.length) {
      return `next: units pending: ${pending.join(",")} -> devloop units-status --file ${checkpointPath}`;
    }
  }
  if (phase === "review" && reviewLegs) {
    const pendingLegs = reviewLegs.filter((l) => l.status !== "collected").map((l) => l.kind);
    if (pendingLegs.length) {
      return `next: legs pending: ${pendingLegs.join(",")} -> devloop leg-done --file ${checkpointPath} --kind <kind> --report <report.json>`;
    }
  }
  if (Object.hasOwn(TERMINAL_HINTS, phase)) {
    return TERMINAL_HINTS[phase];
  }
  if (Object.hasOwn(DETERMINISTIC_HINTS, phase)) {
    return DETERMINISTIC_HINTS[phase](checkpointPath);
  }
  if (Object.hasOwn(JUDGMENT_HINTS, phase)) {
    return JUDGMENT_HINTS[phase];
  }
  throw new Error(`no next hint for phase ${phase} (KeyError)`);
}

// src/cli.ts
var TS_COMMANDS = ["status"];
function delegateToPython(argv) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = process.env.PYTHONPATH;
  const proc = spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: existing ? `${root}${sep}${existing}` : root }
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.signal) {
    return 128 + (constants.signals[proc.signal] ?? 0);
  }
  return proc.status ?? 1;
}
function cmdStatus(file) {
  const cp = loadCheckpoint(file);
  const hint = nextHint(cp.phase, file, {
    units: cp.units,
    reviewLegs: cp.review_legs,
    finishMode: cp.finish_mode,
    flowProfile: cp.flow_profile,
    needsUiux: cp.needs_uiux
  });
  process.stdout.write(
    `phase=${cp.phase} iteration=${cp.iteration} change_id=${cp.change_id} branch=${cp.branch}
`
  );
  process.stdout.write(`${hint}
`);
  if (cp.updated_at) {
    process.stdout.write(`updated_at=${cp.updated_at}
`);
  }
  return 0;
}
function flag(rest, name) {
  const i = rest.indexOf(name);
  if (i === -1) {
    return void 0;
  }
  const value = rest[i + 1];
  return value === void 0 || value === "" ? void 0 : value;
}
function main(argv, deps = {}) {
  const delegate = deps.delegate ?? delegateToPython;
  const [cmd, ...rest] = argv;
  if (cmd === void 0 || !TS_COMMANDS.includes(cmd)) {
    return delegate(argv);
  }
  if (cmd === "status") {
    const file = flag(rest, "--file");
    if (file === void 0) {
      process.stderr.write("status requires --file\n");
      return 2;
    }
    return cmdStatus(file);
  }
  process.stderr.write(`unrouted command: ${cmd}
`);
  return 2;
}
function canon(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}
function samePath(a, b) {
  return canon(a) === canon(b);
}
var invokedPath = process.argv[1];
if (invokedPath !== void 0 && samePath(invokedPath, fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
export {
  TS_COMMANDS,
  main
};

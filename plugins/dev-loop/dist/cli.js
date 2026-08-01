#!/usr/bin/env node

// src/cli.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants } from "node:os";
import { dirname as dirname2, join as join2, resolve } from "node:path";
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
function pyGet(data, key, default_) {
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : default_;
}
function pyTruthy(value) {
  if (value === null || value === void 0 || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}
function pyIndex(data, key) {
  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    throw new Error(`KeyError: ${JSON.stringify(key)}`);
  }
  return data[key];
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

// src/openspec.ts
import { spawnSync } from "node:child_process";
var defaultRunner = (cmd) => {
  const [command, ...args] = cmd;
  const proc = spawnSync(command, args, { encoding: "utf8" });
  if (proc.error) {
    throw proc.error;
  }
  const code = proc.status ?? 1;
  return [code, (proc.stdout ?? "") + (proc.stderr ?? "")];
};
function run(cmd, runner = defaultRunner) {
  const [code, output] = runner(cmd);
  return { ok: code === 0, command: cmd, output };
}
function archiveChange(changeId, runner) {
  return run(["openspec", "archive", changeId, "--yes"], runner);
}

// src/housekeeping.ts
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  utimesSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
var KEEP_FILES = ["config.json", "watcher.pid"];
function archiveWorkfiles(checkpointPath, changeId) {
  const cpName = basename(checkpointPath);
  const root = dirname(checkpointPath);
  const dest = join(root, "archive", String(changeId));
  const keep = /* @__PURE__ */ new Set([...KEEP_FILES, cpName]);
  const archived = [];
  const names = readdirSync(root).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (const name of names) {
    const p = join(root, name);
    if (!statSync(p).isFile() || keep.has(name)) {
      continue;
    }
    mkdirSync(dest, { recursive: true });
    renameSync(p, join(dest, name));
    archived.push(name);
  }
  const meta = join(root, "changes", `${changeId}.json`);
  if (existsSync(meta)) {
    mkdirSync(dest, { recursive: true });
    renameSync(meta, join(dest, basename(meta)));
    archived.push(`changes/${basename(meta)}`);
  }
  if (existsSync(checkpointPath)) {
    mkdirSync(dest, { recursive: true });
    const target = join(dest, cpName);
    copyFileSync(checkpointPath, target);
    const st = statSync(checkpointPath);
    chmodSync(target, st.mode);
    utimesSync(target, st.atime, st.mtime);
    archived.push(`${cpName} (snapshot)`);
  }
  return archived;
}

// src/units.ts
var PENDING = ["pending", "in_progress"];
function pendingUnits(units) {
  return units.filter((u) => PENDING.includes(pyIndex(u, "status")));
}

// src/config.ts
import { existsSync as existsSync2 } from "node:fs";
function defaultConfig() {
  return {
    finish: null,
    auto_arm: true,
    gate_cmds: [],
    superpowers: null,
    auto_approve: false,
    model_profile: null,
    models: {}
  };
}
var VALID_MODEL_PROFILES = ["quality", "budget"];
var VALID_MODEL_STAGES = ["brainstorm", "apply", "review", "fix"];
var VALID_MODEL_ALIASES = ["sonnet", "opus", "haiku", "fable"];
function validateModelConfig(modelProfile, models) {
  if (modelProfile !== null && !VALID_MODEL_PROFILES.includes(modelProfile)) {
    throw new Error(
      `model_profile=${JSON.stringify(modelProfile)} (valid: ${VALID_MODEL_PROFILES.join("/")})`
    );
  }
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    throw new Error(`models must be a dict, got ${JSON.stringify(models)}`);
  }
  for (const [stage, alias] of Object.entries(models)) {
    if (!VALID_MODEL_STAGES.includes(stage)) {
      throw new Error(`models key ${JSON.stringify(stage)} (valid stages: ${VALID_MODEL_STAGES.join("/")})`);
    }
    if (!VALID_MODEL_ALIASES.includes(alias)) {
      throw new Error(
        `models[${JSON.stringify(stage)}]=${JSON.stringify(alias)} (valid aliases: ${VALID_MODEL_ALIASES.join("/")} \u2014 full model ids are rejected; aliases track the harness)`
      );
    }
  }
}
var BUDGET_ROUTES = { apply: "sonnet", fix: "sonnet" };
function resolveModel(stage, config) {
  if (!VALID_MODEL_STAGES.includes(stage)) {
    throw new Error(`stage ${JSON.stringify(stage)} (valid: ${VALID_MODEL_STAGES.join("/")})`);
  }
  if (Object.prototype.hasOwnProperty.call(config.models, stage)) {
    return config.models[stage];
  }
  if (config.model_profile === "budget") {
    return BUDGET_ROUTES[stage] ?? null;
  }
  return null;
}
function loadConfig(path) {
  if (!existsSync2(path)) {
    return defaultConfig();
  }
  const data = readJsonObject(path, "config");
  const modelProfile = pyGet(data, "model_profile", null);
  const models = pyGet(data, "models", {});
  validateModelConfig(modelProfile, models);
  return {
    finish: pyGet(data, "finish", null),
    // Python: bool(data.get("auto_arm", True)). Explicit `auto_arm: null`
    // is a *present* key, so Python's .get returns None (not True), and
    // bool(None) is False — the same value must come out here.
    // pyTruthy, not Boolean: JavaScript calls every object truthy while
    // Python calls empty containers falsy, so `{"auto_arm": []}` used to mean
    // watcher-OFF in Python and watcher-ON here, from the same file, with
    // neither side erroring.
    auto_arm: pyTruthy(pyGet(data, "auto_arm", true)),
    // Explicit `gate_cmds: null` must survive as null (Python's .get
    // returns the present None, not []), for validateGateCmds to reject.
    gate_cmds: pyGet(data, "gate_cmds", []),
    // superpowers: a non-boolean JSON value (e.g. "yes") passes through
    // unchanged at runtime despite the `boolean | null` type — intentional
    // Python parity (原始碼註解:非布林值原樣保留,消費端視為未設). Do not
    // "fix" this into a Boolean() coercion; that would break parity.
    superpowers: pyGet(data, "superpowers", null),
    // Python: (data.get("auto_approve", False) is True). Present-null and
    // absent both yield None/False respectively, both !== True -> False;
    // pyGet + strict === true reproduces this without special-casing.
    auto_approve: pyGet(data, "auto_approve", false) === true,
    model_profile: modelProfile,
    // Past validateModelConfig, models is guaranteed to be a non-null,
    // non-array object (or it would have thrown above).
    models
  };
}

// src/cli.ts
var TS_COMMANDS = ["status", "archive", "units-status", "model"];
function delegateToPython(argv) {
  const root = dirname2(dirname2(fileURLToPath(import.meta.url)));
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = process.env.PYTHONPATH;
  const proc = spawnSync2("python3", ["-m", "devloop.cli", ...argv], {
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
function cmdArchive(file, archive) {
  const cp = loadCheckpoint(file);
  const result = archive(cp.change_id);
  process.stdout.write(`${result.output}
`);
  if (!result.ok) {
    return 1;
  }
  try {
    const archived = archiveWorkfiles(file, cp.change_id);
    process.stdout.write(
      `archived workfiles: ${archived.length} -> ${join2(dirname2(file), "archive", cp.change_id)}
`
    );
  } catch (exc) {
    process.stderr.write(`warning: workfile archive failed: ${String(exc)}
`);
  }
  return 0;
}
function cmdUnitsStatus(file) {
  const cp = loadCheckpoint(file);
  const units = cp.units;
  for (const u of units) {
    process.stdout.write(`${u.id} ${u.status}
`);
  }
  const pend = pendingUnits(units).map((u) => u.id);
  process.stdout.write(`pending: ${pend.length > 0 ? pend.join(",") : "-"}
`);
  return 0;
}
function cmdModel(stage, configPath) {
  let alias;
  try {
    alias = resolveModel(stage, loadConfig(configPath));
  } catch (exc) {
    process.stderr.write(`error: ${exc instanceof Error ? exc.message : String(exc)}
`);
    return 2;
  }
  process.stdout.write(`${alias ?? "inherit"}
`);
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
  if (cmd === "archive") {
    const file = flag(rest, "--file");
    if (file === void 0) {
      process.stderr.write("archive requires --file\n");
      return 2;
    }
    return cmdArchive(file, deps.archiveChange ?? archiveChange);
  }
  if (cmd === "units-status") {
    const file = flag(rest, "--file");
    if (file === void 0) {
      process.stderr.write("units-status requires --file\n");
      return 2;
    }
    return cmdUnitsStatus(file);
  }
  if (cmd === "model") {
    const stage = flag(rest, "--stage");
    if (stage === void 0) {
      process.stderr.write("model requires --stage\n");
      return 2;
    }
    return cmdModel(stage, flag(rest, "--config") ?? ".devloop/config.json");
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

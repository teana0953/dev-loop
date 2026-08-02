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
    const st = statSync(p, { throwIfNoEntry: false });
    if (st === void 0 || !st.isFile() || keep.has(name)) {
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
var TS_COMMANDS = ["archive", "units-status", "model"];
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
function cmdArchive(file, archive, sweep) {
  const cp = loadCheckpoint(file);
  const result = archive(cp.change_id);
  process.stdout.write(`${result.output}
`);
  if (!result.ok) {
    return 1;
  }
  try {
    const archived = sweep(file, cp.change_id);
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
  for (const raw of units) {
    const u = raw;
    process.stdout.write(`${pyIndex(u, "id")} ${pyIndex(u, "status")}
`);
  }
  const pend = pendingUnits(units).map((raw) => pyIndex(raw, "id"));
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
function parseArgs(rest, known) {
  const values = /* @__PURE__ */ new Map();
  const consumed = new Array(rest.length).fill(false);
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (known.includes(tok)) {
      consumed[i] = true;
      if (i + 1 < rest.length) {
        values.set(tok, rest[i + 1]);
        consumed[i + 1] = true;
        i++;
      }
    }
  }
  const unknown = rest.filter((_, i) => !consumed[i]);
  return { values, unknown };
}
function requiredFlag(values, name) {
  const value = values.get(name);
  return value === void 0 || value === "" ? void 0 : value;
}
function rawFlag(values, name) {
  return values.get(name);
}
async function main(argv, deps = {}) {
  const delegate = deps.delegate ?? delegateToPython;
  const [cmd, ...rest] = argv;
  if (cmd === void 0 || !TS_COMMANDS.includes(cmd)) {
    return delegate(argv);
  }
  if (cmd === "archive") {
    const { values, unknown } = parseArgs(rest, ["--file"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const file = requiredFlag(values, "--file");
    if (file === void 0) {
      process.stderr.write("archive requires --file\n");
      return 2;
    }
    return cmdArchive(
      file,
      deps.archiveChange ?? archiveChange,
      deps.archiveWorkfiles ?? archiveWorkfiles
    );
  }
  if (cmd === "units-status") {
    const { values, unknown } = parseArgs(rest, ["--file"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const file = requiredFlag(values, "--file");
    if (file === void 0) {
      process.stderr.write("units-status requires --file\n");
      return 2;
    }
    return cmdUnitsStatus(file);
  }
  if (cmd === "model") {
    const { values, unknown } = parseArgs(rest, ["--stage", "--config"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const stage = requiredFlag(values, "--stage");
    if (stage === void 0) {
      process.stderr.write("model requires --stage\n");
      return 2;
    }
    return cmdModel(stage, rawFlag(values, "--config") ?? ".devloop/config.json");
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
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String(err.stack ?? err)}
`);
      process.exit(1);
    }
  );
}
export {
  TS_COMMANDS,
  main
};

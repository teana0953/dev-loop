#!/usr/bin/env node

// src/cli.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants } from "node:os";
import { dirname as dirname5, join as join4, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/checkpoint.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
function saveCheckpoint(cp, path) {
  cp.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cp, null, 2), "utf-8");
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

// src/history.ts
import { writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2, join } from "node:path";
function historyPath(checkpointPath) {
  const checkpointDir = dirname2(checkpointPath);
  return join(checkpointDir, "history.jsonl");
}
function appendHistory(checkpointPath, event, fromPhase, toPhase, iteration) {
  const entry = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    event,
    from: fromPhase,
    to: toPhase,
    iteration
  };
  const histPath = historyPath(checkpointPath);
  const histDir = dirname2(histPath);
  mkdirSync2(histDir, { recursive: true });
  writeFileSync2(histPath, JSON.stringify(entry) + "\n", { flag: "a", encoding: "utf-8" });
}

// src/statemachine.ts
var APPLY_DONE = "apply_done";
var PROPOSE_CLEAN = "propose_clean";
var PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal";
var PROPOSE_BLOCKING_DESIGN = "propose_blocking_design";
var GATE_PASS = "gate_pass";
var GATE_FAIL = "gate_fail";
var QA_PASS = "qa_pass";
var QA_FAIL = "qa_fail";
var QA_SKIP = "qa_skip";
var REVIEW_NO_BLOCKING = "review_no_blocking";
var REVIEW_BLOCKING_CODE = "review_blocking_code";
var REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal";
var FIX_DONE = "fix_done";
var FINISH_DONE = "finish_done";
var PROPOSE_DONE = "propose_done";
var TEARDOWN_DONE = "teardown_done";
var PROPOSE_RETRY_EXCEEDED = "propose_retry_exceeded";
var GATE_RETRY_EXCEEDED = "gate_retry_exceeded";
var HUMAN_RESUME_PROPOSE = "human_resume_propose";
var HUMAN_RESUME_FIX = "human_resume_fix";
var DEFAULT_MAX_ITERATIONS = 3;
var InvalidTransition = class extends Error {
};
function transition(phase, iteration, event, maxIterations = DEFAULT_MAX_ITERATIONS) {
  if (phase === "proposal_review" && event === PROPOSE_CLEAN) {
    return ["apply", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_PROPOSAL) {
    return ["propose", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_DESIGN) {
    return ["escalated", iteration];
  }
  if (phase === "apply" && event === APPLY_DONE) {
    return ["gate", iteration];
  }
  if (phase === "gate" && event === GATE_PASS) {
    const newIteration = iteration + 1;
    if (newIteration > maxIterations) {
      return ["escalated", newIteration];
    }
    return ["qa", newIteration];
  }
  if (phase === "qa" && event === QA_PASS) {
    return ["review", iteration];
  }
  if (phase === "qa" && event === QA_SKIP) {
    return ["review", iteration];
  }
  if (phase === "qa" && event === QA_FAIL) {
    return ["fix", iteration];
  }
  if (phase === "gate" && event === GATE_FAIL) {
    return ["fix", iteration];
  }
  if (phase === "review" && event === REVIEW_NO_BLOCKING) {
    return ["merge", iteration];
  }
  if (phase === "review" && event === REVIEW_BLOCKING_CODE) {
    return ["fix", iteration];
  }
  if (phase === "review" && event === REVIEW_BLOCKING_PROPOSAL) {
    return ["propose", iteration];
  }
  if (phase === "fix" && event === FIX_DONE) {
    return ["gate", iteration];
  }
  if (phase === "merge" && event === FINISH_DONE) {
    return ["teardown", iteration];
  }
  if (phase === "teardown" && event === TEARDOWN_DONE) {
    return ["done", iteration];
  }
  if (phase === "propose" && event === PROPOSE_DONE) {
    return ["proposal_review", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_RETRY_EXCEEDED) {
    return ["escalated", iteration];
  }
  if (phase === "gate" && event === GATE_RETRY_EXCEEDED) {
    return ["escalated", iteration];
  }
  if (phase === "escalated" && event === HUMAN_RESUME_PROPOSE) {
    return ["propose", iteration];
  }
  if (phase === "escalated" && event === HUMAN_RESUME_FIX) {
    return ["fix", iteration];
  }
  throw new InvalidTransition(`no transition from '${phase}' on '${event}'`);
}

// src/watcher.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname3, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/adapter.ts
var DEFAULT_HEARTBEAT = 1800;

// src/config.ts
import { existsSync } from "node:fs";
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
  if (!existsSync(path)) {
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

// src/pystr.ts
var PY_STR_WS = "\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var PY_STR_STRIP = new RegExp(`^[${PY_STR_WS}]+|[${PY_STR_WS}]+$`, "g");
function pyStrip(s) {
  return s.replace(PY_STR_STRIP, "");
}
var PY_INT_WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var PY_INT_STRIP = new RegExp(`^[${PY_INT_WS}]+|[${PY_INT_WS}]+$`, "g");
var INT_PATTERN = /^[+-]?\d(?:_?\d)*$/;
function pyParseInt(s) {
  const trimmed = s.replace(PY_INT_STRIP, "");
  if (!INT_PATTERN.test(trimmed)) {
    return null;
  }
  return Number(trimmed.replace(/_/g, ""));
}

// src/shlex.ts
var SAFE = /^[a-zA-Z0-9_@%+=:,./-]+$/;
var WHITESPACE = " 	\r\n";
function shlexQuote(s) {
  if (s === "") {
    return "''";
  }
  if (SAFE.test(s)) {
    return s;
  }
  return "'" + s.replace(/'/g, `'"'"'`) + "'";
}
function shlexJoin(parts) {
  return parts.map(shlexQuote).join(" ");
}
function shlexSplit(s) {
  const out = [];
  let cur = "";
  let started = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (WHITESPACE.includes(c)) {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
      i += 1;
      continue;
    }
    started = true;
    if (c === "'") {
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) {
        throw new Error("No closing quotation");
      }
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      let closed = false;
      while (i < s.length) {
        const d = s[i];
        if (d === "\\" && i + 1 < s.length && (s[i + 1] === '"' || s[i + 1] === "\\")) {
          cur += s[i + 1];
          i += 2;
          continue;
        }
        if (d === '"') {
          closed = true;
          i += 1;
          break;
        }
        cur += d;
        i += 1;
      }
      if (!closed) {
        throw new Error("No closing quotation");
      }
      continue;
    }
    if (c === "\\") {
      if (i + 1 < s.length) {
        cur += s[i + 1];
        i += 2;
      } else {
        throw new Error("No escaped character");
      }
      continue;
    }
    cur += c;
    i += 1;
  }
  if (started) {
    out.push(cur);
  }
  return out;
}

// src/watcher.ts
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    const code = e.code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw e;
  }
  return true;
}
function watcherPidPath(checkpointPath) {
  return join2(dirname3(checkpointPath), "watcher.pid");
}
function watcherLogPath(checkpointPath) {
  return join2(dirname3(checkpointPath), "watcher-log.jsonl");
}
function watcherState(checkpointPath) {
  const pidPath = watcherPidPath(checkpointPath);
  if (!existsSync2(pidPath)) {
    return ["absent", null];
  }
  const pid = pyParseInt(pyStrip(readFileSync2(pidPath, "utf-8")));
  if (pid === null) {
    return ["absent", null];
  }
  return pidAlive(pid) ? ["running", pid] : ["dead", pid];
}
function spawnWatcher(execCommand, heartbeat, logPath) {
  const pluginRoot = dirname3(dirname3(fileURLToPath(import.meta.url)));
  const cli = join2(pluginRoot, "dist", "cli.js");
  const argv = [
    cli,
    "watch",
    "--exec",
    shlexJoin(execCommand),
    "--heartbeat",
    String(heartbeat)
  ];
  if (logPath) {
    argv.push("--log", logPath);
  }
  const proc = spawn(process.execPath, argv, { detached: true, stdio: "ignore" });
  proc.unref();
  if (proc.pid === void 0) {
    throw new Error("failed to spawn watcher: no pid");
  }
  return proc.pid;
}
function ensureArmed(checkpointPath, opts = {}) {
  const heartbeat = opts.heartbeat ?? DEFAULT_HEARTBEAT;
  const cp = loadCheckpoint(checkpointPath);
  const override = opts.execOverride;
  const execStr = pyTruthy(override) ? override : cp.resume_exec;
  if (!pyTruthy(execStr)) {
    return ["skipped", null];
  }
  const [state, pid] = watcherState(checkpointPath);
  if (state === "running") {
    return ["already", pid];
  }
  if (typeof execStr !== "string") {
    throw new TypeError(
      `resume_exec must be a string, got ${Array.isArray(execStr) ? "array" : typeof execStr}`
    );
  }
  const newPid = spawnWatcher(
    shlexSplit(execStr),
    heartbeat,
    watcherLogPath(checkpointPath)
  );
  const pidPath = watcherPidPath(checkpointPath);
  mkdirSync3(dirname3(pidPath), { recursive: true });
  writeFileSync3(pidPath, String(newPid), "utf-8");
  return ["armed", newPid];
}
function ensureArmedAfterSave(cp, file) {
  if (!pyTruthy(cp.resume_exec)) {
    return;
  }
  if (cp.phase === "done") {
    return;
  }
  const config = loadConfig(join2(dirname3(file), "config.json"));
  if (!config.auto_arm) {
    return;
  }
  try {
    ensureArmed(file);
  } catch (exc) {
    process.stderr.write(`warning: auto-arm failed: ${String(exc.message)}
`);
  }
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
  existsSync as existsSync3,
  mkdirSync as mkdirSync4,
  readdirSync,
  renameSync,
  statSync,
  utimesSync
} from "node:fs";
import { basename, dirname as dirname4, join as join3 } from "node:path";
var KEEP_FILES = ["config.json", "watcher.pid"];
function archiveWorkfiles(checkpointPath, changeId) {
  const cpName = basename(checkpointPath);
  const root = dirname4(checkpointPath);
  const dest = join3(root, "archive", String(changeId));
  const keep = /* @__PURE__ */ new Set([...KEEP_FILES, cpName]);
  const archived = [];
  const names = readdirSync(root).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (const name of names) {
    const p = join3(root, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (st === void 0 || !st.isFile() || keep.has(name)) {
      continue;
    }
    mkdirSync4(dest, { recursive: true });
    renameSync(p, join3(dest, name));
    archived.push(name);
  }
  const meta = join3(root, "changes", `${changeId}.json`);
  if (existsSync3(meta)) {
    mkdirSync4(dest, { recursive: true });
    renameSync(meta, join3(dest, basename(meta)));
    archived.push(`changes/${basename(meta)}`);
  }
  if (existsSync3(checkpointPath)) {
    mkdirSync4(dest, { recursive: true });
    const target = join3(dest, cpName);
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

// src/cli.ts
var TS_COMMANDS = ["archive", "units-status", "model", "event"];
function delegateToPython(argv) {
  const root = dirname5(dirname5(fileURLToPath2(import.meta.url)));
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
      `archived workfiles: ${archived.length} -> ${join4(dirname5(file), "archive", cp.change_id)}
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
function saveWithHistory(cp, file, event, fromPhase) {
  saveCheckpoint(cp, file);
  try {
    appendHistory(file, event, fromPhase ?? "", cp.phase, cp.iteration);
  } catch (exc) {
    process.stderr.write(`warning: history append failed: ${String(exc.message)}
`);
  }
  ensureArmedAfterSave(cp, file);
}
function applyEvent(cp, event, maxIterations) {
  const [newPhase, newIteration] = transition(cp.phase, cp.iteration, event, maxIterations);
  cp.phase = newPhase;
  cp.iteration = newIteration;
  return cp;
}
function pyFormat(value) {
  if (value === true) {
    return "True";
  }
  if (value === false) {
    return "False";
  }
  if (value === null || value === void 0) {
    return "None";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}
function cmdEvent(file, event, max, finishMode) {
  const cp = loadCheckpoint(file);
  if (event === QA_SKIP && !(cp.flow_profile === "light" && !pyTruthy(cp.needs_uiux))) {
    process.stderr.write(
      `error: qa_skip requires flow_profile=light and needs_uiux=false (got ${pyFormat(cp.flow_profile)}/${pyFormat(cp.needs_uiux)})
`
    );
    return 2;
  }
  const fromPhase = cp.phase;
  applyEvent(cp, event, max);
  if (event === HUMAN_RESUME_PROPOSE || event === HUMAN_RESUME_FIX) {
    cp.iteration = 0;
    cp.propose_attempts = 0;
    cp.gate_failures = 0;
  }
  if (finishMode !== null) {
    cp.finish_mode = finishMode;
  }
  saveWithHistory(cp, file, event, fromPhase);
  process.stdout.write(`phase=${cp.phase} iteration=${cp.iteration}
`);
  return 0;
}
function looksLikeFlag(tok) {
  if (!tok.startsWith("-") || tok === "-") {
    return false;
  }
  if (/^-\d+$/.test(tok) || /^-\d*\.\d+$/.test(tok)) {
    return false;
  }
  return !tok.includes(" ");
}
function resolveFlagName(name, known) {
  if (known.includes(name)) {
    return { resolved: name };
  }
  const matches = known.filter((k) => k.startsWith(name));
  if (matches.length === 1) {
    return { resolved: matches[0] };
  }
  if (matches.length > 1) {
    return { ambiguous: matches };
  }
  return null;
}
function parseArgs(rest, known) {
  const values = /* @__PURE__ */ new Map();
  const unknown = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!tok.startsWith("--") || tok === "--") {
      unknown.push(tok);
      continue;
    }
    const eq = tok.indexOf("=");
    const name = eq === -1 ? tok : tok.slice(0, eq);
    const match = resolveFlagName(name, known);
    if (match === null) {
      unknown.push(tok);
      continue;
    }
    if ("ambiguous" in match) {
      return {
        values,
        unknown,
        error: `ambiguous option: ${name} could match ${match.ambiguous.join(", ")}`
      };
    }
    if (eq !== -1) {
      values.set(match.resolved, tok.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next === void 0 || looksLikeFlag(next)) {
      return {
        values,
        unknown,
        error: `argument ${match.resolved}: expected one argument`
      };
    }
    values.set(match.resolved, next);
    i += 1;
  }
  return { values, unknown, error: null };
}
function rawFlag(values, name) {
  return values.get(name);
}
function parseIntFlag(values, name, fallback) {
  const raw = rawFlag(values, name);
  if (raw === void 0) {
    return fallback;
  }
  const parsed = pyParseInt(raw);
  if (parsed === null) {
    process.stderr.write(`error: argument ${name}: invalid int value: '${raw}'
`);
    return null;
  }
  return parsed;
}
async function main(argv, deps = {}) {
  try {
    return await dispatch(argv, deps);
  } catch (exc) {
    if (exc instanceof InvalidTransition) {
      process.stderr.write(`error: ${exc.message}
`);
      return 2;
    }
    throw exc;
  }
}
async function dispatch(argv, deps) {
  const delegate = deps.delegate ?? delegateToPython;
  const [cmd, ...rest] = argv;
  if (cmd === void 0 || !TS_COMMANDS.includes(cmd)) {
    return delegate(argv);
  }
  if (cmd === "archive") {
    const { values, unknown, error } = parseArgs(rest, ["--file"]);
    if (error !== null) {
      process.stderr.write(`error: ${error}
`);
      return 2;
    }
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const file = rawFlag(values, "--file");
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
    const { values, unknown, error } = parseArgs(rest, ["--file"]);
    if (error !== null) {
      process.stderr.write(`error: ${error}
`);
      return 2;
    }
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const file = rawFlag(values, "--file");
    if (file === void 0) {
      process.stderr.write("units-status requires --file\n");
      return 2;
    }
    return cmdUnitsStatus(file);
  }
  if (cmd === "event") {
    const { values, unknown, error } = parseArgs(rest, ["--file", "--event", "--max", "--finish-mode"]);
    if (error !== null) {
      process.stderr.write(`error: ${error}
`);
      return 2;
    }
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const file = rawFlag(values, "--file");
    const event = rawFlag(values, "--event");
    if (file === void 0 || event === void 0) {
      process.stderr.write("event requires --file and --event\n");
      return 2;
    }
    const max = parseIntFlag(values, "--max", DEFAULT_MAX_ITERATIONS);
    if (max === null) {
      return 2;
    }
    const finishMode = rawFlag(values, "--finish-mode") ?? null;
    if (finishMode !== null && finishMode !== "merge" && finishMode !== "pr") {
      process.stderr.write(
        `error: argument --finish-mode: invalid choice: '${finishMode}' (choose from 'merge', 'pr')
`
      );
      return 2;
    }
    return cmdEvent(file, event, max, finishMode);
  }
  if (cmd === "model") {
    const { values, unknown, error } = parseArgs(rest, ["--stage", "--config"]);
    if (error !== null) {
      process.stderr.write(`error: ${error}
`);
      return 2;
    }
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}
`);
      return 2;
    }
    const stage = rawFlag(values, "--stage");
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
if (invokedPath !== void 0 && samePath(invokedPath, fileURLToPath2(import.meta.url))) {
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

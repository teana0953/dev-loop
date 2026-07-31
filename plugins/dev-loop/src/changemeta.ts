import { existsSync } from "node:fs";
import { readJsonObject, pyGet } from "./jsonio.js";

export interface ChangeMeta {
  parallel_groups: unknown[];
  needs_uiux: boolean;
  finish: string | null;
  // 流程檔位:full(預設)/ light。start 時凍結進 checkpoint,此後引擎只讀 checkpoint。
  flow_profile: string | null;
}

function defaultChangeMeta(): ChangeMeta {
  return {
    parallel_groups: [],
    needs_uiux: false,
    finish: null,
    flow_profile: null,
  };
}

export const VALID_FLOW_PROFILES = ["full", "light"] as const;

export function loadChangeMeta(path: string): ChangeMeta {
  if (!existsSync(path)) {
    return defaultChangeMeta();
  }
  const data = readJsonObject(path, "change meta");
  // pyGet, not `??`: Python's data.get(key, default) substitutes default
  // only when the key is absent, not on an explicit JSON null. flow_profile
  // and finish both default to None in Python, so this makes no observable
  // difference for them, but pyGet is used uniformly (see F1 in config.ts
  // for the fields where it does matter).
  const flowProfile = pyGet(data, "flow_profile", null) as string | null;
  // 壞設定在 start 就炸(同 config 的 model 驗證精神),不是跑到 qa 才發現
  if (flowProfile !== null && !(VALID_FLOW_PROFILES as readonly string[]).includes(flowProfile)) {
    throw new Error(`flow_profile=${JSON.stringify(flowProfile)} (valid: ${VALID_FLOW_PROFILES.join("/")})`);
  }
  // parallel_groups drives isSerial(), which decides serial vs. fan-out
  // parallel execution — a malformed value here must not silently pick a
  // branch. Absent key -> default []. Present but not an array (object,
  // number, explicit null, ...) -> fail fast at load time, same fail-fast
  // style as the flow_profile check above. This is intentionally stricter
  // than Python: Python's load_change_meta lets a non-list value through
  // and only blows up later, downstream, inside is_serial's len() call
  // (a dict happens to have a len() so it's accepted there; a number or
  // None raises TypeError). Validating here instead means the loop fails
  // at start, not an hour later when the apply phase branches on it.
  const rawParallelGroups = data.parallel_groups;
  if (rawParallelGroups !== undefined && !Array.isArray(rawParallelGroups)) {
    throw new Error(`parallel_groups must be a list, got ${JSON.stringify(rawParallelGroups)}`);
  }
  return {
    parallel_groups: rawParallelGroups ?? [],
    // needs_uiux: a non-boolean JSON value (e.g. []) passes through
    // unchanged at runtime despite the `boolean` type — intentional Python
    // parity (data.get("needs_uiux", False) returns the raw value with no
    // coercion). Do not "fix" this into a Boolean() coercion; that would
    // break parity (e.g. `[]` is falsy in Python but Boolean([]) is true).
    // pyGet (not `??`) also matters here specifically: explicit
    // `needs_uiux: null` is a *present* key, so Python's .get returns None,
    // not False -- `?? false` would wrongly turn that into false.
    needs_uiux: pyGet(data, "needs_uiux", false) as boolean,
    finish: pyGet(data, "finish", null) as string | null,
    flow_profile: flowProfile,
  };
}

export function isSerial(meta: ChangeMeta): boolean {
  return meta.parallel_groups.length <= 1;
}

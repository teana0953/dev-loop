import { existsSync, readFileSync } from "node:fs";

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
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  // Match Python's data.get(...) raising AttributeError on a non-dict root
  // (array/string/number/null): a truncated/corrupt file must not silently
  // fall back to all-defaults.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`change meta must be a JSON object, got ${JSON.stringify(parsed)}`);
  }
  const data = parsed as Record<string, unknown>;
  const flowProfile = (data.flow_profile as string | null | undefined) ?? null;
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
    needs_uiux: (data.needs_uiux ?? false) as boolean,
    finish: (data.finish as string | null | undefined) ?? null,
    flow_profile: flowProfile,
  };
}

export function isSerial(meta: ChangeMeta): boolean {
  return meta.parallel_groups.length <= 1;
}

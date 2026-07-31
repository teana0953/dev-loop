import { readFileSync } from "node:fs";

/**
 * Parse `path` as JSON and require the root to be a plain object (not an
 * array/string/number/null). Mirrors what Python gets "for free": calling
 * `.get(...)` on a non-dict root (or `cls(**data)` on one) raises
 * immediately (AttributeError / TypeError). A raw `JSON.parse(...) as T`
 * cast would instead let a truncated/corrupt file (root `[1,2,3]`,
 * `"oops"`, `42`, `null`) sail through silently, making a corrupt file
 * indistinguishable from "file absent" with zero diagnostic — exactly the
 * failure mode this helper exists to prevent. `label` names the caller
 * (e.g. "config", "change meta", "checkpoint") for the error message.
 */
export function readJsonObject(path: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object, got ${JSON.stringify(parsed)}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Python `dict.get(key, default)` parity: substitutes `default` only when
 * `key` is absent from `data`. Unlike `data[key] ?? default` /
 * `data.key ?? default`, an explicit JSON `null` value is returned as-is,
 * not replaced by `default` — matching Python's dict semantics exactly.
 * `{}.get(k, d)` and `{k: None}.get(k, d)` differ (default vs. None);
 * `??`/`?.` conflate them, which is the class of bug this helper fixes.
 */
export function pyGet<T>(data: Record<string, unknown>, key: string, default_: T): T {
  return Object.prototype.hasOwnProperty.call(data, key) ? (data[key] as T) : default_;
}

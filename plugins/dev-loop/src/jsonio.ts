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

/**
 * Python `bool(value)` parity for values that came out of JSON.
 *
 * `Boolean(...)` is NOT a port of `bool(...)`: JavaScript calls every object
 * truthy, Python calls empty containers falsy. So `Boolean([])` is `true`
 * while `bool([])` is `False` — same config file, opposite runtime behavior,
 * neither side erroring. That is the same class of defect as `??` standing in
 * for `dict.get`, and it is why this helper exists.
 *
 * JSON yields exactly six falsy shapes under Python's rules: `null`, `false`,
 * `0` (and `-0`/`0.0`), `""`, `[]`, and `{}`. Everything else — including
 * `"0"`, `"false"`, and `[0]` — is truthy in both languages.
 */
export function pyTruthy(value: unknown): boolean {
  // `undefined` is not a JSON shape — it is here only so a caller that reaches
  // for a missing key without going through pyGet gets Python's `bool(None)`
  // rather than a surprise.
  if (value === null || value === undefined || value === false) return false;
  // `value !== 0` also covers -0 (falsy in both languages) and NaN, which
  // JSON cannot produce but which Python considers truthy — so leaving it
  // truthy here matches Python rather than JavaScript.
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Python 的 `obj.get(key, default)`,含「obj 不是 dict 就 AttributeError」那一半。
 *
 * `pyGet` 的參數已經是 Record,呼叫端保證過型別;這個版本用在「JSON 解出來
 * 的東西可能是任何型別」的地方——`json.loads("42")` 是合法的,而對它呼叫
 * .get 在 Python 會炸,靜默回 undefined 是分歧不是容錯。
 *
 * 實測 `watcher-status`,watcher-log.jsonl 最後一行分別是 `42` / `["a"]` /
 * `"hi"`(其餘輸出略):
 *   PY -> AttributeError: 'int'/'list'/'str' object has no attribute 'get',
 *         exit 1,而且 "watcher: ..." 與 "resume_exec: ..." 兩行已經印出來了
 *   TS(用 obj.ts)-> 印 "last attempt: ? exit=? " 然後 exit 0/1,壞掉的 log
 *         被當成一筆內容不明的正常紀錄
 * 也就是說字串會被擋下來(typeof "string" 不是 "object"),這是刻意的:
 * Python 對 str 一樣沒有 .get。
 */
export function pyDictGet(obj: unknown, key: string, fallback: unknown): unknown {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError(
      `AttributeError: '${obj === null ? "NoneType" : typeof obj}' object has no attribute 'get'`);
  }
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, unknown>)[key]
    : fallback;
}

/**
 * Python `data[key]` parity: a missing key raises, it does not yield
 * `undefined`. `obj.k` / `obj["k"]` in TypeScript quietly produce
 * `undefined`, which then flows onward as an `undefined` id or a status that
 * matches no branch — the same silent-wrong-answer shape as `??` standing in
 * for `dict.get`. Use this wherever the Python being ported subscripts a dict
 * directly; use `pyGet` where it calls `.get(key, default)`.
 */
export function pyIndex<T>(data: Record<string, unknown>, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    throw new Error(`KeyError: ${JSON.stringify(key)}`);
  }
  return data[key] as T;
}

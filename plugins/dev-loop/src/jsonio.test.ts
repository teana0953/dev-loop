import { describe, it, expect } from "vitest";
import { pyDictGet, pyTruthy } from "./jsonio.js";

/**
 * `pyDictGet` 是 `obj.get(key, default)` 的完整移植,包含「obj 不是 dict 就
 * AttributeError」那一半。實測 Python(`json.loads(line).get("ts", "?")`):
 *   {"ts": "T"} -> 'T'      {} -> '?'      {"ts": None} -> None(不是 '?')
 *   42   -> AttributeError: 'int' object has no attribute 'get'
 *   ["a"]-> AttributeError: 'list' object has no attribute 'get'
 *   "hi" -> AttributeError: 'str' object has no attribute 'get'
 *   null -> AttributeError: 'NoneType' object has no attribute 'get'
 */
describe("pyDictGet", () => {
  it("returns the value when the key is present", () => {
    expect(pyDictGet({ ts: "T" }, "ts", "?")).toBe("T");
  });

  it("returns the fallback only when the key is absent, not when it is null", () => {
    // `obj[k] ?? d` 會把這兩種情況混為一談,`.get` 不會。
    expect(pyDictGet({}, "ts", "?")).toBe("?");
    expect(pyDictGet({ ts: null }, "ts", "?")).toBe(null);
  });

  it("throws for a JSON array, which typeof calls an object", () => {
    // 這是 `Array.isArray` 那一半守衛存在的唯一理由:`typeof ["a"] === "object"`,
    // 少了它,一行 `["a"]` 的 watcher log 在 Python 會炸、在 TS 會安靜地印 "?"。
    expect(() => pyDictGet(["a"], "ts", "?")).toThrow(TypeError);
    expect(() => pyDictGet([], "ts", "?")).toThrow(/no attribute 'get'/);
  });

  it("throws for the scalar JSON roots", () => {
    expect(() => pyDictGet(42, "ts", "?")).toThrow(/no attribute 'get'/);
    expect(() => pyDictGet("hi", "ts", "?")).toThrow(/no attribute 'get'/);
    expect(() => pyDictGet(true, "ts", "?")).toThrow(/no attribute 'get'/);
    expect(() => pyDictGet(null, "ts", "?")).toThrow(/'NoneType' object/);
  });
});

describe("pyTruthy", () => {
  // Python 的 bool():空容器為假。JavaScript 的 Boolean():所有物件為真。
  // 這五個值是兩者分岔的地方,也是這個 helper 存在的理由。
  it("treats empty containers as falsy, unlike Boolean()", () => {
    expect(pyTruthy([])).toBe(false);
    expect(pyTruthy({})).toBe(false);
    expect(Boolean([])).toBe(true);
    expect(Boolean({})).toBe(true);
  });
  it("treats the other JSON falsy shapes as falsy", () => {
    expect(pyTruthy(null)).toBe(false);
    expect(pyTruthy(false)).toBe(false);
    expect(pyTruthy(0)).toBe(false);
    expect(pyTruthy(-0)).toBe(false);
    expect(pyTruthy("")).toBe(false);
  });
  it("treats non-empty containers as truthy even when their contents are falsy", () => {
    expect(pyTruthy([0])).toBe(true);
    expect(pyTruthy([[]])).toBe(true);
    expect(pyTruthy({ a: 0 })).toBe(true);
  });
  it("treats non-empty strings as truthy regardless of content", () => {
    expect(pyTruthy("0")).toBe(true);
    expect(pyTruthy("false")).toBe(true);
    expect(pyTruthy("no")).toBe(true);
  });
  it("treats non-zero numbers as truthy", () => {
    expect(pyTruthy(1)).toBe(true);
    expect(pyTruthy(-1)).toBe(true);
    expect(pyTruthy(0.5)).toBe(true);
  });
});

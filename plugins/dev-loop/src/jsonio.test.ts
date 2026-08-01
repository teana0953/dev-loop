import { describe, it, expect } from "vitest";
import { pyTruthy } from "./jsonio.js";

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

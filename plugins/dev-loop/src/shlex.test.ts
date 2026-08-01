import { describe, it, expect } from "vitest";
import { shlexSplit, shlexJoin, shlexQuote } from "./shlex.js";

describe("shlexQuote", () => {
  it("quotes non-ascii even though it contains no whitespace", () => {
    // 憑直覺寫的實作多半只對含空白的字串加引號。往返仍然成立,
    // 但 join 的輸出與 Python 不同字——而 join 的輸出會進 argv。
    expect(shlexQuote("中文")).toBe("'中文'");
    expect(shlexQuote("a")).toBe("a");
  });
});

describe("shlexSplit", () => {
  it("distinguishes an explicitly empty token from no token", () => {
    expect(shlexSplit("''")).toEqual([""]);
    expect(shlexSplit("")).toEqual([]);
    expect(shlexSplit("a '' b")).toEqual(["a", "", "b"]);
  });
  it("rejects a trailing lone backslash", () => {
    expect(() => shlexSplit("echo a\\")).toThrow();
  });
});

describe("shlexJoin", () => {
  it("is not a plain space join", () => {
    expect(shlexJoin(["a b"])).not.toBe("a b");
    expect(shlexJoin(["a b"])).toBe("'a b'");
  });
});

import { describe, it, expect } from "vitest";
import { pySplitlines, pyParseInt } from "./pystr.js";

describe("pySplitlines", () => {
  // 實測 Python 3.14.5(值抄自實跑,不是從 TS 反推):
  //   'a\r\nb\rc\n'                -> ['a', 'b', 'c']
  //   'a\n'                        -> ['a']          ← 尾端空元素被丟掉
  //   ''                           -> []
  //   'a\x0bb\x0cc\x1cd\x85e\u2028f' -> ['a','b','c','d','e','f']
  //   'a\x1db\x1ec'                -> ['a','b','c']
  //   'a\u2029b'                   -> ['a','b']
  //   'a b'(一般空白)              -> ['a b']
  //   'a\n\nb'                     -> ['a', '', 'b']
  // JS 的 split("\n") 只認 \n,而且 'a\n' 會給 ['a','']——多一個空字串。
  it("treats CRLF, CR and LF alike and drops the trailing empty piece", () => {
    expect(pySplitlines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(pySplitlines("a\n")).toEqual(["a"]);
    expect(pySplitlines("")).toEqual([]);
  });

  it("breaks on the exotic line boundaries Python breaks on", () => {
    expect(pySplitlines("a\x0bb\x0cc\x1cd\x85e\u2028f")).toEqual(
      ["a", "b", "c", "d", "e", "f"],
    );
    expect(pySplitlines("a\x1db\x1ec")).toEqual(["a", "b", "c"]);
    expect(pySplitlines("a\u2029b")).toEqual(["a", "b"]);
  });

  it("does not break on a plain space", () => {
    // 一般空白不是斷行字元。字元類若把 \u2028 誤植成 U+0020,這條會變紅。
    expect(pySplitlines("a b")).toEqual(["a b"]);
  });

  it("keeps interior empty lines", () => {
    expect(pySplitlines("a\n\nb")).toEqual(["a", "", "b"]);
    // 只丟掉「一個」尾端空片段:'a\n\n' -> ['a', '']
    expect(pySplitlines("a\n\n")).toEqual(["a", ""]);
  });
});

describe("pyParseInt", () => {
  // Python int() 接受前後空白、正負號、以及數字之間的單一底線。
  it("accepts what int() accepts", () => {
    expect(pyParseInt("12")).toBe(12);
    expect(pyParseInt(" 12 ")).toBe(12);
    expect(pyParseInt("+12")).toBe(12);
    expect(pyParseInt("-12")).toBe(-12);
    expect(pyParseInt("1_2")).toBe(12);
  });

  it("rejects what int() rejects, by returning null instead of throwing", () => {
    // 呼叫端要的是 Python 的 `except ValueError` 分支,不是例外本身。
    for (const bad of ["_12", "12_", "1__2", "", "x", "1.0", "0x10"]) {
      expect(pyParseInt(bad), bad).toBeNull();
    }
  });

  it("strips exactly what int() strips, which is not what JS trim() strips", () => {
    // 實測 Python 3.14.5 / Node:
    //   int('\x8512')     == 12          | '\x8512'.trim()     不剝 \x85
    //   int('\ufeff12')   ValueError     | '\ufeff12'.trim()   會剝
    //   int('\x1c12')     ValueError     | '\x1c12'.trim()     不剝
    //   int('\u300012')   == 12          | '\u300012'.trim()   會剝
    expect(pyParseInt("\x8512")).toBe(12);
    expect(pyParseInt("\ufeff12")).toBeNull();
    expect(pyParseInt("\x1c12")).toBeNull();
    expect(pyParseInt("\u300012")).toBe(12);
  });

  it("does not accept Unicode decimal digits, unlike int() (deferred)", () => {
    // 實測 Python:int('１２') == 12。這裡刻意只認 ASCII——見 pystr.ts 的註解,
    // 這是登記在案的延後項。這條測試把「現況」釘住,將來要補時會先變紅。
    expect(pyParseInt("１２")).toBeNull();
  });
});

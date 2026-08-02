/**
 * Python `shlex` 的 POSIX 子集,只涵蓋本專案用到的三個函式。
 *
 * 為什麼要自己寫:Node 沒有 shlex,而 resume_exec(`claude -p '/dev-loop resume'`)
 * 要走 split → join → split 三道,gate 也用 split 把每條命令切成 argv。切錯的後果
 * 是背景 watcher 永遠跑錯命令(輸出只進 watcher-log.jsonl,沒人當場看得到),
 * 或 gate 假失敗把 loop 推去 fix 而不是報告工具問題。
 *
 * 範圍:POSIX 模式(Python 的 shlex.split 預設 posix=True)。不做 Windows 語意。
 */

/**
 * Python `shlex.quote` 的安全字元集。其餘一律加單引號——**包含非 ASCII**,
 * 所以 `中文` 會變成 `'中文'`。這點容易漏:憑直覺寫的實作多半只對含空白的
 * 字串加引號,往返仍然成立,但 join 的輸出與 Python 不同字。
 */
const SAFE = /^[a-zA-Z0-9_@%+=:,./-]+$/;

/**
 * Python `shlex.whitespace` **恰好**是這四個字元(實測 `shlex.shlex().whitespace`
 * == `' \t\r\n'`)。JS 的 `/\s/` 大得多——還含 \v、\f、NBSP(U+00A0)、
 * ideographic space(U+3000)、U+2009 等等。實測:
 *   "a　b"(U+3000)  PY -> ['a　b']  TS(修前) -> ["a","b"]
 *   "a b"(U+00A0)   PY -> ['a\xa0b']    TS(修前) -> ["a","b"]
 *   "a\vb" / "a\fb" / "a b" 同型。
 * 觸發情境很現實:resume_exec 或 gate_cmds 用 CJK 輸入法打出來、或從網頁貼上。
 *
 * shlexQuote 的 SAFE 不受影響:Python 的 shlex.quote 安全集是
 * `%+,-./0123456789:=@A-Z_a-z` 且要求 `s.isascii()`,與上面的 ASCII-only 字元類
 * 完全相同(已對 U+3000/U+00A0/\v/\f/中/~/!/$ 逐一比對,兩邊一致都會加引號)。
 * 另外 JS 的 `$` 只匹配字串真正結尾(不像 Python re 的 `$` 會匹配尾端換行前),
 * 所以 "abc\n" 兩邊都判定為不安全。
 */
const WHITESPACE = " \t\r\n";

export function shlexQuote(s: string): string {
  if (s === "") {
    return "''";
  }
  if (SAFE.test(s)) {
    return s;
  }
  // Python: "'" + s.replace("'", "'\"'\"'") + "'"
  return "'" + s.replace(/'/g, `'"'"'`) + "'";
}

export function shlexJoin(parts: string[]): string {
  return parts.map(shlexQuote).join(" ");
}

/**
 * Python `shlex.split(s)`(posix=True, comments=False)。
 *
 * 規則:空白分隔;單引號內一切原樣(含反斜線);雙引號內反斜線只逃逸
 * `"` 與 `\` 本身,其餘保留;引號外反斜線逃逸下一個字元。空字串與純空白
 * 回空陣列。未閉合的引號拋錯(Python 是 ValueError: No closing quotation)。
 */
export function shlexSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false; // 區分「空 token」(來自 '' 或 "")與「還沒開始」
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
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
        const d = s[i]!;
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
        // 尾端單一反斜線:Python posix 模式視為逃逸不完整,拋 ValueError
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

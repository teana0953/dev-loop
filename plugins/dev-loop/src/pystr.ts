/**
 * Python 的字串語意 helper。JS 的對應寫法在這兩件事上都不是安全直譯,而且
 * 錯的表現都是「不報錯、答案不同」。
 */

// Python str.splitlines() 的斷行字元集(\r\n 這個兩字元序列要先比,否則 CRLF
// 會被當成兩個邊界而多切出一個空行)。
// JS 的 split("\n") 只認 \n:一份含 \r 的 git porcelain 輸出在 Python 會被
// 切開、在 TS 不會,兩邊各自算出不同的 worktree 路徑清單而都不報錯。
const LINE_BOUNDARIES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/**
 * Python `str.splitlines()`。
 *
 * 與 `split()` 的兩個差別都會咬人:斷行字元集更大,而且**尾端的空片段會被
 * 丟掉**('a\n' 給 ['a'],不是 ['a', ''])。只丟一個——'a\n\n' 是 ['a', '']。
 */
export function pySplitlines(s: string): string[] {
  if (s === "") {
    return [];
  }
  const parts = s.split(LINE_BOUNDARIES);
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

// Python `str.strip()`(不給引數)剝掉的字元集 = 所有 str.isspace() 為真的
// 字元。實測列舉全部 0x110000 個 codepoint 得到 29 個:
//   09 0a 0b 0c 0d 1c 1d 1e 1f 20 85 a0 1680 2000-200a 2028 2029 202f 205f 3000
// 注意 U+FEFF(BOM)**不在**裡面——JS 的 trim() 卻會剝它。
const PY_STR_WS = "\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STR_STRIP = new RegExp(`^[${PY_STR_WS}]+|[${PY_STR_WS}]+$`, "g");

/**
 * Python `str.strip()`(無引數)。
 *
 * 和 JS 的 `trim()` 兩邊各差一組,而且方向相反(實測):
 *   `"\x1c12".strip()` == `"12"`,而 `"\x1c12".trim()` 原樣不動
 *   `"\ufeff12".strip()` == `"\ufeff12"`,而 `"\ufeff12".trim()` == `"12"`
 * 這個差在 pid 檔上會咬人:帶 \x1c 前綴的 watcher.pid 在 Python 是合法的活
 * pid,用 trim() 的 TS 會判成 "absent" —— 然後 disarmWatcher 把 pid 檔刪掉,
 * 而 watcher 還活著,從此再也找不到、殺不掉。
 */
export function pyStrip(s: string): string {
  return s.replace(PY_STR_STRIP, "");
}

// Python 的 int() 在轉換前**自己**剝掉的空白集合。實測(逐一把 c + "12" + c
// 餵給 int()):它剝掉 str.isspace() 為真的字元,唯獨 \x1c-\x1f 這四個例外——
// 它們 isspace() 為真(所以 str.strip() 會剝),int() 卻拒絕。也就是
// PY_INT_WS === PY_STR_WS 去掉 \x1c-\x1f;`int(s.strip())` 與 `int(s)` 因此
// 不等價,呼叫端 Python 寫哪個就得照著寫哪個。
//
// 不能直接用 JS 的 trim():兩邊各差一個,而且方向相反(實測)——
//   "\x85" + "12"   → Python int() == 12,JS trim() 不剝(會被誤判成非法)
//   "\ufeff" + "12" → Python int() ValueError,JS trim() 會剝(會被誤判成合法)
const PY_INT_WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_INT_STRIP = new RegExp(`^[${PY_INT_WS}]+|[${PY_INT_WS}]+$`, "g");

// 前後空白 + 正負號 + 數字(數字之間可有單一底線)。
// 已知未涵蓋:Python 的 int() 也吃 Unicode 十進位數字(實測 int('１２') == 12),
// 這裡只認 ASCII。真的踩到需要 Nd 逐字元查值,成本與這條路徑的價值不成比例;
// 這是登記在案的延後項,不是遺漏。
const INT_PATTERN = /^[+-]?\d(?:_?\d)*$/;

/**
 * Python `int(s)` 的「成功回值 / ValueError 回 null」版本。
 *
 * 呼叫端要的一律是 Python 的 `except ValueError` 分支(壞掉的 pid 檔視同沒有
 * watcher),所以回 null 而不是拋錯。
 */
export function pyParseInt(s: string): number | null {
  const trimmed = s.replace(PY_INT_STRIP, "");
  if (!INT_PATTERN.test(trimmed)) {
    return null;
  }
  return Number(trimmed.replace(/_/g, ""));
}

import { writeFileSync } from "node:fs";

/**
 * notes 必須是字串 array。
 *
 * 上游的 review 報告解析已驗過 note 型別,但 non_blocking 是從 checkpoint
 * 讀回來的,而 checkpoint 載入刻意不驗欄位型別——手改過的檔仍能送進非字串。
 * 這裡再擋一次,而且要在兩個引擎擋出同一個結果:放行的話 Python 會逐字元
 * 拆字串、TS 則直接把數字印進 markdown,同一份輸入兩種產物。
 *
 * 型別標註擋不住這件事:notes 是從 JSON 來的,在執行期沒有型別。
 */
export function renderFollowup(notes: string[]): string {
  if (!Array.isArray(notes)) {
    throw new TypeError(`notes must be a list, got ${JSON.stringify(notes)}`);
  }
  for (const [i, n] of notes.entries()) {
    if (typeof n !== "string") {
      throw new TypeError(`notes[${i}] must be a string, got ${JSON.stringify(n)}`);
    }
  }
  if (notes.length === 0) {
    return "";
  }
  const lines = ["## Follow-up(non-blocking)", ""];
  lines.push(...notes.map((n) => "- " + n));
  return lines.join("\n") + "\n";
}

export function writeFollowup(path: string, notes: string[]): void {
  writeFileSync(path, renderFollowup(notes), "utf-8");
}

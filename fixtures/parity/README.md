# 跨引擎 parity fixtures

這裡的每個 JSON 檔同時被 **pytest**(`tests/test_parity_*.py`)與 **vitest**
(`plugins/dev-loop/src/parity.*.test.ts`)讀取。同一份輸入餵給 Python 與
TypeScript 兩個引擎,斷言同一張預期表。任一側漂移即變紅。

設計出處:`docs/superpowers/specs/2026-07-31-parity-fixtures-design.md`

## 檔案格式

檔案是一個物件,鍵 = section 名(對應一個被測函式),值 = case 陣列。

每個 case:

- `name` — section 內唯一,同時是兩側的 test id
- section 專屬的輸入欄位
- 恰好一種預期:
  - `expect` — 物件,**欄位子集**比對(只斷言列出的欄位)
  - `expect_throws: true` — 必須拋錯。**不比對錯誤訊息文字**(兩語言例外文法本就不同)
- 純量回傳值包成 `{"value": ...}`

## 已裁決的刻意分歧

兩引擎行為刻意不同時,case 改寫成:

```json
{"name": "...", "input": ...,
 "divergence_reason": "為什麼兩邊該不一樣",
 "py": {"expect": {"parallel_groups": {"a": 1}}},
 "ts": {"expect_throws": true}}
```

`divergence_reason` 不得為空。沒有裁決過的差異**不准**寫成分歧 —— 那是 bug,
應該修實作。

## 規則

- 預期值以 **Python 現行行為為準**人工寫定,不自動產生。
- fixture 是兩引擎共用的單一真理:只改一側的預期值,或只讓一側跳過某 case,
  即為錯誤。
- 檔內每個 section 都必須有人消費 —— 兩側的 loader 會斷言 section 名稱集合完全相符。
- `checkpoint.json` 的 `structKeys` section 額外鎖住完整欄位集合(不是子集)——
  因為 checkpoint 是雙軌交接時真正落地的磁碟契約,只加在單一引擎的欄位在其餘
  全是子集比對的 case 裡完全隱形,resume 到另一引擎時才會炸。
- 新增 case 只准加進 fixture 檔本身,不准只加進某一側的測試檔——那等於讓兩側
  斷言不同的預期表,parity 就名不副實了。真正的分歧(兩引擎行為本就該不同)
  要走「已裁決的刻意分歧」那套流程,附上 `divergence_reason`;不准為了讓某一側
  測試變綠,就偷偷放寬其中一側的 `expect`。

## M2c 之後(Python 刪除時)

刪 Python 的那次 commit 同步做三件事:

1. 移除 `tests/test_parity_*.py`(pytest 那半邊的消費者)
2. 目錄改名 `fixtures/parity/` → `fixtures/behavior/`
3. 清掉所有 `py` / `ts` / `divergence_reason` 欄位(分歧概念隨 Python 一起消失),
   把 **`ts`** 區塊的內容扶正成 case 的 `expect`/`expect_throws`——**不是** `py`
   區塊。M2c 之後留下來的引擎是 TS,而每一個已裁決的分歧,`py` 那半邊斷言的
   正是 TS 刻意不要的行為(例如 `parallel_groups: {"a": 1}` 載入成功、
   `isSerial` 回傳 `true`)。扶正 `py` 只會產生一份第一天就是紅的「TS 行為規格」,
   或誘使日後有人把 TS「修回」Python 那種靜默取消平行執行的行為。
   原本的 `divergence_reason` 文字必須保留下來——搬到該 case 的 `note` 欄位,
   讓「為什麼選了較嚴格的行為」這段推理不隨欄位改名一起消失。

之後這批檔案不再是 parity,而是 **TS 引擎的行為規格**。

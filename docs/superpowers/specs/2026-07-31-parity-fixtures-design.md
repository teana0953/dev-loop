# 跨引擎 parity fixtures 設計

日期:2026-07-31
狀態:待實作(L1 TS 重寫 M2b 的前置)

## 背景與問題

L1 TS 重寫採雙軌:Python 引擎(`plugins/dev-loop/devloop/`)仍是生產路徑,TS(`plugins/dev-loop/src/`)在旁長起來,兩者讀寫同一批磁碟檔(checkpoint、change-meta、config、history)。

M1 與 M2a 期間,跨引擎行為一致性靠**人工 sweep** 驗證:720 組 transition、168 組 next_hint、8 個 status checkpoint、交錯的 history 寫入、`render_followup` 的 SHA-256 逐 byte 比對。全數零不符——但這些結論只存在 SDD ledger 的文字裡,**repo 內沒有任何測試會在兩實作漂移時變紅**。

M2a 已證明這個風險是實的:`??` 誤當成 `dict.get` 的移植,造成 `{"auto_arm": null}` 在 Python 讀出 watcher OFF、在 TS 讀出 watcher ON,同一個檔、相反的線上行為、兩邊都不報錯。兩邊各自的單元測試全綠。**只有跨引擎比對能抓到這類缺陷。**

M2c 會刪掉 Python 引擎與其 382 個測試。屆時所有人工 sweep 的結論將一併消失,無任何殘留物。

## 目標

把只存在於 ledger 的人工 sweep 結論,搬進 repo 變成可執行斷言,並讓它在 Python 消失後仍有價值。

## 機制(定案)

**共用輸入 + 兩邊各自斷言同一預期表。**

- fixture 檔同時持有 `input` 與 `expect`
- pytest 與 vitest 各自讀同一個檔,餵給各自的實作,斷言結果符合 `expect`
- 任一側漂移即變紅;不需要在測試中跨進程呼叫另一個引擎

預期值以 **Python 現行行為為準**人工寫定(Python 是既有生產路徑,定義了正確)。

**放置位置**:repo 根的 `fixtures/parity/`。pytest 從 repo 根跑、vitest 從 `plugins/dev-loop/` 跑,放根層兩邊都取得到。

```
fixtures/parity/
  config.json        # load_config / resolve_model / resolve_finish / validate_*
  changemeta.json    # load_change_meta / is_serial
  checkpoint.json    # save/load round trip + 拒收案例
  followup.json      # render_followup 逐字輸出
```

**case 形狀**:

```json
{"cases": [
  {"name": "explicit null auto_arm disables watcher",
   "input": {"auto_arm": null},
   "expect": {"auto_arm": false, "gate_cmds": [], "models": {}}},

  {"name": "null models is rejected",
   "input": {"models": null},
   "expect_throws": true},

  {"name": "parallel_groups as an object",
   "input": {"parallel_groups": {"a": 1}},
   "divergence_reason": "為什麼兩邊該不一樣",
   "py": {"expect": {"parallel_groups": {"a": 1}}},
   "ts": {"expect_throws": true}}
]}
```

- `expect` 是**欄位子集**——只斷言該 case 想鎖的欄位,不強迫每個 case 列全部欄位
- `expect_throws: true` 標記必須拋錯的輸入(不比對錯誤訊息文字,兩語言的例外文法本就不同)
- 已裁決的刻意分歧改用 `py` / `ts` 兩個巢狀區塊分寫(分歧的一側也可能是「拋錯」,巢狀才能讓兩側各自帶 `expect` 或 `expect_throws`),並附 `divergence_reason` 說明裁決理由
- 已知但延後處理的分歧(目前只有 checkpoint 的時間戳文法一處)不列入 `expect`,改在測試裡斷言兩引擎共通的那部分保證並註明理由

## 涵蓋範圍(定案:只做高風險四項)

`statemachine` 已有 720 組窮舉在 repo 內,不重複覆蓋。其餘模組(history、openspec、jsonio)風險較低,不在本次範圍。

### `config.json`

涵蓋 `load_config`、`resolve_model`、`resolve_finish`、`validate_gate_cmds`、`validate_model_config`。

- **缺欄位 vs 顯式 null** —— M2a 真實缺陷的來源。`auto_arm`、`gate_cmds`、`models`、`model_profile` 各自「鍵不存在」與「鍵存在但值為 null」兩條
- `model_profile` 非法值拒收;`models` 含非法 stage 或非法 alias 拒收
- `resolve_model` 各 stage 的解析與 profile fallback
- `resolve_finish` 的三值(merge/pr/ask)與 meta 覆寫優先序
- `gate_cmds` 非 list、元素非 str 拒收
- root 非 object 拒收

### `changemeta.json`

涵蓋 `load_change_meta`、`is_serial`。

- `flow_profile` 缺失時的預設、`full`/`light`、非法值拒收
- `needs_uiux` 的傳遞
- `parallel_groups` 各形狀,含**已裁決的刻意分歧**:傳物件時 TS 拒收、Python 放行(TS 於載入時驗證,較嚴格)。以 `expect_py`/`expect_ts` 分寫
- `is_serial` 邊界:groups 缺失、空、單組、多組

### `checkpoint.json`

雙軌交接的核心——兩引擎真正會交換的檔。兩段:

- **round trip**:fixture 的 `input` 直接是「磁碟上的 checkpoint JSON」,兩引擎各自 load 後斷言同一 struct。這正是混合引擎續跑實際走的路徑
- **拒收**:root 非 object、必要欄位(`phase`/`change_id`/`branch`)缺失、出現未知欄位
- **刻意不驗證**:`phase` 的值域與 `iteration` 的型別在載入時都不檢查(Python 的 dataclass 不做值域驗證,TS 照抄)。這件事本身寫成明確的 case,免得日後有人「順手加驗證」而不知道這是共同契約

時間戳文法差異(Python 微秒 `+00:00` vs TS 毫秒 `Z`,即既有延後項 F4)不寫進 `expect`;改在兩側測試裡斷言 `updated_at` 非空且以 `YYYY-MM-DDTHH:MM:SS` 開頭——這段是兩引擎都成立的共同保證。不假綠,也不擋 M2b。

> **F4 升級(2026-08-02,M2b-2b Task 5)**:F4 原本的擱置理由是「這個欄位沒有
> 任何程式會讀」——**這句話從今天起不成立**。`watcher-status` 會把
> `watcher-log.jsonl` 最後一筆的 `ts` 原樣印到 stdout(`last attempt: <ts> ...`),
> 而那筆 log 是由**哪一個引擎的 watcher** 寫的並不確定:Python 的 watcher 寫
> `2026-08-02T09:49:24.661791+00:00`,TS 的寫 `2026-08-02T09:49:24.661Z`。也就是
> 說同一個 checkpoint 目錄,`watcher-status` 的輸出取決於當初是誰 arm 的。
>
> `crossEngine.test.ts` 在這一點上是**靠建構方式而綠的,不是靠 parity**:沒有
> 任何一列會先在同一個目錄跑 `watch` 再跑 `watcher-status`,兩個引擎各自讀的
> 都是測試自己寫死的 log 行。真正的混合引擎情境不在矩陣涵蓋範圍內。
>
> 統一文法仍然不在本里程碑範圍(改動會波及 history/checkpoint/adapter 三處的
> 既有磁碟資料);這裡只是把「無人讀取」這個前提作廢,讓下一個接手的人知道
> F4 已經有一個使用者可見的出口。

### `followup.json`

涵蓋 `render_followup`,純函式、純字串。`input` 是 notes 陣列,`expect` 是**逐字完整輸出**。

- 空陣列、單筆、多筆
- 含換行的 note、含前後空白的 note

這是四項中唯一使用者直接看到的文字,值得逐 byte 鎖死。

## M2c 之後的演變

刪 Python 時,順序重要:

1. 刪除前 fixture 已綠 —— 表示 TS 對每個 case 的行為與 Python 一致,且這件事已被記錄成可執行斷言
2. 刪除時只移除 pytest 那半邊的消費者;`fixtures/parity/` 檔案本身原地不動
3. 刪除後這批檔案不再是「parity」而是 **TS 的行為規格**。同一次 commit 改名為 `fixtures/behavior/`,清掉 `py`/`ts`/`divergence_reason`(分歧概念隨 Python 一起消失),並把 **`ts`** 區塊的內容扶正成 case 的 `expect`/`expect_throws`——不是 `py` 區塊,因為留下來的引擎是 TS,`py` 那半邊斷言的正是 TS 刻意不要的行為。`divergence_reason` 的文字保留成該 case 的 `note` 欄位,不隨欄位改名一起消失

長期價值不是「防兩引擎漂移」(那只是 M2b~M2c 的窗口),而是 M3 改 phase 骨架時,這批斷言構成「沒有順手改壞既有語意」的回歸網。

## 不做(YAGNI)

- 不重複覆蓋 statemachine(720 組窮舉已在 repo)
- 不比對例外訊息文字,只比對「有無拋錯」
- 不做跨進程即時比對(不在測試中啟動另一個引擎)
- 不涵蓋 history、openspec、jsonio(風險低,且 history 的時間戳分歧已另列延後項)
- 不自動產生預期值——人工寫定才有規格意義

## 待實作時決定

- fixture loader 在兩側的擺放位置(pytest conftest helper vs TS test util)
- `expect` 子集比對的實作細節(TS 側如何在 `strict` 下表達 partial match)
- 各 case 的確切預期值 —— 一律先讀 Python 現行實作再寫,**Python 行為為準,與直覺不符時以 Python 為準**

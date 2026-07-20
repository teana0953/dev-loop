# Design: add-model-profile-config

## Context

model 分層目前寫死在 SKILL.md 各流程步驟的文字標注(Brainstorm「Opus」、Apply「Sonnet subagent」、Review code leg「Opus」、Fix「機械性 → Sonnet;架構性 → Opus」)。這是設計初期「便宜模型執行、貴模型把關」的架構假設。隨模型能力提升,單一強模型全程執行的品質更好,分層退化為純成本選項;硬編的 model 名也有版本更迭風險。

引擎對編排層開關已有成熟模式:`superpowers`/`auto_approve` 由 `load_config` passthrough、引擎不分支、消費端是編排 skill;`finish`/`gate_cmds` 有 fail-loudly 值域驗證。本設計沿用這兩個既有模式,不發明新機制。

## Goals / Non-Goals

**Goals:**
- model 選擇從流程文字降級為 config 資料(`model_profile` + `models`),預設反轉為「全程繼承 session 模型」。
- 保留低成本用法:`budget` 一鍵回到分層;`models` 提供逐階段細調。
- review 強度跟著 profile 聯動,不新增第二個獨立設定。
- config 存 alias 不存 model id,對模型換代免疫。

**Non-Goals:**
- 不改引擎狀態機、gate、review 分級、報告格式——引擎完全不依 model 分支。
- 不做逐 change 的 model override(`.devloop/changes/<id>.json` 不加鍵;需要時再提案)。
- 不在首次啟動詢問 model_profile(有安全預設 quality,問了是打擾)。
- 不動 QA gate 與 proposal-review 的 model(它們始終繼承 session 模型,兩個 profile 下相同)。

## Decisions

### D1:兩鍵分工——`model_profile` 選檔位,`models` 逐階段 override

單一 `models` map 也能表達一切,但 95% 使用者只想選「快/省」一檔,不想理解階段劃分。`model_profile` 是人選的檔位,`models` 是進階細調;`models` 中出現的階段優先於 profile 推導值。替代方案「只有 profile 沒有 override」被否決:會堵死「apply 用 haiku 跑純機械任務」這類正當實驗。

### D2:階段鍵值域與決策表

`models` 的鍵限定四個編排階段:`brainstorm`、`apply`、`review`、`fix`(對應 SKILL 流程中實際 dispatch subagent 或選 model 的點;propose/qa/proposal-review 始終繼承,不開放)。值限定 alias:`sonnet`|`opus`|`haiku`|`fable`。決策表:

| 階段 | quality | budget |
|---|---|---|
| brainstorm | 繼承 | 繼承 |
| apply(TDD subagent) | 繼承 | `sonnet` |
| review(code leg) | 繼承 | 繼承(prompt 加重,見 D4) |
| fix(機械性) | 繼承 | `sonnet` |
| fix(架構性) | 繼承 | 繼承 |

「繼承」= dispatch 時不帶 model 參數,subagent 用 session 模型。budget 只路由 output 大戶(apply、機械 fix),把關步驟(brainstorm/review/架構 fix)留在強模型——這正是分層的原始意圖,但現在是選項不是預設。

### D3:引擎 passthrough + fail-loudly 驗證

`Config` 增 `model_profile: str | None = None`、`models: dict = field(default_factory=dict)`。引擎不依兩鍵分支(同 `superpowers` 模式),但提供 `validate_model_config(config)` 驗證函式:`model_profile` 非 `quality`/`budget`/None → ValueError;`models` 鍵不在四階段、或值不在四 alias → ValueError(同 `finish`/`gate_cmds` 的 typo 不靜默精神)。驗證掛在 `load_config` 內立即執行——設定壞掉要在 loop 一開始就炸,不是跑到 apply 才發現。替代方案「編排端自行檢查」被否決:skill 文字無法保證一致執行,引擎驗證是機械保證。

### D4:review 強度 = prompt 模板切換,不是額外輪次

budget 模式下 code review leg 的 subagent prompt 採 coverage-first 模板(報所有發現含低嚴重度、信心分級交下游過濾);quality 模式用現行標準模板。不增加 legs 數量、不加輪次——引擎的 legs-init/leg-done/review 接口零改動。替代方案「budget 跑兩輪 review」被否決:強模型當 reviewer 的單輪已足夠,多輪是舊時代補償機制。

### D5:SKILL.md 改寫方式

「設定」一節加兩鍵說明;「流程」各步驟移除 `(Opus)`/`(Sonnet)` 字樣,新增一個「Model 決策」小節放 D2 決策表,各步驟 dispatch 時引用它。description frontmatter 同步改(拿掉 Opus/Sonnet 字樣)。

## Risks / Trade-offs

- [alias 語意由 harness 決定,`sonnet` 未來指向哪代不受控] → 這正是要的行為:跟著 harness 升級;需要鎖版的使用者不存在於此工具的受眾。
- [budget 模式品質下降但使用者不自知] → README 與 SKILL 明示 budget 的取捨;review 加重(D4)是對應的護欄。
- [既有專案 config 沒有新鍵] → 缺鍵 = quality 預設,行為是「變好」(全程強模型),無遷移動作;成本上升是可見的,README 註明如何回 budget。
- [`models` 開放 fable 可能撞上 session 模型已是 fable 的冗餘指定] → 冗餘無害,dispatch 帶與不帶等價,不特判。

## Migration Plan

單 PR 落地:config.py + 測試 → SKILL.md/README → version bump。無資料遷移;rollback = revert(缺鍵行為即新預設,revert 後 config 多餘鍵被舊版 load_config 忽略,無毒)。

## Open Questions

(無)

> **歷史設計文件(point-in-time)**:記錄該輪設計當下的決策與脈絡,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop 設計規格

- **日期**:2026-06-18
- **取向**:可編排規格(狀態機 + 產物驅動)
- **產物形態**:設計文件 / 規格(spec);精確到未來可長成一個自動驅動的 skill / slash command,但本份不含實作

## 1. 目的

把使用者目前「用 agent 開發」的固定流程形式化成一個可重複、可中斷續跑、僅在關鍵點需人工介入的 loop。形式化後:

- 現在可照著手動跑,每次都一致;
- 未來可直接拿這份 spec 變成一個 `/dev-loop` 之類的編排器,自動驅動階段、切換 model、召喚 subagent、執行關卡與升級。

## 2. 現況流程(被形式化的對象)

`/brainstorming`(Opus)→ OpenSpec propose → apply + TDD(Sonnet)→ Opus subagent review → 修正(Sonnet)→ Opus subagent re-review,直到通過;全程 git trunk-based。

## 3. 核心決策(已拍板)

| 決策 | 結論 |
|---|---|
| 人工關卡 | 只在關鍵點卡:批准設計、批准提案、超過最大輪數時的升級 |
| review 通過條件 | 測試全綠 **且** Opus subagent 判定無 blocking 問題 |
| review 不過的保護 | 內圈設最大輪數(預設 3),超過 → 停 + Opus 產未解決摘要 + 升級 |
| review 前置 | 先跑便宜硬關卡(tests/lint/build),全綠才召喚 Opus |
| 意見分級 | blocking(必修續圈)/ non-blocking(記 follow-up,不擋 merge) |
| 逃生門 | review 若發現是提案層級錯誤,回 propose / brainstorm,而非硬 fix |
| 交接產物 | 每階段落具體產物,讓冷啟動 subagent 接得住、loop 可續跑 |
| review 真相來源 | OpenSpec proposal,問「實作是否符合提案、有無 scope drift」 |
| TDD 驗收 | 驗測試先行與是否覆蓋提案行為,而非只看最後全綠 |
| fix model 路由 | 機械性 → Sonnet;架構性 → Opus |
| merge | **自動**:通過後短命分支 merge 回 trunk + `openspec archive` |
| token 用罄續跑 | checkpoint 斷點 + 可抽換 resume 觸發器,**預設本機** |

## 4. 狀態機

```
[0] Intake ─ 使用者給需求
      │
[1] Brainstorm        Opus · /brainstorming
      │  產物:設計文件
      ✋ 人工關卡:批准設計
      │
[2] Propose           Opus · OpenSpec
      │  產物:change 目錄(proposal + spec deltas + tasks)
      │  ※ 提案切小,符合 trunk-based 小而頻繁
      ✋ 人工關卡:批准提案
      │
[3] Apply (TDD)       Sonnet · 短命分支
      │  red → green → refactor,逐 task
      ▼
[4] Hard Gate ◄───────────┐   自動 · 無 model
      │ tests+lint+build   │
      │ 失敗 ──────────────┘→ 回 [6] Fix
      │ 全綠
      ▼
[5] Review / Re-review     Opus subagent(冷啟動、fresh)
      │  輸入:diff + proposal(真相來源)+ 測試報告 + 前次 review 報告
      │  檢查:符合提案?scope drift?TDD 有意義?bug/品質
      │  產物:review 報告(blocking / non-blocking 分級)
      │
      ├─ 無 blocking ───────────────────────► [8] Merge
      ├─ blocking 是 code 問題 ──► [6] Fix
      └─ blocking 是 proposal 問題 ──► 逃生門回 [2] / [1]
      │
[6] Fix               Sonnet(機械)/ Opus(架構性)
      │  只處理 blocking 項
      └──► 回 [4](重跑 hard gate → re-review)

  迴圈控制:[4]-[6] 計數,預設上限 3 輪
  超過 → 停,Opus 產「未解決問題摘要」✋ 升級

[8] Merge & Archive   自動
      · 短命分支 merge 回 trunk
      · openspec archive 歸檔
      · non-blocking 項 → 記成 follow-up
      ▼  終態
```

## 5. 各階段契約

每個階段定義:執行者、輸入、處理、輸出(產物)、轉移條件。

### [1] Brainstorm
- **執行者**:Opus(主對話)· `/brainstorming`
- **輸入**:使用者需求
- **輸出**:設計文件
- **轉移**:人工批准 → [2];否則留在 [1] 修

### [2] Propose
- **執行者**:Opus(主對話)· OpenSpec
- **輸入**:已批准設計文件
- **處理**:建立 OpenSpec change;**提案切小**以符合 trunk-based
- **輸出**:change 目錄(proposal + spec deltas + tasks)
- **轉移**:人工批准 → [3];否則留在 [2] 修

### [3] Apply(TDD)
- **執行者**:Sonnet
- **輸入**:已批准 proposal
- **處理**:逐 task,red(先寫失敗測試)→ green(實作)→ refactor;在短命分支上
- **輸出**:分支(code + tests)
- **轉移**:自動 → [4]

### [4] Hard Gate(便宜硬關卡)
- **執行者**:自動,無 model
- **處理**:跑 tests + lint + build
- **轉移**:失敗 → [6] Fix(不召喚 Opus);全綠 → [5]

### [5] Review / Re-review
- **執行者**:Opus subagent(每輪 fresh、冷啟動)
- **輸入**:diff + OpenSpec proposal(真相來源)+ 測試報告 +(若有)前次 review 報告
- **檢查**:是否符合提案、有無 scope drift、TDD 是否有意義且覆蓋提案行為、bug 與品質
- **輸出**:review 報告,findings 分 `blocking` / `non-blocking`,並標註每個 blocking 屬 `code` 或 `proposal` 層級
- **轉移**:
  - 無 blocking → [8] Merge
  - blocking 且全為 code 層級 → [6] Fix
  - 任一 blocking 為 proposal 層級 → 逃生門回 [2](或必要時 [1])

### [6] Fix
- **執行者**:Sonnet(機械性修正)/ Opus(架構性修正)— 依 review 標註的難度路由
- **輸入**:review 報告的 blocking 項
- **輸出**:更新後的 code
- **轉移**:自動回 [4]

### [8] Merge & Archive
- **執行者**:自動,無 model
- **處理**:短命分支 merge 回 trunk → `openspec archive` 歸檔 → non-blocking 項落成 follow-up 清單
- **轉移**:終態

## 6. 角色指派

| 工作 | 執行者 |
|---|---|
| Brainstorm、Review/Re-review、架構性 fix、升級摘要 | **Opus** |
| Apply(TDD)、機械性 fix | **Sonnet** |
| Hard gate、Merge、Archive | **自動(無 model)** |

## 7. 迴圈控制與升級

- [4]→[5]→[6] 每完成一次 re-review,`iteration` +1。
- `iteration` 超過 `max_iterations`(預設 3)→ 停止自動段,Opus 產出「未解決問題摘要」(列出反覆出現的 blocking、嘗試過的修法、卡點),✋ 升級給使用者裁決。

## 8. 交接產物鏈

讓冷啟動 subagent 接得住、loop 可中斷續跑:

設計文件 → OpenSpec change 目錄 → 分支(code + tests)→ 測試/lint/build 報告 → review 報告(分級)→ follow-up 清單

## 9. 斷點與續跑(token 用罄處理)

### 約束
配額用罄時當下 session 被卡住,無法反應式自排。續跑必須是**事前布署好的排程**,在 reset 時間點以**新的、有配額的 invocation** 重入 loop。

### A. Checkpoint(斷點)
每次階段轉移後寫入 loop 狀態。欄位:

- `phase` — 目前階段
- `iteration` — 內圈輪數
- `change_id` — OpenSpec change 識別
- `branch` — 短命分支名
- `last_artifact` — 最後產物路徑
- `non_blocking[]` — 累積的 non-blocking 項
- `updated_at` — 時間戳

### B. Resume(可抽換觸發器)
- loop 本體提供 `--resume` 進入點:讀 checkpoint → 跳回對應階段續跑。
- 觸發器是與 loop 解耦的薄 adapter,讀同一份 checkpoint。**預設本機**;cloud 為替代方案,切換不需改 loop 本體。

**預設:本機 adapter**
- 分支與 checkpoint 留在本機,**不需 push remote**。
- harness 單次 wakeup 上限約 1 小時,reset 視窗可能數小時 → adapter **週期性重排**:每約一小時醒來,檢查是否已達 reset / 配額是否恢復;未到則再睡,到了才真正跑 `--resume`。
- 代價:需要該 session/進程持續存在直到 reset。

**替代:cloud adapter**
- 雲端 agent 在 reset 時間點以全新配額起來跑 `--resume`,不需本機開機。
- 前提:雲端看不到本機狀態,須**每階段 push 分支 + checkpoint 到 remote**;若仍被限流或無待辦則重排/退出。

## 10. 錯誤處理彙整

- Hard gate 失敗 → 直接回 Fix,不召喚 Opus(省成本)。
- review 發現提案層級錯誤 → 逃生門回 [2]/[1],而非硬 fix。
- 超過最大輪數 → 停 + Opus 摘要 + 升級。
- token 用罄 → checkpoint + 預設本機 resume,reset 時間點續跑。
- 每個 subagent 從產物鏈冷啟動 → 整條 loop 可恢復。

## 11. 待實作時再定的細節(非本份範圍)

已於 `devloop` 引擎實作(見 `devloop/` 與 `skills/dev-loop/SKILL.md`):

- checkpoint 格式(JSON,`Checkpoint` dataclass);預設路徑 `.devloop/checkpoint.json`。
- resume 排程決策(`plan_resume` + `resume` 子命令)。
- OpenSpec 指令封裝(`validate-change` / `archive` 子命令)。
- review 分級與 non-blocking 累積(`review` 子命令寫入 checkpoint.non_blocking)。
- hard-gate timeout 與 CLI 不合法 event 的乾淨錯誤處理。

仍由 SKILL.md 編排層 / 人工處理(刻意不在引擎內):

- git trunk-based 的實際 merge 動作與短命分支管理。
- TDD 開發本身(apply / fix 由 Sonnet 執行)。
- resume 觸發 adapter 的實際排程接線(本機 wakeup / 雲端 cron 由外層驅動,引擎只提供決策)。
- non-blocking follow-up 的最終落地形式(issue / task / 清單檔)。

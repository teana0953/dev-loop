# Dev-Loop v2 設計規格 — 前後期審查強化 + 平行 subagent

- **日期**:2026-06-30
- **取向**:在既有 dev-loop 狀態機上擴充(可編排規格 + 確定性引擎)
- **基線**:[2026-06-18-dev-loop-design.md](2026-06-18-dev-loop-design.md)
- **產物形態**:設計文件 / 規格(spec);本份不含實作

## 1. 目的

在既有 dev-loop 流程上加六項能力,加深前後期把關並支援平行開發:

1. **Proposal Review**:propose 之後、人工批准提案之前,插一道 AI 自動 review,送人工前先把關。
2. **QA Gate**:在 code/uiux review 之前新增一道 QA 行為驗證關卡;fix 後也要重跑。
3. **平行 subagent + git worktree**:Apply / Review / Fix 可依需求分派多個 subagent,用 worktree 避免衝突。
4. **UI/UX Review**:牽涉 UI/UX 的 change,除 code 外再以 UI/UX 角度 review(只審前端碼)。
5. **收尾策略**:通過所有關卡後,依 config 或人工決定直接 merge 回 trunk 或開 PR。

設計沿用 v1 的核心哲學:**確定性的部分(狀態機、checkpoint、gate、review 分級、resume 排程、OpenSpec 封裝)由 stdlib-only 的 Python 引擎負責;判斷與換 model 的部分由 `dev-loop` skill 編排。**

## 2. 與 v1 的差異(摘要)

| 面向 | v1 | v2 |
|---|---|---|
| 前期 | brainstorm → ✋批准設計 → propose | 不變 |
| 提案把關 | propose → ✋批准提案 | propose → **Proposal Review(自動修到乾淨)** → ✋批准提案 |
| 實作 | Apply 單一 Sonnet | Apply **可平行**(提案標注的平行群,各自 worktree) |
| 關卡 | Hard Gate → Review | Hard Gate → **QA Gate** → Review |
| Review | code(Opus subagent) | **code ‖ uiux 平行**(uiux 僅 needs_uiux) |
| Fix | 單一 | **可平行**(獨立 blocking 分多 unit) |
| 收尾 | 自動 merge | **config.finish ∈ merge\|pr\|ask** |

人工關卡維持三處:**批准設計、批准提案、超輪升級**(收尾 ask 時多一處互動)。

## 3. 狀態機

```
[0] Intake
      │
[1] Brainstorm        Opus · /brainstorming         產物:設計文件
      │  ✋ 批准設計
[2] Propose           Opus · OpenSpec                產物:change(proposal+spec+tasks)
      │                                              + .devloop/changes/<id>.json(parallel_groups + needs_uiux)
      ▼
[2.5] Proposal Review  Opus subagent(冷啟動)        產物:proposal-review 報告(分級)
      │   無 blocking ──────────────► ✋ 批准提案 → [3]
      │   blocking(proposal 層)─────► 自動回 [2] 修(計數,上限 N)
      │   根本問題(design 層)──────► 逃生門回 [1](升級)
      │
[3] Apply (TDD)       Sonnet · 多 subagent           產物:短命分支(各 unit worktree 合並而成)
      │   依 parallel_groups 展開 units;各自 worktree;完成合並回短命分支
      ▼
[4] Hard Gate ◄──────────────┐  自動 · 無 model
      │ tests+lint+build      │
      │ 失敗 ─────────────────┘→ [6] Fix
      │ 全綠
      ▼
[4.5] QA Gate         QA subagent(可平行情境)        產物:QA 報告(分級)
      │   blocking ──────────────────► [6] Fix
      │   pass
      ▼
[5] Review            code ‖ uiux 平行 subagent       產物:彙總 review 報告(分級)
      │   (uiux 僅當 needs_uiux=true 才召喚;只審前端碼)
      │   無 blocking ───────────────► [8] 收尾
      │   blocking(code 層)─────────► [6] Fix
      │   blocking(proposal 層)──────► 逃生門回 [2]/[1]
      │
[6] Fix              Sonnet(機械)/ Opus(架構);可平行 units
      └──► 回 [4](重跑 Hard Gate → QA → re-review)

  迴圈控制:[4]→[4.5]→[5]→[6] 每完成一輪 iteration+1,上限預設 3
  超過 → escalated 停下,Opus 產未解決摘要 ✋ 升級

[8] 收尾              config.finish ∈ merge|pr|ask
      ├ merge → 短命分支 merge 回 trunk → openspec archive → 終態
      ├ pr    → 分支含 archive commit → push → 開 PR → 終態(等人 review/合並)
      └ ask/未設 → ✋ 問人工選 merge 或 pr
```

> 註:design 層 blocking 在引擎實作為 `PROPOSE_BLOCKING_DESIGN → escalated`(escalated 即「停下升級給人工」狀態)。brainstorm 無 inbound auto-transition(設計上由人工驅動),故「回 brainstorm」由人工在升級後手動發起,而非引擎自動轉移。

**關鍵語義**:
- **兩道 review 都自動修到乾淨**:Proposal Review 自動回 propose 修;Review(code/uiux)的 code 層 blocking 回 fix。兩者都有逃生門(發現是上游層級問題則回 propose/brainstorm)。
- **fix 後重跑順序**:`Hard Gate → QA → Review`,確保改完不破壞行為。
- **iteration 計數**涵蓋整個 `[4]→[4.5]→[5]→[6]` 內圈,超過上限統一升級。

## 4. 並行工作單元模型

平行有**兩類**,複雜度與 checkpoint 需求不同:

- **(a) 寫入型平行(Apply / Fix)**:會改碼,需要 worktree 隔離 + 合並。用完整 `units[]` 模型。
- **(b) 唯讀型平行(QA / Review code‖uiux)**:只做分析/驗證、不改碼,在**同一個短命分支**上平行 spawn subagents,各產報告後彙總——不需 worktree,只需記錄「哪些報告已回收」(`review_legs[]`)。

### 4.1 checkpoint 擴充

沿用現有 `phase / iteration / change_id / branch / resume_exec / non_blocking`,新增:

```jsonc
"units": [                          // 僅 apply/fix 階段使用
  { "id": "g1", "tasks": ["1","2"], "worktree": ".devloop/wt/g1",
    "branch": "<short>-g1", "status": "pending|in_progress|done|merged|conflict|failed" }
],
"review_legs": [                    // 僅 qa/review 階段使用
  { "kind": "qa|code|uiux", "status": "pending|collected", "report": "<path>" }
]
```

### 4.2 引擎新增子命令(stdlib-only)

| 子命令 | 作用 |
|---|---|
| `units-init --groups <json>` | 依平行群為每個 unit `git worktree add` + 建 unit 分支(base=短命分支 HEAD),寫進 checkpoint |
| `unit-done --id <id>` | subagent 完成後標記該 unit done |
| `units-merge` | 把 done 的 unit 分支**依序**合並回短命分支:成功→merged;衝突→標 conflict |
| `units-cleanup` | 移除已 merged 的 worktree + 刪 unit 分支 |
| `legs-init --kinds <…>` | 依 needs_uiux 初始化唯讀型平行 legs |
| `leg-done --kind <…> --report <path>` | 回收某 leg 的報告 |

### 4.3 worktree 生命週期

`worktree add -b <short>-g1 <base>` → subagent 在該 worktree 工作 → `units-merge` 逐一合並回短命分支 → `units-cleanup`(`worktree remove` + 刪 unit 分支)。

### 4.4 合並 / 衝突

並行群以「**檔案不重疊**」為原則(propose 標注時就確保 `files_hint` 不重疊),正常無衝突。萬一衝突 → 該 unit 標 `conflict`,**退回串行**:在最新短命分支 HEAD 上重做該 unit 的 tasks(單一 subagent),**不**嘗試自動解衝突(保持確定性、避免亂解)。

### 4.5 token 用罄續跑

延續「每 checkpoint arm 觸發器」機制。reset 後讀 checkpoint:

- units 未 init → 重新 init;
- 部分 done → **只重新 spawn pending/in_progress 的 unit**(已 done 的 worktree 保留,不浪費);
- 全 done 未 merge → 直接跑 `units-merge`;
- **孤兒 worktree**(磁碟上有、checkpoint 沒記)→ 對賬清掉。

## 5. Propose 的標注格式

**核心原則:不污染 OpenSpec 管理的檔**(避免 `openspec validate --strict` 出問題)。平行群與 uiux 旗標放 dev-loop 自家 metadata,與 checkpoint 同家:

`.devloop/changes/<change-id>.json`
```jsonc
{
  "parallel_groups": [
    { "id": "g1", "tasks": ["1", "2"], "files_hint": ["src/parser/"] },
    { "id": "g2", "tasks": ["3"],      "files_hint": ["src/cli/"] }
  ],
  "needs_uiux": false,
  "finish": null            // 可選:override 全域 config.finish(merge|pr|ask)
}
```

- **`parallel_groups`**:引用 `tasks.md` 的任務編號;每群列涵蓋的 task + `files_hint`(預期動到的檔案範圍,支撐「檔案不重疊」)。沒列進任何群、或群數=1 → 該階段串行(退化成 v1,完全相容)。
- **`needs_uiux`**:決定 Review 階段是否召喚 uiux leg。
- **`finish`**:可選,override 單一 change 的收尾策略。

**誰標注**:Propose 階段由 Opus 在建好 change 後,分析 tasks 獨立性與檔案範圍產出 metadata。
**誰把關**:Proposal Review subagent 檢查標注是否合理(平行群獨立性、`files_hint` 不重疊、needs_uiux 正確);不合理屬 blocking,自動回 propose 修。
**誰消費**:`units-init --groups` 吃 `parallel_groups`;`legs-init` 依 `needs_uiux` 決定是否加 uiux leg。

## 6. 四種審查的契約

統一沿用報告格式:`{"findings":[{"severity":"blocking|non_blocking","level":"…","note":"…"}]}`,引擎依 phase 解讀轉移。

| 審查 | 執行者 | 輸入(真相來源粗體) | 檢查重點 | level | 轉移 |
|---|---|---|---|---|---|
| **Proposal Review** [2.5] | Opus subagent(冷啟動) | change、**設計文件**、`.devloop/changes/<id>.json`、前次報告 | 符合設計?scope 切小?tasks 可執行?**平行群獨立性/檔案不重疊**?needs_uiux 正確? | proposal / design | 無 blocking→✋批准提案;blocking(proposal)→自動回 propose;blocking(design)→逃生門回 brainstorm+升級 |
| **QA Gate** [4.5] | QA subagent(可多情境平行 legs) | 短命分支 code、**proposal 驗收標準**、Hard Gate 報告 | 依驗收標準規劃情境,跑 app/CLI 觀行為、試邊界/回歸 | behavior | 無 blocking→Review;blocking→Fix |
| **Code Review** [5] | Opus subagent(冷啟動) | diff、**proposal**、測試報告、QA 報告、前次報告 | 符合提案?scope drift?TDD 有意義且覆蓋?bug/品質 | code / proposal | 見彙總 |
| **UIUX Review** [5]（僅 needs_uiux） | UI/UX persona subagent(冷啟動) | 前端 diff、**proposal**、設計文件 | component/樣式/a11y/設計一致性/狀態處理(只審碼,不開瀏覽器) | code / proposal | 見彙總 |

**Review 階段彙總(code ‖ uiux 平行 legs)**:兩 leg 平行跑各產報告,`leg-done` 回收後引擎合並 findings——

- 任一 blocking(code 層)→ **Fix**
- 任一 blocking(proposal 層)→ **逃生門**回 propose/brainstorm
- 僅 non_blocking 或無 → **收尾**;non_blocking 一律累積成 follow-up

**引擎入口**:新增 `proposal-review --report`(phase=proposal_review 轉移表)、`qa --report`;`review --report` 擴充成吃 code+uiux 彙總。三者共用既有分級/累積邏輯,僅轉移表不同。

## 7. 收尾(merge / pr / ask)

**config 位置**:`.devloop/config.json`(專案層,與 checkpoint 同家;含既有 `trigger` + 新增 `finish`)。change metadata 的 `finish` 可 override 單一 change。

| finish | 行為 |
|---|---|
| `merge` | 短命分支 merge 回 trunk → `openspec archive` → 終態 |
| `pr` | 分支上先做 **archive commit**(change 移到 archive/ + 同步 specs)→ push → `gh pr create` → 終態(等人 review/合並)。理由:PR 合並後 trunk 自然含 archive 結果 |
| `ask`/未設 | ✋ 停下問人工選 merge 或 pr |

**non_blocking follow-up**:兩條路徑都把 checkpoint 累積的 non_blocking 落成 follow-up——merge 寫進 trunk 的 follow-up 記錄;pr 寫進 PR body。

## 8. 錯誤處理 / 升級

- 平行 subagent 失敗 → unit 標 `failed`,續跑時重 spawn;反覆失敗計入內圈迴圈,超上限升級。
- 合並衝突 → 退串行重做(§4.4)。
- 孤兒 worktree → 續跑對賬清理(§4.5)。
- 兩道 review 各有逃生門回上游(proposal/design 層問題)。
- 內圈 iteration 超上限(預設 3)→ `escalated` 停下,Opus 產未解決摘要(反覆 blocking、嘗試修法、卡點)✋;Proposal Review 的 design 層根本問題 → 回 brainstorm + 升級。

## 9. 測試策略

本 repo 是引擎原始碼家(stdlib-only + pytest,全程 TDD dogfooding):

- 新子命令各自單元測試:`units-init/unit-done/units-merge/units-cleanup`、`legs-init/leg-done`、`proposal-review`、`qa`。
- worktree 操作用臨時 git repo fixture 測:add / 依序 merge / 衝突退串行 / cleanup / 孤兒對賬。
- checkpoint `units[]`/`review_legs[]` 序列化與**續跑對賬**(部分 done 只重 spawn pending)。
- 新狀態轉移表(proposal_review、qa phase)。

## 10. 向後相容

- 無 `parallel_groups` → 串行(等同 v1 Apply/Fix)。
- `needs_uiux=false` → 跳過 uiux leg。
- `finish` 未設 → ask。
- 現有單階段流程不受影響;v1 checkpoint 缺 `units`/`review_legs` 欄位時視為空、走串行路徑。

## 11. 交接產物鏈

設計文件 → OpenSpec change + `.devloop/changes/<id>.json` 標注 → proposal-review 報告 → 短命分支(各 unit worktree 合並)→ Hard Gate 報告 → QA 報告 → 彙總 review 報告(code+uiux)→ follow-up 清單 → merge/PR。

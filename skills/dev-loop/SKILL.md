---
name: dev-loop
description: 依固定流程用 agent 開發 — brainstorming(Opus)→ OpenSpec propose → proposal-review(Opus) → apply+TDD(Sonnet)→ hard gate → QA gate → Opus subagent review(legs) → 自動 merge 回 trunk。只在批准設計、批准提案(proposal-review clean 後)、超過輪數升級三處需人工。
---

# Dev-Loop

形式化的 agent 開發 loop。判斷性步驟由本 skill 編排;確定性狀態交給 `devloop` 引擎 CLI(見 docs/superpowers/specs/2026-06-18-dev-loop-design.md)。

## 設定

- `trigger`:token 用罄續跑的觸發 adapter。`local`(預設,detached watcher)或 `harness`(用 ScheduleWakeup 原生排程)。見「Token 用罄續跑」。
- `finish`:收尾策略 `merge`|`pr`|`ask`(未設等同 `ask`);可被 `.devloop/changes/<id>.json` 的 `finish` override。

## 流程

1. **Brainstorm(Opus)**:用 `/brainstorming` 產出設計文件。✋ 等使用者批准。
2. **Propose(Opus · OpenSpec)**:建立切小的 OpenSpec change(產生 change-id 與短命分支名)。
3. **啟動引擎 + 驗證提案**:`python3 -m devloop.cli start --file .devloop/checkpoint.json --change-id <id> --branch <branch> --resume-exec "<續跑命令,如 claude -p '/dev-loop resume'>" --phase proposal_review`;接著 `python3 -m devloop.cli validate-change --file .devloop/checkpoint.json` 以 strict 確認 change 結構合法。**啟動後立即 arm 觸發器**(見「每個 checkpoint 後 arm」)。
4. **Proposal Review(Opus subagent,冷啟動)**:subagent 審 change(輸入:proposal+spec+tasks、設計文件、.devloop/changes/<id>.json 標注),產報告 JSON(level ∈ proposal/design)。
   `python3 -m devloop.cli proposal-review --file .devloop/checkpoint.json --report <pr.json> [--max-propose N]`
   - clean → phase=apply;✋ 此時等使用者批准提案。
   - blocking(proposal)且未超過 `--max-propose`(預設 3):`propose_attempts` +1,phase=propose,自動重新 propose;propose 完成後呼叫 `python3 -m devloop.cli event --file .devloop/checkpoint.json --event propose_done` 轉回 proposal_review,再跑本步驟的 proposal-review。
   - blocking(proposal)且超過 `--max-propose`:引擎自動改轉 escalated(`propose_retry_exceeded`),✋ 升級給使用者(見「escalated 升級與人工續跑」)。
   - blocking(design)→ escalated,✋ 回 brainstorm 升級。
5. **Apply(Sonnet · TDD)**:
   - **判斷平行**:讀 `.devloop/changes/<change-id>.json` 的 `parallel_groups`。
   - **串行**(0 或 1 群):逐 task red→green→refactor(同 v1)。
   - **平行**(≥2 群):
     1. `python3 -m devloop.cli units-init --file .devloop/checkpoint.json --repo . --meta .devloop/changes/<id>.json --wt-root .devloop/wt`
     2. 對每個 unit,dispatch 一個 Sonnet subagent 在其 `worktree` 上做該群 tasks(TDD);完成後該 subagent 回報,主編排呼叫 `unit-done --id <gid>`。
     3. 全部 done 後:`units-merge --file ... --repo .`。exit 1(衝突)→ 對 conflict 的 unit **退串行**:在最新短命分支 HEAD 重做該群 tasks;衝突 unit 在短命分支重做後 `unit-resolve --id <gid>`(標 merged + 清 worktree),再續 `units-merge`。
     4. `units-cleanup --file ... --repo . --wt-root .devloop/wt` 清掉 worktree。
   - **續跑**:reset 後讀 `units-status`,只對 `pending:` 清單的 unit 重新 dispatch subagent。
   - 完成後 `event --event apply_done`。
6. **Hard gate**:`python3 -m devloop.cli gate --file .devloop/checkpoint.json --cmd "<test-cmd>" --cmd "<lint-cmd>" --cmd "<build-cmd>" [--max-gate N]`(每個 `--cmd` 可為多字詞命令,如 `--cmd "pytest tests/"`)。
   - exit 0 → 階段已進到 qa。
   - exit 1 且未超過 `--max-gate`(預設 3):`gate_failures` +1,階段已進到 fix,回步驟 9。
   - exit 1 且超過 `--max-gate`:引擎自動改轉 escalated(`gate_retry_exceeded`),仍是 exit 1;✋ 升級給使用者(見「escalated 升級與人工續跑」)。`gate_failures` 不隨通過重置,只在人工續跑時歸零。
7. **QA Gate(QA subagent;可多情境平行)**:gate 全綠後 phase=qa。subagent 依 proposal 驗收標準跑 app/CLI 驗行為,產報告(level=behavior)。
   `python3 -m devloop.cli qa --file .devloop/checkpoint.json --report <qa.json>`
   - pass → review;blocking → fix。
8. **Review(code ‖ uiux 平行 legs)**:`legs-init --kinds code[,uiux]`(uiux 僅當 `.devloop/changes/<id>.json` 的 `needs_uiux=true`)。對每個 leg dispatch subagent(code=Opus、uiux=UI/UX persona,皆冷啟動、只審碼),各產報告後 `leg-done --kind <k> --report <p>`。全部 collected → `review --from-legs`,引擎彙總分級前進(merge/fix/propose)。
   - `review_no_blocking` → merge(步驟 10)
   - `review_blocking_code` → fix(步驟 9)
   - `review_blocking_proposal` → 逃生門回步驟 2(必要時步驟 1)
   - 若 `status` 顯示 `escalated`:停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者(見「escalated 升級與人工續跑」)。
9. **Fix**:機械性 → Sonnet;架構性 → Opus。只處理 blocking 項;完成後 `event --event fix_done`,回步驟 6。
10. **收尾(finish 決策驅動)**:review 無 blocking 進入 merge phase 後,先問引擎決策:
   `python3 -m devloop.cli finish --file .devloop/checkpoint.json --config .devloop/config.json --meta .devloop/changes/<id>.json --followup .devloop/followup-<id>.md`
   - stdout `finish: merge` → 短命分支 merge 回 trunk → `python3 -m devloop.cli archive --file .devloop/checkpoint.json`;`followup: <path>` 指出已落地的 non-blocking follow-up 檔。
   - stdout `finish: pr` → `archive`(commit change 移檔)→ push 分支 → `gh pr create`(PR body 放入 `--- PR body follow-up ---` 之後印出的內容)→ 等人 review/合並。
   - stdout `finish: ask` → ✋ 停下問使用者選 merge 或 pr,再依上述對應路徑執行(選定後務必重跑 `finish` 以落地 follow-up)。
   - 上述 git 操作(merge/archive 或開 PR)實際完成後,呼叫 `python3 -m devloop.cli event --file .devloop/checkpoint.json --event finish_done` 推進 `merge → done`(終態)。

## escalated 升級與人工續跑

phase 進到 `escalated` 的三種來源:proposal-review 判 design 層 blocking、`--max-propose` 超限(重複 blocking proposal)、`--max-gate` 超限(重複 gate 失敗)。任一情況都停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者。

使用者處理完根因後(修正設計方向、重新規劃 propose 內容,或手動排除卡住 gate 的問題),依情境選一個人工續跑出口——套用成功後 `iteration`、`propose_attempts`、`gate_failures` 三個計數會全部歸零,重新起算上限:

- `python3 -m devloop.cli event --file .devloop/checkpoint.json --event human_resume_propose` → phase=propose,續跑步驟 2(重新 propose)。
- `python3 -m devloop.cli event --file .devloop/checkpoint.json --event human_resume_fix` → phase=fix,續跑步驟 9(直接修)。

套用後記得依「每個 checkpoint 後 arm」重新確保續跑觸發器在位。

## 每個 checkpoint 後 arm

每個會寫 checkpoint 的點(`start`、`event`、`gate`、`proposal-review`、`qa`、`leg-done`、`review`)之後,**確保續跑觸發器在位**——這是 token 用罄前的事前部署,缺它續跑就不會啟動。依 `trigger` 設定:

- `trigger=local`(預設):`python3 -m devloop.cli arm-local --file .devloop/checkpoint.json`
  - idempotent:watcher 已存活則 no-op,死了自癒重生。需 checkpoint 已有 `resume_exec`(於 `start` 帶入)。
- `trigger=harness`:呼叫 `ScheduleWakeup`(一次性,故每 checkpoint 刷新一個),fire 時冷啟動跑續跑命令(如 `/dev-loop resume`)。

`units-init`/`unit-done`/`units-merge` 之後同樣要確保觸發器在位(它們都寫 checkpoint)。

## Token 用罄續跑

續跑的核心是**每個 checkpoint 自動 arm**(見上),token 用罄當下觸發器已就位:reset 後它會週期重試續跑命令直到成功,被推進的 agent 在其首個 checkpoint 再次 arm,心跳自我延續。

`arm-local` spawn 的 watcher 是獨立 OS 程序(不依賴被卡住的 agent):反覆執行 `resume_exec`,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s,上限 3600s)再試。續跑命令從 checkpoint 的 phase 接著跑。

**進階(已知 reset 時間想精準睡)**:
- 一次性決策:`python3 -m devloop.cli resume --file .devloop/checkpoint.json --reset-at <ISO>` 回傳 ready / sleep_seconds / phase。
- 精準睡到 T 再跑一次:`python3 -m devloop.cli auto-resume --file .devloop/checkpoint.json --reset-at <T 的 ISO> --exec "<續跑命令>"`。

> 雲端替代方案:`trigger=harness` 搭配 cron / `/schedule` 在 reset 觸發續跑命令,並改為每階段把分支 + checkpoint push 到 remote(見規格 §9B)。

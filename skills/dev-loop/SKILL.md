---
name: dev-loop
description: 依固定流程用 agent 開發 — brainstorming(Opus)→ OpenSpec propose → proposal-review(Opus) → apply+TDD(Sonnet)→ hard gate → QA gate → Opus subagent review(legs) → 自動 merge 回 trunk。人工關卡:批准設計、批准提案(兩者可用 config `auto_approve` 關閉)、超過輪數升級(恆停)。判斷步驟可選 superpowers skills 驅動(config `superpowers`)。
---

# Dev-Loop

形式化的 agent 開發 loop。判斷性步驟由本 skill 編排;確定性狀態交給 `devloop` 引擎 CLI(見 docs/superpowers/specs/2026-06-18-dev-loop-design.md)。續跑觸發是引擎自動兜底的基礎設施,不是本 skill 要記的事(見「續跑觸發(watcher)」)。

## 設定

- `finish`:收尾策略 `merge`|`pr`|`ask`(未設等同 `ask`);可被 `.devloop/changes/<id>.json` 的 `finish` override。
- `gate_cmds`:list,專案的 test/lint/build 命令。設了之後 gate 可不帶 `--cmd`;**首次為專案跑 gate 時,把推斷出的命令寫進 config 的 `gate_cmds`**,之後(含冷啟動續跑)就不用再推斷。
- `superpowers`:布林。true 時判斷型步驟優先用 superpowers skills 驅動(對照見「Superpowers 整合」);false 用內建做法。未設(或非布林)→ 第一次啟動時 ✋ 問使用者並寫回 config。
- `auto_approve`:布林,預設 false。true 時「批准設計」「批准提案」兩個 ✋ 關卡自動視為批准、不停;**escalated 恆停不受此鍵影響**(它是重試耗盡/設計層 blocking 的安全閥),收尾詢問由 `finish` 鍵管。未設 → 第一次啟動時 ✋ 問使用者並寫回 config。
- `auto_arm`:布林,預設 true。false 時關閉引擎自動 arm(僅影響 auto-arm,`arm-local` 手動路徑不受影響)。一般不需要動這個鍵。

## 核心迴圈

無論是第一次啟動還是被觸發器續跑,每回合遵循同一套邏輯:

1. **讀 phase**:有 checkpoint 就跑 `python3 -m devloop.cli status --file .devloop/checkpoint.json`,依第二行 `next:` hint 判斷這回合要做什麼(見「Resume(續跑)」);沒有 checkpoint 就是第一次啟動——先讀 `.devloop/config.json`,`superpowers` 或 `auto_approve` 有未設的就 ✋ 一次問齊使用者(用不用 superpowers 流程;批准關卡要人工還是自動)並寫回 config(之後不再問),然後從「流程」步驟 1 開始。
2. **推進到卡點**:照 `next:` hint(或流程步驟)一路做到下一個卡點——✋ 人工批准點,或本回合 token/時間用盡。
3. **未到終態即本回合結束**:若 phase 還不是 `done` 或停等人工的 `escalated`,本回合到此為止;token/配額恢復後由引擎自動 arm 的 detached watcher 冷啟動續跑(見「Token 用罄續跑」),本 skill 不需自行排程。

## 流程

1. **Brainstorm(Opus)**:產出設計文件——`superpowers=true` 用 `superpowers:brainstorming`,false 直接與使用者對話探索需求後撰寫。`auto_approve=false` → ✋ 等使用者批准;true → 視為批准,直接進步驟 2。
2. **Propose(Opus · OpenSpec)**:建立切小的 OpenSpec change(產生 change-id 與短命分支名)。
3. **啟動引擎 + 驗證提案**:`python3 -m devloop.cli start --file .devloop/checkpoint.json --change-id <id> --branch <branch> --resume-exec "<續跑命令,如 claude -p '/dev-loop resume'>" --phase proposal_review`;接著 `python3 -m devloop.cli validate-change --file .devloop/checkpoint.json` 以 strict 確認 change 結構合法。若 start 報 `checkpoint exists`(exit 2):既有 loop 尚未完結——先跑 `status` 判斷該 resume 還是升級給使用者,**不要**逕自 `--force` 覆蓋。
4. **Proposal Review(Opus subagent,冷啟動)**:subagent 審 change(輸入:proposal+spec+tasks、設計文件、.devloop/changes/<id>.json 標注),產報告 JSON(level ∈ proposal/design)。
   `python3 -m devloop.cli proposal-review --file .devloop/checkpoint.json --report <pr.json> [--max-propose N]`
   - clean → phase=apply;`auto_approve=false` → ✋ 此時等使用者批准提案;true → 視為批准,直接進步驟 5。
   - blocking(proposal)且未超過 `--max-propose`(預設 3):`propose_attempts` +1,phase=propose,自動重新 propose;propose 完成後呼叫 `python3 -m devloop.cli event --file .devloop/checkpoint.json --event propose_done` 轉回 proposal_review,再跑本步驟的 proposal-review。
   - blocking(proposal)且超過 `--max-propose`:引擎自動改轉 escalated(`propose_retry_exceeded`),✋ 升級給使用者(見「escalated 升級與人工續跑」)。
   - blocking(design)→ escalated,✋ 回 brainstorm 升級。
5. **Apply(Sonnet · TDD)**:
   - **判斷平行**:讀 `.devloop/changes/<change-id>.json` 的 `parallel_groups`。
   - **串行**(0 或 1 群):逐 task red→green→refactor(同 v1;`superpowers=true` 時要求遵循 `superpowers:test-driven-development`)。
   - **平行**(≥2 群):
     1. `python3 -m devloop.cli units-init --file .devloop/checkpoint.json --repo . --meta .devloop/changes/<id>.json --wt-root .devloop/wt`
     2. 對每個 unit,dispatch 一個 Sonnet subagent 在其 `worktree` 上做該群 tasks(TDD);完成後該 subagent 回報,主編排呼叫 `unit-done --id <gid>`。
     3. 全部 done 後:`units-merge --file ... --repo .`。exit 1(衝突)→ 對 conflict 的 unit **退串行**:在最新短命分支 HEAD 重做該群 tasks;衝突 unit 在短命分支重做後 `unit-resolve --id <gid>`(標 merged + 清 worktree),再續 `units-merge`。
     4. `units-cleanup --file ... --repo . --wt-root .devloop/wt` 清掉 worktree。
   - **續跑**:reset 後讀 `units-status`,只對 `pending:` 清單的 unit 重新 dispatch subagent。
   - 完成後 `event --event apply_done`。
6. **Hard gate**:`python3 -m devloop.cli gate --file .devloop/checkpoint.json [--cmd "<test-cmd>" ...] [--max-gate N]`。config 有 `gate_cmds` 時不帶 `--cmd` 直接跑;否則帶 `--cmd`(每個可為多字詞命令,如 `--cmd "pytest tests/"`)**並同時把命令寫進 config 的 `gate_cmds`** 供之後續跑零判斷。兩者皆無 → exit 2(不假綠)。
   - exit 0 → 階段已進到 qa。
   - exit 1:`gate_failures` +1(未超過 `--max-gate`,預設 3),階段已進到 fix,回步驟 9。
   - exit 3:連續失敗超過 `--max-gate`,引擎已轉 escalated(`gate_retry_exceeded`);✋ 升級給使用者(見「escalated 升級與人工續跑」)。失敗分支末行都會印 `phase=`,exit code 即可分流,不需再讀 status。`gate_failures` 不隨通過重置,只在人工續跑時歸零。
7. **QA Gate(QA subagent;可多情境平行)**:gate 全綠後 phase=qa。subagent 依 proposal 驗收標準跑 app/CLI 驗行為,產報告(level=behavior)。
   `python3 -m devloop.cli qa --file .devloop/checkpoint.json --report <qa.json>`
   - pass → review;blocking → fix。
8. **Review(code ‖ uiux 平行 legs)**:`legs-init --kinds code[,uiux]`(uiux 僅當 `.devloop/changes/<id>.json` 的 `needs_uiux=true`)。對每個 leg dispatch subagent(code=Opus、uiux=UI/UX persona,皆冷啟動、只審碼),各產報告後 `leg-done --kind <k> --report <p>`。全部 collected → `review --from-legs`,引擎彙總分級前進(merge/fix/propose)。
   - `review_no_blocking` → merge(步驟 10)
   - `review_blocking_code` → fix(步驟 9)
   - `review_blocking_proposal` → 逃生門回步驟 2(必要時步驟 1)
   - 若 `status` 顯示 `escalated`:停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者(見「escalated 升級與人工續跑」)。
9. **Fix**:機械性 → Sonnet;架構性 → Opus(`superpowers=true` 且問題難纏時,subagent prompt 要求以 `superpowers:systematic-debugging` 找根因再修)。只處理 blocking 項;完成後 `event --event fix_done`,回步驟 6。
10. **收尾(finish 決策驅動)**:review 無 blocking 進入 merge phase 後,先問引擎決策:
   `python3 -m devloop.cli finish --file .devloop/checkpoint.json --config .devloop/config.json --meta .devloop/changes/<id>.json --followup .devloop/followup-<id>.md`
   - stdout `finish: merge` → 短命分支 merge 回 trunk → `python3 -m devloop.cli archive --file .devloop/checkpoint.json`;`followup: <path>` 指出已落地的 non-blocking follow-up 檔。archive 會自動把該 change 的工作檔(報告/followup/history 等)收進 `.devloop/archive/<change-id>/`,不需手動清理。
   - stdout `finish: pr` → `archive`(commit change 移檔)→ push 分支 → `gh pr create`(PR body 放入 `--- PR body follow-up ---` 之後印出的內容)→ 等人 review/合並。
   - stdout `finish: ask` → ✋ 停下問使用者選 merge 或 pr,再依上述對應路徑執行(選定後務必重跑 `finish` 以落地 follow-up)。
   - 上述 git 操作(merge/archive 或開 PR)實際完成後,呼叫 `python3 -m devloop.cli event --file .devloop/checkpoint.json --event finish_done` 推進 `merge → done`(終態)。

## Superpowers 整合

`superpowers=true` 時,各判斷型步驟優先以對應 skill 驅動;**skill 未安裝(呼叫失敗)時 fallback 到內建做法,不中斷 loop**:

| 步驟 | superpowers skill | `false` / 未安裝時 |
|---|---|---|
| 1 Brainstorm | `superpowers:brainstorming` | 直接與使用者對話產出設計文件 |
| 5 Apply(subagent prompt)| `superpowers:test-driven-development` | prompt 內建 red→green→refactor 要求 |
| 8 Review code leg(subagent prompt)| `superpowers:requesting-code-review` 的審查標準 | 內建審查 prompt |
| 9 Fix(難纏 bug)| `superpowers:systematic-debugging` | 直接分析修復 |

無論開關,產物與引擎接口不變:設計文件、OpenSpec change、報告 JSON、事件推進全是同一套——superpowers 只改變「判斷步驟怎麼做」,不改變流程、gate 與報告格式。

## escalated 升級與人工續跑

phase 進到 `escalated` 的三種來源:proposal-review 判 design 層 blocking、`--max-propose` 超限(重複 blocking proposal)、`--max-gate` 超限(重複 gate 失敗)。任一情況都停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者——**不受 `auto_approve` 影響,恆停**:批准關卡可自動化,安全閥不行。

使用者處理完根因後(修正設計方向、重新規劃 propose 內容,或手動排除卡住 gate 的問題),依情境選一個人工續跑出口——套用成功後 `iteration`、`propose_attempts`、`gate_failures` 三個計數會全部歸零,重新起算上限:

- `python3 -m devloop.cli event --file .devloop/checkpoint.json --event human_resume_propose` → phase=propose,續跑步驟 2(重新 propose)。
- `python3 -m devloop.cli event --file .devloop/checkpoint.json --event human_resume_fix` → phase=fix,續跑步驟 9(直接修)。

## Resume(續跑)

冷啟動續跑(被 watcher 或 `/loop` 喚醒、或使用者說「dev-loop resume」)不需要記哪個 phase 對應哪個命令——跑一次 `status`,照第二行 `next:` 行動即可:

```
python3 -m devloop.cli status --file .devloop/checkpoint.json
```

- 第二行是完整命令骨架(如 `next: python3 -m devloop.cli gate --file ... --cmd "<test-cmd>"`)→ 依骨架補上實際參數執行。
- 第二行是 `next: dispatch <說明>`(判斷型步驟,如 apply/fix/propose)→ 依「流程」對應步驟繼續判斷與 dispatch。
- 第二行是 `next: (done)` → loop 已完成,無需動作。
- 第二行是 `next: (escalated)…` → 走「escalated 升級與人工續跑」。
- 若 units 有 pending 或 review legs 未收齊,`next:` 行會優先提示該未完成項(如 `units-status` 或缺 leg 報告),照做即可。

## 續跑觸發(watcher)

引擎在每個寫 checkpoint 的子命令 save 之後自動確保續跑 watcher 在位(`resume_exec` 非空且 `auto_arm` 未關閉時),SKILL 不需要手動呼叫 `arm-local`。watcher 是 detached OS 程序,週期重試 `resume_exec`,回 0 即停。

## Token 用罄續跑

續跑觸發器由引擎自動兜底(見「續跑觸發(watcher)」),watcher 反覆執行 `resume_exec`(從 checkpoint 的 phase 接著跑),回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s,上限 3600s)再試;`start` 以 `--resume-exec` 把續跑命令寫進 checkpoint 是這一切的起點。

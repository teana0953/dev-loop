---
name: dev-loop
description: 依固定流程用 agent 開發 — brainstorming(Opus)→ OpenSpec propose → apply+TDD(Sonnet)→ Opus subagent review/re-review → 自動 merge 回 trunk。只在批准設計、批准提案、超過輪數升級三處需人工。
---

# Dev-Loop

形式化的 agent 開發 loop。判斷性步驟由本 skill 編排;確定性狀態交給 `devloop` 引擎 CLI(見 docs/superpowers/specs/2026-06-18-dev-loop-design.md)。

## 流程

1. **Brainstorm(Opus)**:用 `/brainstorming` 產出設計文件。✋ 等使用者批准。
2. **Propose(Opus · OpenSpec)**:建立切小的 OpenSpec change(產生 change-id 與短命分支名)。
3. **啟動引擎 + 驗證提案**:`python3 -m devloop.cli start --file .devloop/checkpoint.json --change-id <id> --branch <branch>`;接著 `python3 -m devloop.cli validate-change --file .devloop/checkpoint.json` 以 strict 確認 change 結構合法。✋ 驗證通過後等使用者批准提案。
4. **Apply(Sonnet · TDD)**:逐 task red→green→refactor。完成後 `python3 -m devloop.cli event --file .devloop/checkpoint.json --event apply_done`。
5. **Hard gate**:`python3 -m devloop.cli gate --file .devloop/checkpoint.json --cmd "<test-cmd>" --cmd "<lint-cmd>" --cmd "<build-cmd>"`(每個 `--cmd` 可為多字詞命令,如 `--cmd "pytest tests/"`)。
   - exit 0 → 階段已進到 review。
   - exit 1 → 階段已進到 fix,回步驟 7。
6. **Review(Opus subagent,冷啟動)**:輸入 diff + OpenSpec proposal(真相來源)+ 測試報告 + 前次 review 報告;產出 review 報告 JSON(`findings[]`,severity ∈ blocking/non_blocking,level ∈ code/proposal)。
   - 產出 review 報告 JSON 後執行:`python3 -m devloop.cli review --file .devloop/checkpoint.json --report <report.json>`,引擎會分級、累積 non-blocking、並依結果前進到 merge / fix / propose。
     - `review_no_blocking` → merge(步驟 8)
     - `review_blocking_code` → fix(步驟 7)
     - `review_blocking_proposal` → 逃生門回步驟 2(必要時步驟 1)
   - 若 `status` 顯示 `escalated`:停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者。
7. **Fix**:機械性 → Sonnet;架構性 → Opus。只處理 blocking 項;完成後 `event --event fix_done`,回步驟 5。
8. **Merge & Archive(自動)**:短命分支 merge 回 trunk →`python3 -m devloop.cli archive --file .devloop/checkpoint.json`(歸檔 change、同步 main specs)→ 將 checkpoint 累積的 non-blocking 項落成 follow-up。

## Token 用罄續跑

每階段轉移後 checkpoint 已更新。預設本機 resume:用 `python3 -m devloop.cli resume --file .devloop/checkpoint.json --reset-at <ISO>` 取得 ready / sleep_seconds / phase;ready=True 即從該 phase 續跑,否則睡 sleep_seconds 後重檢(週期性重排,因 wakeup 上限 3600 秒)。到 reset 後從 checkpoint 的 phase 續跑。

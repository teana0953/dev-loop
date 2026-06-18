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

每階段轉移後 checkpoint 已更新。

**一次性決策**:`python3 -m devloop.cli resume --file .devloop/checkpoint.json --reset-at <ISO>` 回傳 ready / sleep_seconds / phase。

**本機自動續跑(預設 adapter)**:當偵測到 usage limit、得知 reset 時間點 T 後,在 **agent 以外的獨立終端機**執行:

```
python3 -m devloop.cli auto-resume \
  --file .devloop/checkpoint.json \
  --reset-at <T 的 ISO 字串> \
  --exec "<你的續跑命令,例如 claude -p '/dev-loop resume'>"
```

它是一個獨立 OS 程序(不依賴當下被卡住的 agent):反覆讀 checkpoint、依 `plan_resume` 決定還要睡多久(每次最多 3600 秒,週期性重排),睡到 T 後執行 `--exec` 的續跑命令,並回傳其 exit code。續跑命令會從 checkpoint 的 phase 接著跑。

> 雲端替代方案:改用 cron / `/schedule` 在 T 觸發同一條 `--exec`,並改為每階段把分支 + checkpoint push 到 remote(見規格 §9B)。

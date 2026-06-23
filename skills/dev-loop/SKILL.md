---
name: dev-loop
description: 依固定流程用 agent 開發 — brainstorming(Opus)→ OpenSpec propose → apply+TDD(Sonnet)→ Opus subagent review/re-review → 自動 merge 回 trunk。只在批准設計、批准提案、超過輪數升級三處需人工。
---

# Dev-Loop

形式化的 agent 開發 loop。判斷性步驟由本 skill 編排;確定性狀態交給 `devloop` 引擎 CLI(見 docs/superpowers/specs/2026-06-18-dev-loop-design.md)。

## 設定

- `trigger`:token 用罄續跑的觸發 adapter。`local`(預設,detached watcher)或 `harness`(用 ScheduleWakeup 原生排程)。見「Token 用罄續跑」。

## 流程

1. **Brainstorm(Opus)**:用 `/brainstorming` 產出設計文件。✋ 等使用者批准。
2. **Propose(Opus · OpenSpec)**:建立切小的 OpenSpec change(產生 change-id 與短命分支名)。
3. **啟動引擎 + 驗證提案**:`python3 -m devloop.cli start --file .devloop/checkpoint.json --change-id <id> --branch <branch> --resume-exec "<續跑命令,如 claude -p '/dev-loop resume'>"`;接著 `python3 -m devloop.cli validate-change --file .devloop/checkpoint.json` 以 strict 確認 change 結構合法。**啟動後立即 arm 觸發器**(見「每個 checkpoint 後 arm」)。✋ 驗證通過後等使用者批准提案。
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

## 每個 checkpoint 後 arm

每個會寫 checkpoint 的點(`start`、`event`、`gate`、`review`)之後,**確保續跑觸發器在位**——這是 token 用罄前的事前部署,缺它續跑就不會啟動。依 `trigger` 設定:

- `trigger=local`(預設):`python3 -m devloop.cli arm-local --file .devloop/checkpoint.json`
  - idempotent:watcher 已存活則 no-op,死了自癒重生。需 checkpoint 已有 `resume_exec`(於 `start` 帶入)。
- `trigger=harness`:呼叫 `ScheduleWakeup`(一次性,故每 checkpoint 刷新一個),fire 時冷啟動跑續跑命令(如 `/dev-loop resume`)。

## Token 用罄續跑

續跑的核心是**每個 checkpoint 自動 arm**(見上),token 用罄當下觸發器已就位:reset 後它會週期重試續跑命令直到成功,被推進的 agent 在其首個 checkpoint 再次 arm,心跳自我延續。

`arm-local` spawn 的 watcher 是獨立 OS 程序(不依賴被卡住的 agent):反覆執行 `resume_exec`,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s,上限 3600s)再試。續跑命令從 checkpoint 的 phase 接著跑。

**進階(已知 reset 時間想精準睡)**:
- 一次性決策:`python3 -m devloop.cli resume --file .devloop/checkpoint.json --reset-at <ISO>` 回傳 ready / sleep_seconds / phase。
- 精準睡到 T 再跑一次:`python3 -m devloop.cli auto-resume --file .devloop/checkpoint.json --reset-at <T 的 ISO> --exec "<續跑命令>"`。

> 雲端替代方案:`trigger=harness` 搭配 cron / `/schedule` 在 reset 觸發續跑命令,並改為每階段把分支 + checkpoint push 到 remote(見規格 §9B)。

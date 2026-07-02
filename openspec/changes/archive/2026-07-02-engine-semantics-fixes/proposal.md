## Why

v2 引擎驗收後發現三個狀態機確定性缺口:`propose` 無 outbound 轉移(blocking(proposal) 回 propose 後 `proposal-review` 直接 exit 2,已實測重現)、gate↔fix 內圈不計 iteration(測試永紅時無限迴圈永不升級)、`escalated` 無出口(人工介入後只能重跑 `start`)。另 `finish` 值域無驗證,typo 靜默退化成 ask-like。這些會讓自動 loop 卡死或靜默失敗,是 v2.1 loop-native 重構(Change B)的前置。

## What Changes

- 新增 event `propose_done`(`propose → proposal_review`):補回 re-propose 後的回路。
- checkpoint 新增 `propose_attempts` / `gate_failures` 計數欄位(缺欄位視為 0,向後相容)。
- 新增升級 events:`propose_retry_exceeded`(`proposal_review → escalated`)、`gate_retry_exceeded`(`gate → escalated`);cli 依計數超上限(各預設 3,`--max-propose` / `--max-gate`)改發。
- 新增人工續跑 events:`human_resume_propose`(`escalated → propose`)、`human_resume_fix`(`escalated → fix`);套用時三個計數(iteration/propose_attempts/gate_failures)歸零。
- `resolve_finish` 對非 `{merge, pr, ask, null}` 值報錯(cli exit 2 + stderr),不再靜默退化。
- 小項:`render_followup` 補 trailing newline、cli.py import 順序整理(實作細節,不動 spec)。
- SKILL.md 源頭同步:步驟 4 補 `propose_done` 指示、升級節補 human_resume 出口。

## Capabilities

### New Capabilities
- `statemachine-guardrails`: 狀態機回路完整性與迴圈保護 — propose 回路、propose/gate 重試計數與超限升級、escalated 人工續跑出口與計數歸零。
- `finish-validation`: finish 收尾策略值域驗證 — 無效值明確報錯而非靜默退化。

### Modified Capabilities

(無 — `cli-status`、`resume-trigger` 的既有需求不變)

## Impact

- `devloop/statemachine.py`:轉移表新增 5 條(events 常數 + transition 分支)。
- `devloop/checkpoint.py`:新增 2 欄位序列化。
- `devloop/cli.py`:`proposal-review`/`gate`/`event` 計數與改發邏輯、`finish` 驗證錯誤路徑、import 順序。
- `devloop/config.py` 或 `finish.py`:`resolve_finish` 驗證、`render_followup` newline。
- `skills/dev-loop/SKILL.md`:流程指示同步。
- 測試:`tests/` 對應單測(TDD)。無外部依賴變更;v2 checkpoint 完全向後相容。

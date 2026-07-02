## 1. 狀態機轉移表

- [x] 1.1 TDD:`statemachine.py` 新增 5 個 event 常數與轉移分支(`propose_done`、`propose_retry_exceeded`、`gate_retry_exceeded`、`human_resume_propose`、`human_resume_fix`);單測覆蓋每條新轉移 + 非法 phase 的 InvalidTransition 邊界

## 2. checkpoint 欄位

- [x] 2.1 TDD:`checkpoint.py` 新增 `propose_attempts`、`gate_failures` 欄位;序列化往返 + 缺欄位載入視為 0(v2 向後相容)

## 3. cli 計數與改發

- [x] 3.1 TDD:`_cmd_proposal_review` — blocking(proposal) 時 `propose_attempts += 1`;超過 `--max-propose`(預設 3)改套用 `propose_retry_exceeded` → escalated
- [x] 3.2 TDD:`_cmd_gate` — 失敗時 `gate_failures += 1`;超過 `--max-gate`(預設 3)改套用 `gate_retry_exceeded` → escalated(仍印失敗輸出、exit 1);gate_pass 不重置計數
- [x] 3.3 TDD:`_cmd_event` — `human_resume_propose`/`human_resume_fix` 套用成功後歸零 `iteration`/`propose_attempts`/`gate_failures`

## 4. finish 驗證與小項

- [ ] 4.1 TDD:`resolve_finish` 對非 `{merge, pr, ask, None}` 拋 ValueError;cli `finish` 捕捉印 `error: invalid finish value <v>` exit 2;合法值行為不變
- [ ] 4.2 小項:`render_followup` 補 trailing newline(調整既有斷言);cli.py import 順序整理;全套測試綠

## 5. SKILL 源頭同步

- [ ] 5.1 `skills/dev-loop/SKILL.md`:步驟 4 blocking(proposal) 路徑補「重新 propose 後 `event --event propose_done` 再 proposal-review」;升級敘述補 `human_resume_propose`/`human_resume_fix` 人工續跑出口

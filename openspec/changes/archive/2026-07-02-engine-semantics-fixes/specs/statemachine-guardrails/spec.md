## ADDED Requirements

### Requirement: propose 階段可回到 proposal_review
狀態機 SHALL 提供 `propose_done` event:phase 為 `propose` 時套用後轉移到 `proposal_review`,iteration 不變。

#### Scenario: 重新 propose 完成後回審
- **WHEN** phase 為 `propose`,對引擎發 `event --event propose_done`
- **THEN** phase 轉移到 `proposal_review`,checkpoint 寫回且 exit 0

#### Scenario: 其他 phase 不接受 propose_done
- **WHEN** phase 非 `propose`(如 `apply`),發 `propose_done`
- **THEN** 引擎報 InvalidTransition 錯誤,exit 2,checkpoint 不變

### Requirement: propose 重試計數與超限升級
checkpoint SHALL 持有 `propose_attempts`(缺欄位視為 0)。`proposal-review` 分類結果為 blocking(proposal) 時 cli SHALL 將其 +1;若 +1 後超過上限(`--max-propose`,預設 3)SHALL 改套用 `propose_retry_exceeded` event(`proposal_review → escalated`)而非回 propose。

#### Scenario: 未超限回 propose 並計數
- **WHEN** phase 為 `proposal_review`、`propose_attempts` 為 1,proposal-review 報告含 blocking(level=proposal)
- **THEN** phase 轉移到 `propose`,`propose_attempts` 變 2

#### Scenario: 超限升級 escalated
- **WHEN** phase 為 `proposal_review`、`propose_attempts` 為 3(等於上限),報告仍含 blocking(level=proposal)
- **THEN** phase 轉移到 `escalated`(不回 propose),`propose_attempts` 變 4

#### Scenario: 舊 checkpoint 缺欄位
- **WHEN** 載入無 `propose_attempts` 欄位的 v2 checkpoint
- **THEN** 視為 0,不報錯

### Requirement: gate 失敗計數與超限升級
checkpoint SHALL 持有 `gate_failures`(缺欄位視為 0;不隨 gate_pass 重置)。`gate` 命令失敗時 cli SHALL 將其 +1;若 +1 後超過上限(`--max-gate`,預設 3)SHALL 改套用 `gate_retry_exceeded` event(`gate → escalated`)而非轉 fix,並仍印失敗輸出、exit 1。

#### Scenario: 未超限轉 fix 並計數
- **WHEN** phase 為 `gate`、`gate_failures` 為 0,gate 命令有失敗項
- **THEN** phase 轉移到 `fix`,`gate_failures` 變 1,exit 1

#### Scenario: 累計超限升級 escalated
- **WHEN** phase 為 `gate`、`gate_failures` 為 3(等於上限),gate 再度失敗
- **THEN** phase 轉移到 `escalated`,`gate_failures` 變 4,仍印失敗輸出且 exit 1

#### Scenario: gate 通過不重置計數
- **WHEN** `gate_failures` 為 2,gate 命令全綠
- **THEN** phase 依既有 `gate_pass` 語義前進(qa 或 escalated),`gate_failures` 維持 2

### Requirement: escalated 人工續跑出口
狀態機 SHALL 提供 `human_resume_propose`(`escalated → propose`)與 `human_resume_fix`(`escalated → fix`)events。cli 套用任一 human_resume event 成功後 SHALL 將 `iteration`、`propose_attempts`、`gate_failures` 全部歸零。

#### Scenario: 人工續跑回 propose 並歸零計數
- **WHEN** phase 為 `escalated`(iteration=4、propose_attempts=4、gate_failures=2),發 `event --event human_resume_propose`
- **THEN** phase 轉移到 `propose`,三個計數皆為 0

#### Scenario: 人工續跑回 fix
- **WHEN** phase 為 `escalated`,發 `event --event human_resume_fix`
- **THEN** phase 轉移到 `fix`,三個計數皆為 0

#### Scenario: 非 escalated 不接受 human_resume
- **WHEN** phase 為 `review`,發 `human_resume_fix`
- **THEN** 引擎報 InvalidTransition 錯誤,exit 2,checkpoint 不變

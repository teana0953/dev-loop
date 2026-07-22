# statemachine-guardrails Specification (delta)

## ADDED Requirements

### Requirement: qa_skip 轉移
狀態機 SHALL 接受 `(qa, qa_skip) → review` 轉移(iteration 不變)。其他 phase 對 `qa_skip` SHALL 拋 InvalidTransition。CLI 層 guard(僅 light 且非 uiux 放行)見 flow-profile spec;transition 純函式本身 MUST 不讀 checkpoint。

#### Scenario: qa 上的 qa_skip
- **WHEN** `transition("qa", i, "qa_skip")`
- **THEN** 回 `("review", i)`

#### Scenario: 非 qa phase 拒絕
- **WHEN** `transition("gate", i, "qa_skip")`
- **THEN** 拋 InvalidTransition

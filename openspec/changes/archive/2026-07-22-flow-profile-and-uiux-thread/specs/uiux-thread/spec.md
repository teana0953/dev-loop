# uiux-thread Specification (delta)

## ADDED Requirements

### Requirement: needs_uiux 自動判定與人工推翻
編排 skill SHALL 在 brainstorm 依正本準則(change 觸及使用者可見介面或互動;UI 視覺與 UX 流程互動皆算)自動判定 `needs_uiux`,寫入設計產物與 change meta,並在「批准提案」關卡明示判定值供使用者推翻;推翻 SHALL 落地為 meta 修改。`auto_approve=true` 時判定值自動視為接受。

#### Scenario: 自動判定寫入 meta
- **WHEN** 需求含使用者可見介面變更,brainstorm 完成
- **THEN** change meta `needs_uiux=true`,批准提案時明示此值

#### Scenario: 人工推翻
- **WHEN** 使用者在批准提案時否定判定
- **THEN** meta 更新為使用者指定值,後續階段依新值

### Requirement: UI/UX 線貫穿各階段
`needs_uiux=true` 時:設計文件 SHALL 含「UI/UX 設計」節(視覺一致性、使用者路徑、狀態/錯誤/空狀態);OpenSpec spec SHALL 含可驗的 UI/UX 驗收 scenario(可觀察行為;MUST NOT 收「好看」類不可驗主觀句);QA subagent prompt SHALL 併入依驗收 scenario 的 UX 檢查;review SHALL 含 uiux leg(現行 kinds 規則 `code[,uiux]` 不變)。各階段指示以 `references/uiux-thread.md` 為唯一正本,編排 MUST NOT 即興改寫。

#### Scenario: 設計與驗收含 UX
- **WHEN** needs_uiux=true 的 change 完成 propose
- **THEN** design 含 UI/UX 節,spec 含可驗 UI/UX scenario

#### Scenario: QA 驗 UX
- **WHEN** needs_uiux=true 進入 qa 階段
- **THEN** QA 報告涵蓋 UI/UX 驗收 scenario 的檢查結果

### Requirement: UX 線不受裁剪
`flow_profile=light` 且 `needs_uiux=true` 時:QA SHALL 保留且至少驗 UI/UX 驗收 scenario(功能面由 gate 與 review 把關);uiux review leg SHALL 保留;引擎 qa_skip guard MUST 拒絕此組合(見 flow-profile spec)。

#### Scenario: light+uiux 的 QA 只驗 UX
- **WHEN** flow_profile=light、needs_uiux=true 進入 qa
- **THEN** QA 執行且範圍為 UI/UX 驗收 scenario;qa_skip 不可用

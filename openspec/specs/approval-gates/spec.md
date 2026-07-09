# approval-gates Specification

## Purpose
人工介入的量是使用者的選擇:「批准設計」「批准提案」兩個 ✋ 關卡可自動化(`auto_approve`),但 escalated 是重試耗盡/設計層 blocking 的安全閥,恆停、不可關。`auto_approve: true` + `finish: merge` 構成全自動 loop。

## Requirements
### Requirement: config auto_approve 保守載入
`load_config` SHALL 載入 `auto_approve` 鍵,且只認 JSON `true`;缺鍵、`false`、以及任何非布林值(`"true"`、`1` 等 truthy 錯值)SHALL 一律為 False——此鍵管的是略過人工關卡,解析錯誤 MUST 朝「要人工」方向退化,不得被 coerce 成自動批准。

#### Scenario: 只認 JSON true
- **WHEN** config 分別為 `{"auto_approve": true}`、`{"auto_approve": "true"}`、`{"auto_approve": 1}`、缺鍵
- **THEN** `Config.auto_approve` 分別為 True、False、False、False

### Requirement: 批准關卡依開關停或不停
`auto_approve=false`(預設)時,編排 skill SHALL 在設計文件產出後與 proposal-review 判 clean 後 ✋ 停等使用者批准;`true` 時該兩處 SHALL 視為批准、直接續跑。收尾詢問 MUST 仍由 `finish` 鍵獨立決定,不受本鍵影響。

#### Scenario: 預設停等
- **WHEN** `auto_approve` 未設,brainstorm 產出設計文件
- **THEN** ✋ 等使用者批准後才 propose

#### Scenario: 開啟後直通
- **WHEN** `auto_approve: true`,proposal-review 判 clean(phase=apply)
- **THEN** 不停等,直接進 apply

### Requirement: escalated 安全閥恆停
phase 進入 `escalated`(design 層 blocking、`--max-propose` 或 `--max-gate` 超限)時,無論 `auto_approve` 為何,編排 skill SHALL 停止自動段、產未解決問題摘要並 ✋ 升級給使用者;人工續跑出口維持 `human_resume_propose` / `human_resume_fix`。`auto_approve` MUST 對 escalated 無任何效果。

#### Scenario: 全自動下仍升級
- **WHEN** `auto_approve: true` 且 gate 連續失敗超過 `--max-gate`(phase=escalated)
- **THEN** loop 停下升級給使用者,不自動續跑

### Requirement: 未設時首次啟動詢問
`auto_approve` 未設時,編排 skill SHALL 在第一次啟動(無 checkpoint)✋ 詢問使用者一次(可與 `superpowers` 併問),並把選擇寫回 `.devloop/config.json`;之後 MUST 不再重複詢問。

#### Scenario: 問一次寫回
- **WHEN** config 無 `auto_approve` 鍵,首次啟動 loop
- **THEN** 詢問使用者並將 true/false 寫回 config,同專案後續 loop 直接沿用

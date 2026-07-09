# superpowers-integration Specification

## Purpose
判斷型步驟(brainstorm/apply/fix/review)可以用 superpowers skills 驅動,也可以用內建做法——這是使用者的選擇,不是工具的硬依賴。config `superpowers` 鍵承載這個選擇;無論開關,產物與引擎接口不變。

## Requirements
### Requirement: config superpowers 鍵載入
`load_config` SHALL 載入 `superpowers` 鍵:JSON `true`/`false` 原值,缺鍵為 None(未設)。非布林值 SHALL 原樣保留、不得 coerce(`bool("false")` 會靜默變 True);引擎自身 MUST 不依此鍵分支,消費端(編排 skill)將非布林視為未設。

#### Scenario: 三態載入
- **WHEN** config 分別為 `{"superpowers": true}`、`{"superpowers": false}`、缺鍵
- **THEN** `Config.superpowers` 分別為 True、False、None

#### Scenario: 非布林原樣保留
- **WHEN** config 為 `{"superpowers": "yes"}`
- **THEN** `Config.superpowers` 為 `"yes"`(不 coerce),編排端視為未設

### Requirement: 判斷步驟依開關分流
編排 skill 在 `superpowers=true` 時 SHALL 以對應 skill 驅動判斷型步驟:brainstorm 用 `superpowers:brainstorming`、apply subagent 遵循 `superpowers:test-driven-development`、難纏 fix 用 `superpowers:systematic-debugging`、code review leg 採 `superpowers:requesting-code-review` 審查標準;skill 未安裝(呼叫失敗)SHALL fallback 內建做法且不中斷 loop。`false` 或未設決議為內建流程時 SHALL 不呼叫 superpowers skills。無論開關,產物與引擎接口(設計文件、OpenSpec change、報告 JSON、事件推進、gate)MUST 為同一套。

#### Scenario: 開啟且已安裝
- **WHEN** `superpowers: true` 且 skills 可用
- **THEN** brainstorm 經 `superpowers:brainstorming` 產出設計文件,後續流程與內建版本相同

#### Scenario: 開啟但未安裝
- **WHEN** `superpowers: true` 但 skill 呼叫失敗
- **THEN** 該步驟以內建做法完成,loop 不中斷

### Requirement: 未設時首次啟動詢問
`superpowers` 未設(或非布林)時,編排 skill SHALL 在第一次啟動(無 checkpoint)✋ 詢問使用者一次,並把選擇寫回 `.devloop/config.json`;之後 MUST 不再重複詢問。

#### Scenario: 問一次寫回
- **WHEN** config 無 `superpowers` 鍵,首次啟動 loop
- **THEN** 詢問使用者並將 true/false 寫回 config,同專案後續 loop 直接沿用

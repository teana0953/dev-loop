# model-profile-config Specification (delta)

## ADDED Requirements

### Requirement: config model_profile 與 models 鍵載入
`load_config` SHALL 載入 `model_profile` 鍵(合法值 `"quality"`、`"budget"`;缺鍵為 None,消費端視同 `"quality"`)與 `models` 鍵(dict,逐階段 model alias override;缺鍵為空 dict)。引擎自身 MUST 不依這兩鍵分支——消費端是編排 skill(同 `superpowers` passthrough 模式)。

#### Scenario: 三態載入
- **WHEN** config 分別為 `{"model_profile": "quality"}`、`{"model_profile": "budget"}`、缺鍵
- **THEN** `Config.model_profile` 分別為 `"quality"`、`"budget"`、None

#### Scenario: models 載入
- **WHEN** config 為 `{"models": {"apply": "sonnet"}}`
- **THEN** `Config.models` 為 `{"apply": "sonnet"}`;缺鍵時為 `{}`

### Requirement: model 設定 fail-loudly 驗證
`load_config` SHALL 於載入時驗證:`model_profile` 非 None 且不在 `("quality", "budget")` → ValueError;`models` 非 dict、鍵不在 `("brainstorm", "apply", "review", "fix")`、或值不在 `("sonnet", "opus", "haiku", "fable")` → ValueError(含來源與值)。設定 typo MUST NOT 靜默退化(與 `finish`/`gate_cmds` 驗證同精神)。

#### Scenario: profile typo 即炸
- **WHEN** config 為 `{"model_profile": "cheap"}`
- **THEN** `load_config` 拋 ValueError,訊息含 `model_profile` 與 `"cheap"`

#### Scenario: models 非法鍵或值即炸
- **WHEN** config 為 `{"models": {"qa": "sonnet"}}` 或 `{"models": {"apply": "claude-sonnet-5"}}`
- **THEN** `load_config` 拋 ValueError(完整 model id 不是合法值——只收 alias)

### Requirement: 階段 model 決策
編排 skill dispatch subagent 時 SHALL 依決策順序取得 model 參數:`models` 有該階段鍵 → 用其值;否則依 profile——`quality`(或未設)全部階段不帶 model 參數(繼承 session 模型);`budget` 下 `apply` 與機械性 `fix` 用 `sonnet`,其餘階段不帶。`propose`、`qa`、proposal-review MUST 一律繼承 session 模型,不受兩鍵影響。

#### Scenario: quality 全程繼承
- **WHEN** `model_profile` 未設或為 `"quality"`,且 `models` 無對應鍵
- **THEN** 所有 subagent dispatch 不帶 model 參數

#### Scenario: budget 只路由 output 大戶
- **WHEN** `model_profile` 為 `"budget"`,且 `models` 為空
- **THEN** apply TDD subagent 與機械性 fix 以 `sonnet` dispatch;brainstorm、review code leg、架構性 fix 繼承 session 模型

#### Scenario: models override 優先
- **WHEN** `model_profile` 為 `"budget"` 且 `models` 為 `{"apply": "haiku"}`
- **THEN** apply subagent 以 `haiku` dispatch(override 蓋過 profile 推導的 `sonnet`),機械性 fix 仍為 `sonnet`

### Requirement: review 強度與 profile 聯動
`model_profile` 為 `"budget"` 時,code review leg 的 subagent prompt SHALL 採 coverage-first 加重審查(報告所有發現含不確定與低嚴重度項、附信心與嚴重度分級,由 review 分級機制過濾);`"quality"`(或未設)SHALL 用標準審查 prompt。兩種模式下 legs 數量、報告 JSON 格式與引擎 `legs-init`/`leg-done`/`review` 接口 MUST 相同。

#### Scenario: budget 加重審查
- **WHEN** `model_profile` 為 `"budget"`,流程進入 review
- **THEN** code leg prompt 含 coverage-first 指示;報告格式與 quality 模式一致

#### Scenario: 引擎接口不變
- **WHEN** 任一 profile 下 review legs 完成
- **THEN** `review --from-legs` 的彙總分級行為與現行 spec 相同,無新參數

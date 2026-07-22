# model-profile-config Specification (delta)

## MODIFIED Requirements

### Requirement: 階段 model 決策
引擎 SHALL 提供 `resolve_model(stage, config)`:`models` 有該階段鍵 → 回其值;否則依 profile——`quality`(或未設)回 None(繼承 session 模型);`budget` 下 `apply`/`fix` 回 `"sonnet"`、`brainstorm`/`review` 回 None。stage 不在合法值域 SHALL 拋 ValueError。CLI 子命令 `devloop model --stage <s> [--config <path>]` SHALL 印該決議(alias 或 `inherit`);config 非法 → exit 2。編排 skill dispatch subagent 前 SHALL 以引擎決議取得 model 參數,例外:架構性 fix SHALL 忽略引擎對 `fix` 的 budget 建議值、改為繼承(機械/架構之分是編排層判斷)。`propose`、`qa`、proposal-review MUST 一律繼承 session 模型,不受兩鍵影響。

#### Scenario: quality 全程繼承
- **WHEN** `model_profile` 未設或為 `"quality"`,且 `models` 無對應鍵
- **THEN** `resolve_model` 對所有階段回 None;`devloop model --stage apply` 印 `inherit`

#### Scenario: budget 只路由 output 大戶
- **WHEN** `model_profile` 為 `"budget"`,且 `models` 為空
- **THEN** `resolve_model("apply")` 與 `resolve_model("fix")` 回 `"sonnet"`;`brainstorm`/`review` 回 None;架構性 fix 由編排忽略建議值改繼承

#### Scenario: models override 優先
- **WHEN** `model_profile` 為 `"budget"` 且 `models` 為 `{"apply": "haiku"}`
- **THEN** `resolve_model("apply")` 回 `"haiku"`(override 蓋過 profile 推導的 `sonnet`),`resolve_model("fix")` 仍回 `"sonnet"`

#### Scenario: 非法 stage fail loudly
- **WHEN** 呼叫 `resolve_model("qa", config)` 或 `devloop model --stage qa`
- **THEN** 前者拋 ValueError;後者為 argparse choices 拒絕(exit ≠ 0)

### Requirement: review 強度與 profile 聯動
`model_profile` 為 `"budget"` 時,code review leg 的 subagent prompt SHALL 併入正本檔 `skills/dev-loop/references/review-coverage-first.md` 的 coverage-first 加重審查指示(報告所有發現含不確定與低嚴重度項、附信心與嚴重度分級,由 review 分級機制過濾,reviewer 不得自行過濾);`"quality"`(或未設)SHALL 用標準審查 prompt。兩種模式下 legs 數量、報告 JSON 格式與引擎 `legs-init`/`leg-done`/`review` 接口 MUST 相同。

#### Scenario: budget 加重審查引用正本
- **WHEN** `model_profile` 為 `"budget"`,流程進入 review
- **THEN** code leg prompt 含 `references/review-coverage-first.md` 的指示內容;報告格式與 quality 模式一致

#### Scenario: 引擎接口不變
- **WHEN** 任一 profile 下 review legs 完成
- **THEN** `review --from-legs` 的彙總分級行為與現行 spec 相同,無新參數

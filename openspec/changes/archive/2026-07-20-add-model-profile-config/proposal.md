# Proposal: add-model-profile-config

## Why

model 分層(brainstorm/review 用 Opus、apply 用 Sonnet)目前寫死在 SKILL.md 的流程文字裡,是「補償弱模型」時代的架構假設。現在單一強模型全程跑的品質更好,分層只剩成本考量——它應該從「架構」降級為「使用者的成本選項」,和 `superpowers`/`auto_approve` 一樣由 config 承載選擇,預設反轉為「全程繼承 session 模型」。

## What Changes

- config 新增 `model_profile` 鍵:`"quality"`(預設)| `"budget"`。quality = 所有階段不指定 model、繼承 session 模型;budget = apply+TDD 與機械性 fix 用 `sonnet`,其餘繼承。
- config 新增 `models` 鍵(可選,逐階段 override):如 `{"apply": "sonnet"}`。值為 model **alias**(`sonnet`/`opus`/`haiku`/`fable`),不存完整 model id(避免版本更迭改 config)。`models` 優先於 `model_profile` 推導值。
- review 強度與 `model_profile` 聯動:budget 模式的 code review leg 用 coverage-first 較重審查 prompt(便宜模型寫的碼需要更廣的把關);quality 模式用標準審查 prompt。不新增獨立的 review 強度設定。
- SKILL.md 流程文字移除寫死的 Opus/Sonnet 標注,改為「依 model 決策表決定 dispatch 的 model 參數」。
- 引擎 `load_config` passthrough 這兩個鍵(與 `superpowers` 同模式:引擎不分支,非法值 fail loudly——與 `finish` 值域驗證同精神)。
- **不是 BREAKING**:未設 `model_profile` 的既有專案得到 quality 行為(新預設);舊行為可用 `"model_profile": "budget"` 找回。

## Capabilities

### New Capabilities

- `model-profile-config`:model 分層作為 config 選項——`model_profile`/`models` 鍵的載入與驗證、quality/budget 的階段 model 決策、review 強度聯動、編排層消費規則。

### Modified Capabilities

(無——`superpowers-integration` 等既有 spec 的需求不變;本 change 只新增正交的設定面。)

## Impact

- `plugins/dev-loop/devloop/config.py`:`Config` 增欄位、`load_config` 載入、新驗證函式。
- `plugins/dev-loop/skills/dev-loop/SKILL.md`:設定一節增鍵說明;流程步驟 1/2/4/5/8/9 的 model 標注改為決策表驅動;首次啟動詢問不新增(model_profile 有安全預設 quality,不問)。
- `plugins/dev-loop/commands/dev-loop.md`:薄入口不變(流程正本在 SKILL)。
- `tests/`:config 載入/驗證測試。
- `README.md`:設定一節補鍵說明。
- `plugins/dev-loop/plugin.json`(或對應 version 檔):版本 bump。

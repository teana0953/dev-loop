# Tasks: add-model-profile-config

## 1. 引擎 config(TDD)

- [x] 1.1 tests:`model_profile` 三態載入(quality/budget/缺鍵→None)與 `models` 載入(dict/缺鍵→{})
- [x] 1.2 tests:fail-loudly 驗證——profile typo、`models` 非法鍵(如 `qa`)、非法值(完整 model id、非字串)、`models` 非 dict 皆拋 ValueError 且訊息含來源與值
- [x] 1.3 `config.py`:`Config` 增 `model_profile`/`models` 欄位;`load_config` 載入並呼叫新驗證函式 `validate_model_config`(合法值常數:profiles `quality`/`budget`、stages `brainstorm`/`apply`/`review`/`fix`、aliases `sonnet`/`opus`/`haiku`/`fable`)
- [x] 1.4 全測試綠(`python3 -m pytest -q`)

## 2. SKILL.md 編排規則

- [x] 2.1 「設定」一節補 `model_profile`/`models` 兩鍵說明(含:預設 quality、不在首次啟動詢問、alias 不收完整 id)
- [x] 2.2 新增「Model 決策」小節:決策順序(models override → profile 推導 → 繼承)與 design.md D2 決策表;明示 propose/qa/proposal-review 恆繼承
- [x] 2.3 流程步驟 1/2/4/5/8/9 與 frontmatter description 移除寫死的 Opus/Sonnet 標注,改引用 Model 決策
- [x] 2.4 步驟 8 review:補 budget 模式 code leg 用 coverage-first 加重 prompt 的指示(quality 用現行標準 prompt;報告格式不變)
- [x] 2.5 `commands/dev-loop.md` frontmatter 移除 pin 死的 `model: claude-opus-4-8`(協調者繼承 session 模型——同一硬編問題的 command 側)

## 3. 文件與版本

- [x] 3.1 README「設定」一節補兩鍵(含 budget 取捨說明:apply 品質換成本、review 有加重護欄)
- [x] 3.2 plugin 版本 bump 0.2.2 → 0.3.0(新增 config 能力 → minor)

# Proposal: model-decision-to-engine

## Why

v0.3.0 把 model 決策表寫進 SKILL.md 文字,違反 repo 哲學「確定性交引擎、判斷交 skill」——查表是純確定性邏輯,活在文字裡無法 pytest、編排端會漂移。同時清掉兩個 2026-07-13 遺留 followup(teardown `--mode` 雙真理來源、`delete_merged_branch` 訊息不精確)與 coverage-first prompt 無正本的問題。

## What Changes

- 引擎新增 `resolve_model(stage, config)`(回傳 alias 或 None=繼承)+ `devloop model --stage <stage>` 子命令(stdout 印 alias 或 `inherit`);SKILL 改為 dispatch 前問引擎,決策表文字降為說明。
- coverage-first 加重審查 prompt 落正本 `skills/dev-loop/references/review-coverage-first.md`;SKILL 步驟 8 改引用檔案,不再即興。
- teardown `--mode` 改 optional:預設讀 checkpoint 的 `finish_mode`,`--mode` 降為 override;兩者皆無 → exit 2(不猜)。消除雙真理來源。
- `delete_merged_branch` 區分失敗原因:checked-out / unmerged / absent 各給精確訊息(git stderr 判別),不再一律 "kept (unmerged/absent)"。
- 版本 0.3.0 → 0.4.0(新 CLI 子命令 = 新能力)。

## Capabilities

### New Capabilities

- `teardown-cli`:teardown 子命令的 mode 決議(checkpoint `finish_mode` 為預設真理來源、`--mode` override、皆無 fail loudly)與分支清理訊息精確性。(補 2026-07-13 change 未落主 spec 的缺口。)

### Modified Capabilities

- `model-profile-config`:「階段 model 決策」需求從「編排 skill 依決策順序取得」改為「引擎 `resolve_model`/`devloop model` 提供決議,skill SHALL 查詢引擎」;「review 強度聯動」需求補 prompt 正本檔案要求。

## Impact

- `plugins/dev-loop/devloop/config.py`:`resolve_model()`。
- `plugins/dev-loop/devloop/cli.py`:`model` 子命令;`_cmd_teardown` mode 決議。
- `plugins/dev-loop/devloop/teardown.py`:`delete_merged_branch` 回傳原因。
- `plugins/dev-loop/skills/dev-loop/SKILL.md` + 新 `references/review-coverage-first.md`。
- `tests/`:resolve_model/model 子命令/teardown mode/branch 訊息測試。
- 版本兩處 bump。

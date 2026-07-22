# Tasks: model-decision-to-engine

## 1. resolve_model + CLI(TDD)

- [x] 1.1 tests:`resolve_model` — quality/未設全 None;budget 下 apply/fix=sonnet、brainstorm/review=None;models override 優先;非法 stage 拋 ValueError
- [x] 1.2 tests:`devloop model` 子命令 — 印 alias 或 `inherit`;`--config` 預設 `.devloop/config.json`;config 非法 exit 2;非法 stage 被 argparse 拒
- [x] 1.3 `config.py` 實作 `resolve_model`;`cli.py` 加 `model` 子命令
- [x] 1.4 全測試綠

## 2. teardown 修繕(TDD)

- [x] 2.1 tests:teardown 不帶 `--mode` 讀 `cp.finish_mode`;override 優先;皆無 exit 2 且 checkpoint 不動
- [x] 2.2 tests:`delete_merged_branch` 回傳 deleted/checked_out/unmerged/absent(git stderr 判別;無法歸類→unmerged)
- [x] 2.3 `teardown.py` 改回傳原因;`cli.py` `--mode` 改 optional + 決議邏輯 + 依原因印訊息
- [x] 2.4 全測試綠

## 3. SKILL 與 prompt 正本

- [x] 3.1 新增 `skills/dev-loop/references/review-coverage-first.md`(完整 coverage-first prompt 段落)
- [x] 3.2 SKILL.md「Model 決策」改為「dispatch 前跑 `devloop model --stage <s>` 取決議;架構性 fix 例外忽略建議值改繼承」;表格降為說明性附註
- [x] 3.3 SKILL.md 步驟 8 改引用 references 檔;步驟 10/Resume 節補 teardown 可省 `--mode`

## 4. 收尾

- [x] 4.1 README 設定節微調(提及 `devloop model` 可查決議)
- [x] 4.2 版本 bump 0.3.0 → 0.4.0(plugin.json + `__init__.py`)
- [x] 4.3 全測試綠 + `openspec validate --all`

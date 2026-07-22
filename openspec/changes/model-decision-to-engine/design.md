# Design: model-decision-to-engine

## Context

v0.3.0 的 model 決策(models override → profile 查表 → 繼承)只存在 SKILL.md 表格;引擎已有值域驗證(`validate_model_config`)但沒有決議函式。teardown 的 `--mode required=True` 與 checkpoint 已持久化的 `finish_mode`(event `--finish-mode` 落地、`status` hint 會帶出)是兩個真理來源;`delete_merged_branch` 只回 bool,CLI 對一切失敗印同一句 "kept (unmerged/absent)",對 checked-out 分支(teardown 通常已 checkout 回 trunk,但 pr 流程或手動情境可能沒有)訊息誤導。

## Goals / Non-Goals

**Goals:**
- model 決策單一真理來源在引擎,可 pytest,skill 只照做。
- coverage-first prompt 有正本檔,budget 護欄品質穩定。
- teardown mode 以 checkpoint 為準;分支清理訊息反映真實原因。

**Non-Goals:**
- 不改 review legs 結構、不動 `/code-review` 委託(策略層另案)。
- 不做輕量 loop 檔位(另案評估)。
- `models`/`model_profile` 語義不變(v0.3.0 spec 照舊)。

## Decisions

### D1:`resolve_model(stage, config) -> str | None` 放 config.py

決策與驗證同居一檔(值域常數已在此)。回傳 None = 繼承(dispatch 不帶 model 參數);stage 不合法拋 ValueError(呼叫端 bug,fail loudly)。budget 查表:`apply`/`fix` → `"sonnet"`,`brainstorm`/`review` → None。fix 的機械/架構之分是判斷,引擎不碰——引擎對 `fix` 回 budget 建議值 `"sonnet"`,SKILL 規則:架構性 fix **忽略引擎值改繼承**(判斷留編排,與哲學一致;決策表文字仍保留此註記)。替代方案「引擎收 `--kind mechanical|architectural`」被否決:把判斷結果傳進引擎再傳回來只是繞路。

### D2:CLI `devloop model --stage <s> [--config <path>]`

stdout 一行:alias 或 `inherit`。`--config` 預設 `.devloop/config.json`(與其他子命令的 config 慣例一致)。不讀 checkpoint(決策只依 config)——因此不需要 `--file`,也可在 loop 外測試。config 非法(load_config 拋 ValueError)→ exit 2 印錯誤,同現行 fail-loudly 慣例。

### D3:teardown mode 決議順序

`--mode` 有給 → 用它(override,值域仍 argparse choices 限 merge/pr);未給 → 讀 `cp.finish_mode`;皆無 → exit 2 印「no mode: pass --mode or run event --finish-mode first」。不猜預設——teardown 刪分支是不可逆動作,寧可停。`statemachine` 的 next hint 已在 `finish_mode` 有值時帶出 `--mode`,hint 邏輯不用改(帶了也只是冗餘 override,值相同)。

### D4:`delete_merged_branch` 回傳原因字串

回傳值從 bool 改為 `"deleted" | "checked_out" | "unmerged" | "absent"`(git stderr 判別:`checked out at` / `not fully merged` / `not found`,無法歸類保守回 `"unmerged"`)。CLI 印 `branch <b>: <原因對應訊息>`。呼叫端只有 `_cmd_teardown` 一處,改回傳型別無擴散。

### D5:coverage-first prompt 正本

`skills/dev-loop/references/review-coverage-first.md`:完整 prompt 段落(報所有發現含不確定/低嚴重度、每項附 confidence 與 severity、不得自行過濾——過濾交引擎分級),SKILL 步驟 8 指路「budget 時將此檔內容併入 code leg prompt」。plugin 打包自動含 skills/ 整目錄,無 packaging 變更。

## Risks / Trade-offs

- [`resolve_model` 對 fix 回 sonnet 但架構性 fix 應繼承——skill 忽略規則若漂移會弱化架構修復] → 決策表文字保留註記 + spec scenario 明寫;這是刻意留在編排層的最後一塊判斷。
- [teardown `--mode` 從 required 變 optional 是 CLI 行為變更] → 舊呼叫(帶 --mode)完全相容;只是新增省參數路徑。
- [git stderr 文案隨 git 版本變動] → 判別失敗保守歸 `"unmerged"`(訊息「kept」仍正確,只是less精確),不影響流程。

## Migration Plan

單 PR:config.py/teardown.py/cli.py + tests → references/ + SKILL.md → bump 0.4.0。rollback = revert,無資料遷移。

## Open Questions

(無)

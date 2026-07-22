# teardown-cli Specification (delta)

## ADDED Requirements

### Requirement: teardown mode 決議
`devloop teardown` 的 `--mode` SHALL 為 optional override:有給 → 用它(值域 `merge`/`pr`);未給 → 讀 checkpoint 的 `finish_mode`;兩者皆無 → exit 2 並提示先跑 `event --finish-mode` 或帶 `--mode`,MUST NOT 猜預設(刪分支不可逆)。checkpoint `finish_mode` 為 mode 的真理來源,`--mode` 僅為人工 override。

#### Scenario: 預設讀 checkpoint
- **WHEN** checkpoint `finish_mode` 為 `"merge"`,執行 `devloop teardown --file <cp> --repo .`(不帶 `--mode`)
- **THEN** 以 merge 模式清理(嘗試刪已 merged 短命分支),teardown 正常推進

#### Scenario: override 優先
- **WHEN** checkpoint `finish_mode` 為 `"merge"`,執行 `devloop teardown --mode pr ...`
- **THEN** 以 pr 模式清理(保留分支)

#### Scenario: 皆無即停
- **WHEN** checkpoint `finish_mode` 為空且未帶 `--mode`
- **THEN** exit 2,stderr 提示補救方式,checkpoint 不動

### Requirement: 分支清理訊息精確性
`delete_merged_branch` SHALL 回傳原因(`deleted`/`checked_out`/`unmerged`/`absent`,依 git stderr 判別,無法歸類保守回 `unmerged`);teardown CLI SHALL 依原因印精確訊息,MUST NOT 對不同失敗原因印同一句。

#### Scenario: checked-out 分支
- **WHEN** merge 模式 teardown 時短命分支仍為當前 checked-out 分支
- **THEN** 印出含 checked out 語意的訊息(如 `kept (checked out)`),不是 `kept (unmerged/absent)`

#### Scenario: 已刪與不存在
- **WHEN** 分支已 merged 可刪 / 分支不存在
- **THEN** 分別印 `deleted` / 含 absent 語意的訊息;皆非致命,teardown 續行

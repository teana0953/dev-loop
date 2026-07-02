# cli-status Specification

## Purpose
TBD - created by archiving change status-show-change-id. Update Purpose after archive.
## Requirements
### Requirement: status 輸出包含 change 與分支識別

`devloop status` 子命令 SHALL 在單行輸出中包含 checkpoint 的 `phase`、`iteration`、`change_id` 與 `branch`,讓操作者僅憑 status 即可辨識該 checkpoint 對應的 change 與短命分支。既有的 `phase` 與 `iteration` 欄位 SHALL 維持原位於輸出前段以保持向後相容。

#### Scenario: 顯示完整識別資訊

- **WHEN** 對一個 change_id 為 `add-foo`、branch 為 `loop/add-foo`、phase 為 `review`、iteration 為 `2` 的 checkpoint 執行 `status`
- **THEN** 輸出單行同時包含 `phase=review`、`iteration=2`、`change_id=add-foo` 與 `branch=loop/add-foo`

#### Scenario: 向後相容既有欄位

- **WHEN** 對任一 checkpoint 執行 `status`
- **THEN** 輸出仍包含 `phase=<phase>` 與 `iteration=<n>` 字樣,且回傳 exit code 0

### Requirement: status 輸出下一步 hint
`status` 子命令 SHALL 在既有單行識別輸出之後,輸出一行以 `next: ` 開頭的下一步建議:確定性步驟(gate/qa 收報告/review 彙總/finish/終態)給命令骨架或明確說明;判斷型步驟(propose/apply/fix 等)給 `next: dispatch …` 說明文字;apply/fix 有 pending units 或 review/qa 有未收 legs 時 SHALL 優先提示該未完成項。`PHASES` 的每個成員 MUST 都有對應 hint(含終態)。既有第一行內容與 exit code 契約不變。

#### Scenario: gate phase 給命令骨架
- **WHEN** 對 phase=gate 的 checkpoint 執行 `status`
- **THEN** 第一行仍含 `phase=gate`,第二行以 `next: ` 開頭且含 `devloop.cli gate`

#### Scenario: apply 有 pending units 時優先提示
- **WHEN** phase=apply 且 checkpoint `units[]` 有 `pending` 的 unit
- **THEN** `next:` 行提示 pending units(含 unit id 或 `units-status`)

#### Scenario: 終態明確收束
- **WHEN** phase=done 執行 `status`
- **THEN** `next:` 行明確表示無後續(如 `next: (done)`),exit 0


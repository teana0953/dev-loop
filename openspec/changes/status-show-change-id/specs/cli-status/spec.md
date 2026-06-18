## ADDED Requirements

### Requirement: status 輸出包含 change 與分支識別

`devloop status` 子命令 SHALL 在單行輸出中包含 checkpoint 的 `phase`、`iteration`、`change_id` 與 `branch`,讓操作者僅憑 status 即可辨識該 checkpoint 對應的 change 與短命分支。既有的 `phase` 與 `iteration` 欄位 SHALL 維持原位於輸出前段以保持向後相容。

#### Scenario: 顯示完整識別資訊

- **WHEN** 對一個 change_id 為 `add-foo`、branch 為 `loop/add-foo`、phase 為 `review`、iteration 為 `2` 的 checkpoint 執行 `status`
- **THEN** 輸出單行同時包含 `phase=review`、`iteration=2`、`change_id=add-foo` 與 `branch=loop/add-foo`

#### Scenario: 向後相容既有欄位

- **WHEN** 對任一 checkpoint 執行 `status`
- **THEN** 輸出仍包含 `phase=<phase>` 與 `iteration=<n>` 字樣,且回傳 exit code 0

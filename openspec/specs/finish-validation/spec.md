# finish-validation Specification

## Purpose
TBD - created by archiving change engine-semantics-fixes. Update Purpose after archive.
## Requirements
### Requirement: finish 值域驗證
`resolve_finish` SHALL 只接受 `merge`、`pr`、`ask`、null(未設)四種值;其他值 SHALL 視為設定錯誤。cli `finish` 遇無效值 SHALL 印 `error: invalid finish value <值>` 到 stderr 並 exit 2,不得靜默退化成 ask。

#### Scenario: 無效 config 值報錯
- **WHEN** `.devloop/config.json` 的 `finish` 為 `"merg"`(typo)
- **THEN** `finish` 命令 stderr 含 `invalid finish value`,exit 2,不輸出 `finish: ask`

#### Scenario: 無效 change meta override 報錯
- **WHEN** config 的 `finish` 為 `"merge"` 但 change meta 的 `finish` 為 `"pull-request"`
- **THEN** `finish` 命令報同樣錯誤,exit 2

#### Scenario: 合法值行為不變
- **WHEN** `finish` 為 `merge`、`pr`、`ask` 或未設
- **THEN** 行為與 v2 相同(merge/pr/ask 決策 + follow-up 落地)


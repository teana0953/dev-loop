# history-log Specification

## Purpose
loop 的可觀察性地基:checkpoint 只存當前狀態,transition 歷史(何時、經何 event、從哪到哪)落在 append-only 的 `history.jsonl`,供事後排障與耗時分析。

## Requirements
### Requirement: transition 追加到 history.jsonl
所有套用狀態轉移的子命令(`start`、`event`、`gate`、`qa`、`review`、`proposal-review`)SHALL 在 checkpoint save 成功後,對與 checkpoint 同目錄的 `history.jsonl` 追加一行 JSON:`{"ts": <ISO 8601 UTC>, "event": <event>, "from": <舊 phase>, "to": <新 phase>, "iteration": <新 iteration>}`。`start` 的 event 為 `"start"`、`from` 為 null。檔案為 append-only,不得改寫既有行。

#### Scenario: event 轉移留痕
- **WHEN** phase=apply 的 checkpoint 套用 `event --event apply_done`
- **THEN** `history.jsonl` 末行的 `event` 為 `apply_done`、`from` 為 `apply`、`to` 為 `gate`

#### Scenario: 多次轉移累積
- **WHEN** 同一 checkpoint 先後經歷 gate 失敗與 gate 通過
- **THEN** `history.jsonl` 依序含 `gate_fail` 與 `gate_pass` 兩行

### Requirement: 失敗不留痕、留痕失敗不礙事
轉移被拒(InvalidTransition)時 SHALL 不追加任何 history 行。history 追加本身失敗時,子命令 SHALL 僅在 stderr 印 `warning: history append failed` 開頭的警告,stdout 與 exit code MUST 不受影響。

#### Scenario: 非法事件不留痕
- **WHEN** phase=apply 套用 `gate_pass`(非法)
- **THEN** exit 2 且 `history.jsonl` 無新行

#### Scenario: history 寫入失敗不影響主命令
- **WHEN** history 追加拋 I/O 例外,執行本應 exit 0 的 `event`
- **THEN** stderr 含 `warning: history append failed`,stdout 照常印 phase,exit 0

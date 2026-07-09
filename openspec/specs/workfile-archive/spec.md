# workfile-archive Specification

## Purpose
一輪 loop 產生的工作檔(review/qa/pr 報告、followup、history、watcher log)屬於該 change,change 歸檔後不該繼續堆在 `.devloop/` 頂層。`archive` 收工作檔進 `.devloop/archive/<change-id>/`——跑得越多目錄越乾淨而不是越髒。

## Requirements
### Requirement: archive 成功後收工作檔
`archive` 子命令在 openspec archive 成功後 SHALL 把 checkpoint 同目錄的工作檔搬進 `archive/<change-id>/`:頂層所有檔案,常駐檔(checkpoint 實際檔名、`config.json`、`watcher.pid`)與子目錄除外;外加 `changes/<change-id>.json` meta。checkpoint SHALL 另複製一份快照進歸檔,原檔保留(status 在終態仍可讀)。收檔採「搬走所有非常駐檔」而非檔名白名單——報告檔名由編排端決定,引擎不猜。完成後 stdout 印 `archived workfiles: <數量> -> <目的地>`。

#### Scenario: 報告搬走、常駐檔不動
- **WHEN** `.devloop/` 有 review/qa/pr 報告、followup、history.jsonl、watcher-log.jsonl,openspec archive 成功
- **THEN** 上述檔案全部移入 `archive/<change-id>/`;`checkpoint.json`、`config.json`、`watcher.pid` 與 `wt/` 等子目錄不動

#### Scenario: change meta 一併歸檔
- **WHEN** `changes/<change-id>.json` 存在
- **THEN** 移入歸檔;其他 change 的 meta 不動

#### Scenario: 重跑冪等
- **WHEN** 對已收過的目錄再跑 archive
- **THEN** 不炸,僅重新快照 checkpoint

### Requirement: 失敗語義
openspec archive 失敗(exit 1)時 SHALL 不動任何工作檔。收檔過程失敗時 SHALL 僅 stderr 印 `warning: workfile archive failed` 開頭的警告,archive 子命令 MUST 仍 exit 0(openspec archive 已成功,housekeeping 不反噬)。

#### Scenario: openspec archive 失敗不收檔
- **WHEN** openspec archive 回非 0
- **THEN** 子命令 exit 1,工作檔原地不動,無 `archive/<change-id>/`

#### Scenario: 收檔失敗僅警告
- **WHEN** openspec archive 成功但搬檔拋 I/O 例外
- **THEN** stderr 含 `warning: workfile archive failed`,exit 0

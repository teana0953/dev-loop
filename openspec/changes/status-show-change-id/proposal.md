## Why

`devloop status` 目前只印 `phase` 與 `iteration`。當多個 loop / change 並行,或從 `auto-resume` 冷啟動接手時,操作者無法只看 status 就知道這份 checkpoint 對應哪個 OpenSpec change 與哪條短命分支,必須另外開檔查看。

## What Changes

`status` 子命令的輸出新增 `change_id` 與 `branch` 兩欄,格式變為:
`phase=<p> iteration=<n> change_id=<c> branch=<b>`。維持單行、向後相容(既有欄位與順序不變,只在尾端追加)。

## Capabilities

### New Capabilities
- `cli-status`: `devloop status` 子命令的輸出內容契約。

### Modified Capabilities

## Impact

- `devloop/cli.py` 的 `_cmd_status`。
- `tests/test_cli.py` 既有 status 測試不受影響(仍斷言 phase 與 iteration 出現)。

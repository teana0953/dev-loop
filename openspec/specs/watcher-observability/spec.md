# watcher-observability Specification

## Purpose
watcher 是續跑的招牌能力,但它是 detached 程序——活著沒有、上次為何失敗、下次何時重試,壞掉時排障不能靠猜。本 capability 給 watcher 落嘗試紀錄、給操作者一眼看清的 `watcher-status`,並讓 `status` 在 watcher 該在而不在時主動示警。

## Requirements
### Requirement: watcher 嘗試紀錄
`run_watcher` 收到 `log_path` 時,SHALL 在每次執行續跑命令後對該檔追加一行 JSON:`{"ts": <ISO 8601 UTC>, "exit_code": <code>, "output_tail": <輸出尾巴,上限 500 字元>, "action": "stop"|"retry", "heartbeat": <秒>}`。`ensure_armed` spawn watcher 時 SHALL 帶上 checkpoint 同目錄的 `watcher-log.jsonl` 作為 log 路徑。log 寫入失敗 SHALL 靜默,MUST 不影響 watcher 重試迴圈。

#### Scenario: 重試後收斂留兩筆
- **WHEN** 續跑命令第一次回 1、第二次回 0
- **THEN** log 依序有 `action=retry`(exit_code=1)與 `action=stop`(exit_code=0)兩行

#### Scenario: log 不可寫不礙事
- **WHEN** log 路徑不可寫,續跑命令回 0
- **THEN** watcher 正常回 0 結束,無例外

### Requirement: watcher-status 子命令
`watcher-status --file <cp>` SHALL 輸出三段資訊:watcher 行程狀態(`running (pid=N)` / `dead (stale pid=N)` / `not armed`,依 `watcher.pid` 與行程存活判定)、`resume_exec:`(空時印 `(none)`)、`last attempt:`(取 `watcher-log.jsonl` 最後一筆的 ts/exit_code/action,有輸出尾巴則加印 `output tail:`;無紀錄印 `(none)`)。log 含壞行時 SHALL 跳過壞行不炸。exit code:watcher 應在位(phase 非 `done` 且 `resume_exec` 非空)而不在 → exit 1 並印 `hint:`(arm-local 命令);其餘 exit 0。

#### Scenario: 該在而不在
- **WHEN** phase=gate、`resume_exec` 非空、pid 檔指向已死行程
- **THEN** 印 `watcher: dead (stale pid=N)` 與 `hint:`(含 `arm-local`),exit 1

#### Scenario: 在位
- **WHEN** watcher 行程存活
- **THEN** 印 `watcher: running (pid=N)`,exit 0

#### Scenario: 不需要 watcher
- **WHEN** phase=done 或 `resume_exec` 為空,且 watcher 不在
- **THEN** exit 0(無 hint)

### Requirement: status 對 watcher 缺席示警
`status` SHALL 在 phase 非 `done` 且 `resume_exec` 非空、而 watcher 未在位時,對 stderr 印 `warning: watcher not running` 開頭的警告(含 arm-local 提示)。stdout 的既有輸出契約(人讀三行 / `--json`)MUST 不受影響;watcher 在位、`resume_exec` 為空或 phase=done 時 MUST 無警告。

#### Scenario: 缺席警告走 stderr
- **WHEN** phase=gate、`resume_exec` 非空、無 watcher,執行 `status`
- **THEN** stderr 含 `warning: watcher not running`,stdout 三行照常,exit 0

#### Scenario: 在位不吵
- **WHEN** watcher 存活,執行 `status`
- **THEN** stderr 無警告

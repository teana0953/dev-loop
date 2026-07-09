# resume-trigger Specification

## Purpose
TBD - created by archiving change resume-trigger-wiring. Update Purpose after archive.
## Requirements
### Requirement: 週期重試 watcher

系統 SHALL 提供一個 watcher,反覆執行續跑命令直到成功:命令回傳 0 即停止並回傳 0;回傳非 0 則睡一個 heartbeat 後重試。watcher MUST 接受可注入的執行/睡眠函式以便測試。

#### Scenario: 第一次即成功

- **WHEN** watcher 執行續跑命令且其回傳 0
- **THEN** watcher 立即回傳 0,且不進入睡眠

#### Scenario: 數次重試後成功

- **WHEN** 續跑命令前 N 次回傳非 0、第 N+1 次回傳 0
- **THEN** watcher 共睡眠 N 次(每次一個 heartbeat),最後回傳 0

#### Scenario: heartbeat 夾到上限

- **WHEN** 指定的 heartbeat 大於 MAX_SLEEP_SECONDS(3600)
- **THEN** 每次睡眠時間夾到 3600;未指定時預設 1800

### Requirement: arm-local 確保單一 watcher

系統 SHALL 提供 `arm-local` CLI 子命令,idempotent 地確保有且僅一個 detached watcher 行程,狀態以 `.devloop/watcher.pid` 記錄。

#### Scenario: 尚無 watcher

- **WHEN** 執行 `arm-local` 且 pid 檔不存在
- **THEN** spawn 一個 detached watcher 行程並將其 PID 寫入 `.devloop/watcher.pid`

#### Scenario: watcher 已存活

- **WHEN** 執行 `arm-local` 且 pid 檔記錄的行程仍存活
- **THEN** 不 spawn 新行程(no-op)

#### Scenario: stale pid

- **WHEN** 執行 `arm-local` 且 pid 檔存在但記錄的行程已不存活
- **THEN** 重新 spawn watcher 並以新 PID 覆寫 pid 檔

#### Scenario: 無續跑命令

- **WHEN** 執行 `arm-local` 且 checkpoint 無 `resume_exec` 且未提供 `--exec`
- **THEN** 以非零碼退出且不 spawn 任何行程

### Requirement: checkpoint 攜帶續跑命令

Checkpoint SHALL 支援選填欄位 `resume_exec`,於 save/load 間正確保存,讓冷啟動的 local watcher 自包讀取。

#### Scenario: round-trip 保存

- **WHEN** 以指定 `resume_exec` 存檔後再載入
- **THEN** 載入的 checkpoint 其 `resume_exec` 等於存入值

#### Scenario: 預設為空

- **WHEN** 建立 checkpoint 未指定 `resume_exec`
- **THEN** `resume_exec` 為 None,且既有欄位行為不變

### Requirement: 寫 checkpoint 的子命令自動確保 watcher 在位
所有會寫 checkpoint 的 CLI 子命令(現為 14 個:`start`、`event`、`gate`、`proposal-review`、`qa`、`legs-init`、`leg-done`、`review`、`units-init`、`unit-done`、`unit-claim`、`unit-resolve`、`units-merge`、`units-cleanup`;以「該子命令會呼叫 checkpoint save」為判準)SHALL 在 checkpoint 寫入成功後自動執行與 `arm-local` 相同的 idempotent watcher 確保邏輯(自動路徑 SHALL 不輸出到 stdout),條件是 checkpoint 的 `resume_exec` 非空且 config `auto_arm` 為 true。`resume_exec` 為空時 SHALL 靜默跳過。

#### Scenario: gate 後自動 arm
- **WHEN** checkpoint 有 `resume_exec`、config 無 `auto_arm` 鍵(預設 true),執行 `gate` 且無存活 watcher
- **THEN** gate 完成後 watcher 已被 spawn(pid 檔寫入),gate 的 stdout/exit code 與 v2 相同

#### Scenario: watcher 已存活時 no-op
- **WHEN** watcher 已存活,執行任一寫 checkpoint 的子命令
- **THEN** 不 spawn 新行程,pid 檔不變

#### Scenario: 無 resume_exec 靜默跳過
- **WHEN** checkpoint 的 `resume_exec` 為空,執行 `event`
- **THEN** 不 spawn、不警告,命令行為與 v2 相同

### Requirement: auto_arm 設定開關
config SHALL 支援 `auto_arm` 布林鍵,預設 true;為 false 時所有子命令 SHALL 不自動 arm(`arm-local` 手動路徑不受影響)。config 檔不存在或無此鍵 SHALL 視為 true。

#### Scenario: auto_arm=false 關閉自動 arm
- **WHEN** config `{"auto_arm": false}`,checkpoint 有 `resume_exec`,執行 `gate`
- **THEN** 不 spawn watcher;手動執行 `arm-local` 仍會 spawn

#### Scenario: config 檔不存在視為開啟
- **WHEN** 無 `.devloop/config.json`,checkpoint 有 `resume_exec`,執行 `event`
- **THEN** 自動 arm 照常生效

### Requirement: auto-arm 失敗不反噬主命令
自動 arm 過程失敗(如 spawn 錯誤)時,子命令 SHALL 在 stderr 印 `warning: auto-arm failed` 開頭的警告,且主命令的 stdout 與 exit code MUST 不受影響。

#### Scenario: spawn 失敗僅警告
- **WHEN** watcher spawn 拋例外,執行本應 exit 0 的 `event`
- **THEN** stderr 含 `warning: auto-arm failed`,stdout 照常印 phase,exit 0


## ADDED Requirements

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

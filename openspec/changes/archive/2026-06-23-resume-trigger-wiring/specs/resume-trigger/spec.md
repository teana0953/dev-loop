## ADDED Requirements

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

### Requirement: 既有 resume 路徑向後相容

系統 MUST 保留 `plan_resume` 決策與 `resume` / `auto-resume` 子命令的既有行為,供已知 reset 時間的精準睡眠使用。

#### Scenario: 既有 plan_resume 行為不變

- **WHEN** 以 now 與 reset_at 呼叫 `plan_resume`
- **THEN** 回傳的 ready / sleep_seconds / phase 與本變更前一致

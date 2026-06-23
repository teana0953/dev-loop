## Why

「token 用罄續跑」功能形同未啟用:引擎只提供 `plan_resume` 決策與 `run_adapter` 等待迴圈,但**沒有任何地方主動把 watcher 跑起來**——`auto-resume` 只存在於文件、要人工在別的終端機執行。依設計 §9,session 被卡住的當下無法自排,觸發器必須**事前部署**,但現況從未部署,故 reset 後沒有東西續跑。

## What Changes

- 新增 CLI 子命令 `arm-local`:idempotent 地確保有且僅一個 detached watcher 行程(靠 `.devloop/watcher.pid`),死了自癒、活著 no-op、`resume_exec` 為空則非零退出。
- `run_adapter` 行為改為「無 reset 時間 · 週期重試」的 `run_watcher`:反覆跑 `resume_exec`,成功(exit 0)即退出,否則睡一個 heartbeat 再試。
- checkpoint 新增選填欄位 `resume_exec`,讓 local watcher 自包、冷啟動可讀。
- `plan_resume` / `resume` / `auto-resume` 既有路徑**保留**,供「已知 reset 時間想精準睡」的進階使用(非 BREAKING)。
- SKILL 編排層:每個 checkpoint(`start`/`event`/`gate`/`review`)後「確保觸發器就位」;`trigger` 設定可選 `local`(預設)或 `harness`(改用 ScheduleWakeup 原生排程);改寫「Token 用罄續跑」段。

## Capabilities

### New Capabilities
- `resume-trigger`: token 用罄後自動續跑的觸發接線——心跳式 arm、週期重試 watcher、checkpoint 攜帶續跑命令、可抽換 adapter(本機 / harness)。

### Modified Capabilities
<!-- 無:既有 cli-status 能力不變;plan_resume/resume/auto-resume 行為保留,不改其需求 -->

## Impact

- `devloop/checkpoint.py`:新增 `resume_exec` 欄位。
- `devloop/adapter.py`:`run_adapter` → `run_watcher`(週期重試);保留舊路徑相容。
- `devloop/cli.py`:新增 `arm-local` 子命令。
- `skills/dev-loop/SKILL.md` 與 `.claude/commands/dev-loop.md`:每 checkpoint arm、trigger 設定、續跑段改寫。
- `.gitignore`:加入 `.devloop/watcher.pid`。
- 測試:新增 `run_watcher`、`arm-local`、`resume_exec` round-trip;既有測試維持綠。

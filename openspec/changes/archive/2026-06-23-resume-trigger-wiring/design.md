## Context

完整背景見 `docs/superpowers/specs/2026-06-23-resume-trigger-wiring-design.md`(方案 A)。

現況:`run_adapter` 只被 `auto-resume` 子命令與測試呼叫;`auto-resume` 只存在於文件,要人工在別的終端機跑。設計 §9 約束「被卡住當下無法自排,觸發器須事前部署」,但外層從未部署。引擎已有 `Checkpoint`、`plan_resume`、`run_adapter`,測試全綠。

## Goals / Non-Goals

**Goals:**
- 補上缺失接線:每個 checkpoint「確保觸發器就位」,token 用罄前已布署。
- 觸發器可抽換:本機 detached watcher 與 harness 原生排程都支援。
- 不依賴 reset 時間:週期重試直到成功。
- 向後相容:`plan_resume`/`resume`/`auto-resume` 既有路徑保留。

**Non-Goals:**
- harness adapter 不寫成 python 腳本(本質是 agent 用 ScheduleWakeup/cron 的動作,留在 SKILL 層)。
- 不自動偵測限流、不解析 reset 時間訊息格式。
- 雲端 cron + remote push 完整實作仍為替代方案,不在本份核心。

## Decisions

**D1. 部署時機 = 每個 checkpoint 確保就位(心跳)**,而非開始一次或偵測限流才部署。
理由:唯一能對抗「被卡住當下無法反應」的模式——永遠有 pending 觸發在等。替代:單次部署(脆弱,終端機關掉就沒)、偵測限流(違反 §9,來不及)。

**D2. watcher = 無 reset 時間 · 週期重試。**
`run_watcher` 反覆跑 `resume_exec`,exit 0 退出,否則睡 heartbeat 再試。理由:不需解析 reset 時間;`plan_resume` 保留給已知 reset 時間的精準睡眠。

**D3. local idempotency 靠 `.devloop/watcher.pid`。**
arm-local:行程存活 no-op;無/stale 重生;`resume_exec` 空則非零退出。理由:確保至多一個 watcher、自癒。

**D4. checkpoint 攜帶 `resume_exec`。** 讓 local watcher 自包、冷啟動可讀。選填,向後相容。

**D5. heartbeat 預設 1800s,硬上限 `MAX_SLEEP_SECONDS`(3600)。** `--heartbeat` 可設定,超過上限夾到 3600。

## Risks / Trade-offs

- [resume 成功後新舊 watcher 並存] → 舊 watcher 因 exec 回 0 自然退出;新 agent 在其首個 checkpoint 經 pid 檔確保至多一個。不累積。
- [stale pid 誤判行程存活] → arm-local 實際檢查行程是否存活(非僅檔案存在)再決定。
- [配額長期不回 → watcher 永跑] → 每心跳一次、單一行程,不堆疊;使用者可手動中止。
- [harness ScheduleWakeup 一次性] → 每 checkpoint 刷新一個,最後一次於 block 前已排好,fire 時冷啟動續跑。

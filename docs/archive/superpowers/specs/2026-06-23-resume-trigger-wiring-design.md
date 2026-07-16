> **歷史設計文件(point-in-time)**:記錄該輪設計當下的決策與脈絡,不再更新。現行行為以 `openspec/specs/` 為準。

# Resume 觸發接線 設計規格

- **日期**:2026-06-23
- **取向**:補上「token 用罄續跑」缺失的觸發接線(方案 A:可抽換 armer + 引擎只出決策)
- **前置**:`docs/superpowers/specs/2026-06-18-dev-loop-design.md`(§9 斷點與續跑、§11 待實作細節)

## 1. 問題(根因)

續跑功能「沒有運行」不是 code bug——引擎測試全綠,`plan_resume`(決策)與 `run_adapter`(等待迴圈)都正常。問題是**沒有任何地方會主動把 watcher 跑起來**:

- `run_adapter` 只被 `auto-resume` 子命令與測試呼叫。
- `auto-resume` 在整個專案裡只出現在文件(README、`.claude/commands/dev-loop.md`、`skills/dev-loop/SKILL.md`),三處都寫「在 agent 以外的獨立終端機**手動**執行」。

設計自身的矛盾:§9 約束說「配額用罄時當下 session 被卡住,無法反應式自排,續跑必須是**事前布署好的排程**」;但 §11 又把「resume 觸發 adapter 的實際排程接線」明確排除在引擎外、丟給「外層」,而外層從未在 loop 裡部署它。結果:使用者不手動跑 `auto-resume`,觸發器就永遠不會啟動 → reset 後沒有東西續跑。

## 2. 決策(已拍板)

| 決策 | 結論 |
|---|---|
| 部署時機 | **每個 checkpoint「確保觸發器就位」**(心跳 / dead-man's-switch),而非開始部署一次、也非偵測限流才部署 |
| reset 時間 | **不依賴 reset 時間**,觸發器週期性重試直到成功;`plan_resume` 的精準睡眠保留給已知 reset 時間的進階路徑 |
| 觸發器形態 | **可抽換 adapter**,本機(detached watcher)與 harness(原生排程)都支援 |
| 職責切分 | 引擎只做決策;排程接線交給 armer adapter;SKILL 在每個 checkpoint 呼叫 arm(方案 A) |
| 預設 adapter | `local`(貼合 §9「預設本機」);`harness` 為一等公民備選;雲端 cron + push 維持 §9B 替代 |

## 3. 架構與職責切分

```
每次 CLI 寫 checkpoint 後  ──►  SKILL 呼叫「arm」(依設定選 adapter)
                                   │
        ┌──────────────────────────┴──────────────────────────┐
   local adapter                                          harness adapter
   (引擎 CLI: arm-local)                                  (SKILL 用原生工具)
   確保有且僅一個 detached watcher                          重排一個 ScheduleWakeup
   → 週期重試 exec 直到成功                                  → fire 時冷啟動跑 resume
```

統一語意:**在每個 checkpoint,確保觸發器在位**。

- local:watcher 死了就重生(自癒);活著就不動(idempotent)。
- harness:重排下一個 wakeup(ScheduleWakeup 一次性,故每 checkpoint 刷新)。

### 觸發器契約(兩 adapter 共同介面)

給定 `checkpoint 路徑` + `resume_exec 命令`,保證存在一個 pending 觸發,會**週期性重試** `resume_exec` 直到它成功(exit 0)。成功即代表 loop 已被重新推進——被推進後的(冷啟動)agent 會在它自己的下一個 checkpoint 再次 arm,於是心跳自我延續、跨越多次 reset。

## 4. 引擎變更

### 4a. checkpoint 新增欄位 `resume_exec`(選填)

存「續跑要跑什麼命令」(如 `claude -p '/dev-loop resume'`),讓 local watcher 完全自包、冷啟動可讀。`start` 時可帶入;未帶維持 `None`。需有 save/load round-trip。

### 4b. watcher 改為「無 reset 時間 · 週期重試」(改寫 `run_adapter`)

現況「睡到 `reset_at` 跑一次」改為:

```
run_watcher(checkpoint_path, exec_command, heartbeat, run_fn, sleep_fn):
    while True:
        code = run_fn(exec_command)      # 試著續跑
        if code == 0:
            return 0                      # 成功推進,watcher 功成身退
        sleep_fn(heartbeat)               # 仍被限流 → 等一個心跳再試
```

- `heartbeat` 預設 **1800 秒**(30 分),硬上限為 `MAX_SLEEP_SECONDS`(3600);可由 `--heartbeat` 設定,超過上限則夾到 3600。
- `now_fn`/`sleep_fn`/`run_fn` 維持可注入以便測試。
- `plan_resume`(reset 時間決策)**保留**,給「已知 reset 時間想精準睡」的 `resume`/`auto-resume` 舊路徑;不刪,向後相容。

### 4c. 新 CLI 子命令 `arm-local`(local adapter 入口)

```
python3 -m devloop.cli arm-local --file <cp> [--exec <cmd>] [--heartbeat <s>]
```

行為:讀 checkpoint 的 `resume_exec`(或 `--exec` 覆寫)→ 檢查 `.devloop/watcher.pid`:

- 有且行程存活 → no-op(idempotent)。
- 無 / stale(pid 檔在但行程已死)→ spawn detached 行程跑 `run_watcher`,覆寫新 PID。
- `resume_exec` 為空 → 非零退出報錯,不 spawn 殘廢 watcher。

`.devloop/watcher.pid` 納入 `.gitignore`。

## 5. SKILL 編排層變更

### 5a. 設定:`trigger` adapter 選擇

`local`(預設)或 `harness`。SKILL 啟動段讀此設定,決定每個 checkpoint 後走哪條 arm 路徑。

### 5b. 每個 checkpoint 後插入「ensure 觸發器」步驟

會寫 checkpoint 的點:`start`、`event`、`gate`、`review`。每個之後加:

- `trigger=local` → `python3 -m devloop.cli arm-local --file .devloop/checkpoint.json`
- `trigger=harness` → agent 呼叫 `ScheduleWakeup`(每 checkpoint 刷新),fire 時冷啟動跑 `/dev-loop resume`

### 5c. `start` 帶入 `resume_exec`

loop 啟動時把續跑命令寫進 checkpoint(local watcher 要讀)。

### 5d. 「Token 用罄續跑」段改寫

從「叫使用者去別的終端機手動跑 `auto-resume`」改為:**loop 一啟動 + 每次轉移就自動 arm**;手動 `auto-resume` 降為「已知 reset 時間想精準睡」的進階備選。雲端 cron + 每階段 push 分支/checkpoint 維持為 §9B 替代方案。

## 6. 錯誤處理與 idempotency

- **重複 arm**:`arm-local` 靠 `.devloop/watcher.pid` 確保全程至多一個 watcher;存活 no-op,死了才重生。
- **stale PID**:檢查行程是否真的存活,死的覆寫。
- **resume 成功接力**:被推進的 agent 在其第一個 checkpoint 再 arm;舊 watcher 因 exec 回 0 自然退出 → 不累積。
- **`resume_exec` 為空**:arm-local 直接非零退出,不 spawn。
- **配額長期不回**:每心跳重試,直到成功或使用者手動中止;不堆疊行程。

## 7. 測試(沿用 pytest + 注入 `run_fn`/`sleep_fn`/`now_fn`)

- `run_watcher`:第一次 exec 回 0 → 立即返回不睡;回非 0 → 睡 heartbeat 後重試;N 次後成功 → 重試次數正確。
- `arm-local`:無 pid → spawn(mock);pid 存活 → no-op;stale pid → 覆寫重生;`resume_exec` 空 → 非零退出。
- checkpoint:`resume_exec` 欄位 save/load round-trip。
- 向後相容:既有 `resume` / `auto-resume` / `plan_resume` 測試維持綠。

## 8. 範圍外(刻意不做)

- harness adapter 不寫成 python 腳本:它本質是 agent 用原生工具(ScheduleWakeup / cron)的動作,留在 SKILL 編排層。
- 雲端 cron + remote push 的完整實作仍為替代方案,不在本份核心。
- 自動偵測限流 / 解析 reset 時間:本設計刻意以「週期重試」迴避,不解析訊息格式。

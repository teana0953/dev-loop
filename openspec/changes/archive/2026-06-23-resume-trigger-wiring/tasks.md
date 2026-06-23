## 1. checkpoint resume_exec 欄位

- [ ] 1.1 寫失敗測試:`resume_exec` save/load round-trip 與預設 None(test_checkpoint.py)
- [ ] 1.2 在 `Checkpoint` dataclass 新增選填 `resume_exec`(預設 None),含 save/load 序列化;跑綠

## 2. run_watcher(週期重試)

- [ ] 2.1 寫失敗測試:第一次 exec 回 0 → 立即返回不睡;前 N 次非 0、第 N+1 次 0 → 睡 N 次後返回;heartbeat 夾到 3600、預設 1800(test_adapter.py)
- [ ] 2.2 實作 `run_watcher`(取代/重構 `run_adapter` 的等待語意);保留 `run_adapter` 既有簽章與行為供 auto-resume;跑綠

## 3. arm-local CLI 子命令

- [ ] 3.1 寫失敗測試:無 pid → spawn(mock spawn);pid 存活 → no-op;stale pid → 覆寫重生;resume_exec 空且無 --exec → 非零退出(test_cli.py)
- [ ] 3.2 實作 `arm-local` 子命令 + `.devloop/watcher.pid` 行程存活檢查與 detached spawn;跑綠
- [ ] 3.3 將 `.devloop/watcher.pid` 加入 `.gitignore`

## 4. 向後相容驗證

- [ ] 4.1 確認既有 `plan_resume` / `resume` / `auto-resume` 測試維持綠;必要時補一條相容性測試

## 5. SKILL 編排接線

- [ ] 5.1 `skills/dev-loop/SKILL.md`:每個 checkpoint(start/event/gate/review)後加「確保觸發器就位」步驟;新增 `trigger` 設定(local 預設 / harness);start 帶入 resume_exec
- [ ] 5.2 改寫 SKILL「Token 用罄續跑」段(自動 arm 為主、手動 auto-resume 降為進階)
- [ ] 5.3 同步更新 `.claude/commands/dev-loop.md` 與 README 對應說明

## 6. 收尾

- [ ] 6.1 全測試綠(pytest);`openspec validate resume-trigger-wiring --strict` 通過

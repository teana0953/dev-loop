## 1. auto-arm 引擎化

- [x] 1.1 TDD:從 `_cmd_arm_local` 抽出 `ensure_armed(checkpoint_path, heartbeat, …)`(注入 spawn/pid-alive 替身);`arm-local` 改薄殼,既有 arm-local 測試全綠
- [x] 1.2 TDD:`config.py` 支援 `auto_arm` 讀取(缺檔/缺鍵預設 true)
- [x] 1.3 TDD:14 個寫 checkpoint 的子命令(`start`/`event`/`gate`/`proposal-review`/`qa`/`legs-init`/`leg-done`/`review`/`units-init`/`unit-done`/`unit-claim`/`unit-resolve`/`units-merge`/`units-cleanup`)save 後自動 arm——參數化測試逐命令驗證(清單以 grep cp.save 對賬);`resume_exec` 空靜默跳過;`auto_arm=false` 不 arm
- [x] 1.4 TDD:auto-arm 失敗僅 stderr `warning: auto-arm failed`,主命令 stdout/exit code 不變

## 2. status next hint

- [x] 2.1 TDD:`status` 第二行輸出 `next: ` hint——phase→hint 查表(確定性步驟給命令骨架、判斷型給 dispatch 說明、done/escalated 明確收束);窮舉測試 `PHASES` 每成員都有 hint
- [x] 2.2 TDD:units 有 pending / legs 未收齊時優先提示;既有第一行輸出與 exit 0 契約回歸測試

## 3. SKILL loop 敘事重構

- [ ] 3.1 `skills/dev-loop/SKILL.md`:核心迴圈改寫成「每回合讀 phase → 推進到卡點 → 未終態則 ScheduleWakeup(fallback ≥1200s)」;刪「每個 checkpoint 後 arm」整節;「Token 用罄續跑」縮寫為 watcher 兜底(引擎自動)+ /loop 正職;`trigger` 語義表(local=watcher only、harness=watcher 兜底+/loop 正職);resume 節改為「跑 `status` 照 `next:` 行動」
- [ ] 3.2 `README.md` 使用方式若有引用手動 arm/舊 trigger 敘述,同步對齊;全套測試綠

## Context

上位設計:`docs/superpowers/specs/2026-07-02-dev-loop-v2.1-loop-native-design.md` §3(Change B)。Change A 已 merge(`e69ed30`),狀態機語義完整。

現況:`_cmd_arm_local`(cli.py)持有 idempotent 的 watcher 確保邏輯(pid 檔 + `_pid_alive` + `_spawn_watcher`);14 個子命令會呼叫 checkpoint save 但都不 arm(以 grep cp.save 對賬:start/event/gate/proposal-review/qa/legs-init/leg-done/review/units-init/unit-done/unit-claim/unit-resolve/units-merge/units-cleanup);`status` 只印單行識別;SKILL.md 靠「每個 checkpoint 後 arm」一節提醒模型。

## Goals / Non-Goals

**Goals:**
- 寫 checkpoint 即自動確保 watcher 在位;模型記性從續跑可靠性的關鍵路徑移除。
- `status` 給冷啟動 resume 一個確定性的下一步入口(`next:` hint)。
- SKILL 以 loop engineering 敘事重寫觸發/續跑相關章節。

**Non-Goals:**
- 不改 watcher 本體(`run_watcher`/`run_adapter`)與 `plan_resume`。
- 不做雲端 push/remote 續跑(v2 spec §9B 維持註記)。
- 不強制 /loop:headless(`trigger=local`)路徑行為不變。

## Decisions

1. **auto-arm 掛在 cli 層的 save 之後,不掛進 `Checkpoint.save()`。**
   替代方案:在 checkpoint.py 的 save 內呼叫——會讓資料層依賴行程管理(spawn/pid),污染 stdlib 純資料模組,且測試需處處 mock。cli 層集中一個 helper(`_ensure_armed_after_save(cp, args)`)在每個子命令 save 後呼叫,關注點分離。
2. **`ensure_armed()` 從 `_cmd_arm_local` 抽出共用**,`arm-local` 子命令變薄殼。單一實作、pid 檔語義不變。核心函式回傳結果(armed/already/skipped)不印字:`arm-local` 殼負責現有 stdout 訊息,auto-arm 路徑靜默——避免污染 gate/event 等主命令的 stdout 契約。
3. **arm 失敗只 stderr 警告不改 exit code**:arm 是兜底,不能讓 gate/review 等主命令因 spawn 失敗而失敗;警告格式 `warning: auto-arm failed: <原因>`。
4. **`auto_arm` 放 config,預設 true;`--no-auto-arm` 不做**——config 是專案層策略的家(與 trigger/finish 同家);CLI flag 會讓 14 個子命令都長參數,YAGNI。**config 定位慣例:checkpoint 檔同目錄的 `config.json`**(如 `.devloop/checkpoint.json` → `.devloop/config.json`),auto-arm helper 由 `args.file` 推導,子命令不加 `--config` 參數;`config.py` 新增 `auto_arm` 欄位(`load_config` 缺檔/缺鍵預設 true)。
   註:auto-arm 生效仍需 `resume_exec` 非空——headless 續跑命令是 `start` 時的顯式選擇,無 resume_exec 即無可 arm,靜默跳過(不警告)。
5. **`next:` hint 由引擎依 checkpoint 決定,只給命令骨架**:phase→命令模板查表(gate/qa/review 等確定性步驟給完整 `python3 -m devloop.cli …` 骨架;apply/fix/propose 等判斷型步驟給 `next: dispatch <說明>` 文字)。units/legs 有 pending 時優先提示(`units-status` / 缺 leg 報告)。hint 是第二行、以 `next: ` 開頭;第一行識別輸出與 exit code 契約不變。
6. **SKILL.md 重構為文檔任務**,與引擎同 change 落地,由 review leg 把關與實作一致;merge 後回灌 `~/.claude/skills/dev-loop`(收尾步驟)。

## Risks / Trade-offs

- [12 個子命令都要掛 helper,易漏] → 測試逐命令參數化驗證「save 後 armed」;review leg 對照清單。
- [測試環境不能真 spawn] → `ensure_armed` 依既有 `_spawn_watcher`/`_pid_alive` 可注入替身;沿 test_cli.py 既有 monkeypatch 慣例。
- [status hint 表未來 phase 演化要同步維護] → 表放 statemachine 常數旁,加窮舉測試(每個 PHASES 成員都有 hint 或明確豁免)。

## Migration Plan

純新增 + 文檔重寫;`auto_arm=false` 即回 v2 行為。回滾 = revert merge commit。

## Open Questions

(無)

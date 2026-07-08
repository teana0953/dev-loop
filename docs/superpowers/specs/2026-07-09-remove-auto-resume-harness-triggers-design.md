# 移除「token 用罄 harness 自排 + 精準睡」續跑機制

日期:2026-07-09

## 背景與動機

「token 用完自動接上」在現況下由**兩層**自動續跑機制疊成:

1. **引擎 detached watcher**(`trigger=local`,預設):`start --resume-exec` 把續跑命令寫進 checkpoint,之後每個寫 checkpoint 的子命令 `auto-arm` 一個 detached OS 程序反覆盲重試,直到 loop 推進。
2. **harness 自排**(`trigger=harness` + SKILL 步驟 3):agent 自己用 `ScheduleWakeup` 排下一輪冷啟動;外加 `resume` / `auto-resume` / `plan_resume` 這條「已知 reset 時間精準睡」的路徑。

本次移除**第二層**(harness 自排 + 精準睡),只保留第一層(detached watcher)作為唯一的自動續跑手段。手動續跑能力不受影響。

## 目標邊界

**保留**(唯一留下的自動續跑):引擎 detached watcher —— `start --resume-exec`、`auto_arm`、`arm-local` / `ensure_armed` / `_spawn_watcher`、`_ensure_armed_after_save`、`run_watcher`、checkpoint 的 `resume_exec`。

**同時保留**(與 token 無關的手動續跑,不動):`status` 的 `next:` hint、`human_resume_propose` / `human_resume_fix` 事件、使用者主動說「dev-loop resume」。

**刪除**:
- harness 自排層:SKILL 步驟 3 的 `ScheduleWakeup` 自排。
- 精準睡路徑:`resume` / `auto-resume` CLI 子命令、`resume.py` 的 `plan_resume` / `ResumeAction`、`adapter.py` 的 `run_adapter`。
- `trigger` config 鍵與 local/harness 之分(引擎固定用 watcher 兜底)。

## 引擎改動(按檔案)

| 檔案 | 刪除 | 保留 |
|---|---|---|
| `devloop/resume.py` | 整個檔案(`plan_resume` / `ResumeAction`);`MAX_SLEEP_SECONDS` 搬到 `adapter.py` | — |
| `devloop/adapter.py` | `run_adapter`、`_default_now`、對 `datetime`/`timezone` 與 `Checkpoint`/`plan_resume` 的 import | `run_watcher`、`DEFAULT_HEARTBEAT`、`MAX_SLEEP_SECONDS`(移入) |
| `devloop/config.py` | `Config.trigger` 欄位 + `load_config` 的 trigger 讀取 | `auto_arm`、`finish` |
| `devloop/cli.py` | `_cmd_resume`、`_cmd_auto_resume`、`resume` / `auto-resume` 兩個 parser、相關 import(`plan_resume`、`run_adapter`) | `arm-local`、`watcher`、`ensure_armed`、`_ensure_armed_after_save`、`--resume-exec` |

### 向後相容

`config.py` 刪掉 `trigger` 欄位後,舊 `config.json` 若仍寫 `"trigger": "harness"`,`load_config` **靜默忽略**該鍵(不報錯、不警告)。已與使用者確認採此策略。

## 文件 / SKILL / OpenSpec 改動

| 檔案 | 改動 |
|---|---|
| `README.md` | 第 5 行敘述改為「token 用罄由 watcher 兜底續跑」;刪 config 的 `trigger` 鍵說明;CLI 表刪 `resume` / `auto-resume` 兩行;「Token 用罄續跑」節去掉 `trigger` 表與「精準睡」進階,只留 watcher 說明 |
| `skills/dev-loop/SKILL.md` | 步驟 3 去掉 `ScheduleWakeup` 自排(改為「未到終態即本回合結束,靠 watcher 兜底續跑」);刪「Trigger 語義」的 local/harness 表;刪 config 的 `trigger` 項;「Token 用罄續跑」去掉精準睡進階 |
| `openspec/specs/resume-trigger/spec.md` | 刪「既有 resume 路徑向後相容」Requirement(涵蓋 plan_resume / resume / auto-resume);其餘(週期重試 watcher / arm-local / checkpoint resume_exec / auto_arm / 自動 arm)不動 |

## 測試改動

- `tests/test_resume.py` → 整個刪除(全是 `plan_resume`)。
- `tests/test_adapter.py` → 刪 `run_adapter` 相關,保留 `run_watcher` 相關。
- `tests/test_cli.py` → 刪 `resume` / `auto-resume` 子命令測試,其餘不動。
- `tests/test_checkpoint.py` → `resume_exec` round-trip 測試**保留**(watcher 仍用它)。

## 驗證

1. `python3 -m pytest -q` 全綠。
2. `grep -rniE "plan_resume|run_adapter|auto-resume|_cmd_resume|\"trigger\"|ScheduleWakeup" devloop/ tests/ skills/ README.md` 無功能性殘留(僅剩合理敘述)。
3. 依 README 尾部同步步驟,把 `devloop/*.py` + `SKILL.md` 同步到 `~/.claude/skills/dev-loop/` 安裝副本。

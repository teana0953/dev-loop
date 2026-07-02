## Why

手動 arm 儀式是 dev-loop 最大脆弱點:SKILL 要求模型在每個寫 checkpoint 的命令後記得 `arm-local`,漏一次續跑就靜默失敗——「每次 X 後做 Y」正是模型最不可靠的事,違反「確定性歸引擎」哲學。同時 `trigger=harness` 路徑(每 checkpoint 手動 ScheduleWakeup)在手工重造 harness 原生的 /loop dynamic mode。Change A(engine-semantics-fixes)已 merge,本 change 完成 v2.1 的 loop-native 重構。

## What Changes

- **引擎自動 arm**:抽出 `ensure_armed()`;所有寫 checkpoint 的子命令(`start`/`event`/`gate`/`proposal-review`/`qa`/`leg-done`/`review`/`units-init`/`unit-done`/`unit-claim`/`unit-resolve`/`units-merge`)在 save 後、`resume_exec` 非空且 config `auto_arm` 為 true(預設)時自動確保 watcher 在位;arm 失敗僅 stderr 警告、不影響主命令 exit code。
- **config 新增 `auto_arm`**(預設 true);`arm-local` 子命令保留(手動補救)。
- **`status` 新增 `next:` hint**:第二行輸出依 phase(與 units/legs 狀態)建議的下一步命令骨架;既有單行識別輸出不變。
- **SKILL.md 重構成 loop 敘事**:核心迴圈改為「每回合:讀 checkpoint phase → 推進到卡點(✋/終態/token 邊界)→ 未終態則 ScheduleWakeup 排下回合(fallback ≥1200s)」;`/loop /dev-loop resume` 成為 harness 標準運行形態;刪除「每個 checkpoint 後 arm」整節;「Token 用罄續跑」縮寫為 watcher 兜底(自動)+ /loop 正職。
- **trigger 語義向後相容**:`local`(預設)= watcher only(headless);`harness` = watcher 兜底 + /loop 正職。

## Capabilities

### New Capabilities

(無)

### Modified Capabilities

- `resume-trigger`: 新增需求——寫 checkpoint 的子命令自動確保 watcher 在位(auto-arm)、config `auto_arm` 開關、arm 失敗不反噬主命令。既有 watcher/arm-local/resume 需求不變。
- `cli-status`: 新增需求——`status` 輸出 `next:` 下一步命令 hint;既有單行識別輸出需求不變。

## Impact

- `devloop/cli.py`:抽 `ensure_armed()`、各寫 checkpoint 子命令掛 auto-arm、`status` next hint。
- `devloop/config.py`:`auto_arm` 讀取(預設 true)。
- `skills/dev-loop/SKILL.md`:loop 敘事重構(文檔,行為由 review leg 把關)。
- 測試:auto-arm 注入 fake spawn 驗各子命令、`auto_arm=false` 不 arm、arm 失敗 exit code 不變、status hint 輸出契約。
- 向後相容:v2 checkpoint/config 不變即得預設行為;`arm-local` 手動路徑保留。

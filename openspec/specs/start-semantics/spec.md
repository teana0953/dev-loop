# start-semantics Specification

## Purpose
`start` 建立新 checkpoint,但既有 checkpoint 若非 `done` 終態就代表一條進行中(或停等人工)的 loop——靜默覆蓋等於丟狀態。明確 start 的覆蓋語義:done 讓路、其餘拒絕、`--force` 明確覆蓋。
## Requirements
### Requirement: start 覆蓋保護
`start` 遇既有 checkpoint 時 SHALL 依 phase 決定:`done` → 允許直接覆蓋(上一輪已完結);其餘 phase(含 `escalated`——它有 human_resume 出口,不該被清掉)→ 拒絕,stderr 印 `error: checkpoint exists (phase=<phase>)`(含 resume 與 `--force` 提示)、exit 2、原 checkpoint 不變。checkpoint 檔存在但無法解析時 SHALL 同樣保守拒絕(phase 顯示 `unreadable`)。`--force` SHALL 無條件覆蓋。無既有 checkpoint 時行為不變。

#### Scenario: done 讓路
- **WHEN** 既有 checkpoint phase=done,執行 `start`
- **THEN** 新 checkpoint 建立,exit 0

#### Scenario: 進行中拒絕
- **WHEN** 既有 checkpoint phase=gate,執行 `start`(無 `--force`)
- **THEN** exit 2,stderr 含 `checkpoint exists`、`phase=gate` 與 `--force`,原 checkpoint 不變

#### Scenario: escalated 拒絕
- **WHEN** 既有 checkpoint phase=escalated
- **THEN** 同進行中,exit 2(人工續跑出口是 `human_resume_*`,不是重開)

#### Scenario: --force 明確覆蓋
- **WHEN** 既有 checkpoint phase=fix,執行 `start --force`
- **THEN** 覆蓋成功,exit 0

#### Scenario: 壞檔保守擋下
- **WHEN** checkpoint 檔存在但非合法 JSON
- **THEN** 無 `--force` 拒絕(exit 2);帶 `--force` 覆蓋成功

### Requirement: start 以 --meta 凍結流程軸
`start` SHALL 支援選用參數 `--meta <path>`:載入 change meta,把 `flow_profile`(未設→`"full"`)與 `needs_uiux` 複製進新 checkpoint;meta 檔不存在時等同未帶(走預設,不報錯——meta 可能尚未寫);meta 含非法 `flow_profile` 時 SHALL fail loudly(exit 2,不建立 checkpoint)。覆蓋保護語義(done 讓路/其餘拒絕/--force)不變。

#### Scenario: --meta 複製兩軸
- **WHEN** meta 檔含 `{"flow_profile": "light", "needs_uiux": true}`,`start --meta` 指向它
- **THEN** 新 checkpoint `flow_profile="light"`、`needs_uiux=true`

#### Scenario: meta 檔缺失走預設
- **WHEN** `start --meta` 指向不存在的路徑
- **THEN** checkpoint 建立成功,`flow_profile="full"`、`needs_uiux=false`

#### Scenario: 非法 profile 不建 checkpoint
- **WHEN** meta 含 `{"flow_profile": "lite"}`
- **THEN** exit 2,checkpoint 未建立


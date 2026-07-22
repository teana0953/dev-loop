# start-semantics Specification (delta)

## ADDED Requirements

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

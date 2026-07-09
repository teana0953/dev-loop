# gate-commands-config Specification

## Purpose
gate 的 test/lint/build 命令屬於專案的固定事實,不該每回合由 agent 現場推斷(冷啟動續跑尤其易猜錯)。存進 `.devloop/config.json` 的 `gate_cmds` 後,`gate` 不帶 `--cmd` 即可執行、`status` 的 gate hint 給完整可執行命令,續跑趨近零判斷。同時釘住空命令假綠:空清單進 `run_gate` 恆 pass,絕不允許。

## Requirements
### Requirement: gate 命令來源解析
`gate` 子命令的命令清單 SHALL 依序解析:有 `--cmd` 用 `--cmd`(CLI 優先,可臨時 override);否則讀 checkpoint 同目錄 `config.json` 的 `gate_cmds`(list of 非空字串,每項語義同一個 `--cmd`)。兩者皆空時 SHALL 印 `error: no gate commands` 到 stderr、exit 2、checkpoint 不變——空命令清單 MUST 不得進入 gate 執行(否則恆 pass 假綠)。

#### Scenario: config fallback
- **WHEN** `gate` 不帶 `--cmd`,config 有 `"gate_cmds": ["true"]`
- **THEN** 執行 config 命令,全綠推進 qa,exit 0

#### Scenario: CLI 優先於 config
- **WHEN** config 的 `gate_cmds` 會失敗,但 `--cmd true`
- **THEN** 以 `--cmd` 為準,gate 通過

#### Scenario: 皆無不假綠
- **WHEN** `gate` 不帶 `--cmd` 且 config 無 `gate_cmds`
- **THEN** stderr 含 `no gate commands`,exit 2,phase 仍為 `gate`

### Requirement: gate_cmds 值域驗證
config 的 `gate_cmds` SHALL 為非空字串的 list;非法(非 list、含空字串或非字串項)時 `gate` fallback 讀取 SHALL 拋設定錯誤 → stderr + exit 2,不得靜默退化(與 finish 值域驗證同精神)。

#### Scenario: 非 list 報錯
- **WHEN** config 的 `gate_cmds` 為 `"pytest -q"`(字串,非 list)
- **THEN** `gate` exit 2,stderr 含 `gate_cmds`,checkpoint 不變

### Requirement: status 的 gate hint 隨 config 升級為完整命令
config 的 `gate_cmds` 非空時,`status` 對 phase=gate 的 `next:` hint SHALL 給完整可執行命令(`next: python3 -m devloop.cli gate --file <cp>`,不帶 `--cmd` 骨架——引擎會 fallback 到 config);`gate_cmds` 空時維持既有 `<test-cmd>` 骨架。

#### Scenario: 有 config 給完整命令
- **WHEN** config 有 `gate_cmds`,對 phase=gate 執行 `status`
- **THEN** `next:` 行是可直接執行的 gate 命令,不含 `<test-cmd>` 佔位

#### Scenario: 無 config 維持骨架
- **WHEN** config 無 `gate_cmds`
- **THEN** `next:` 行維持含 `<test-cmd>` 的骨架

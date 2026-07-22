# cli-status Specification (delta)

## MODIFIED Requirements

### Requirement: status 輸出下一步 hint
`status` 子命令 SHALL 在既有單行識別輸出之後,輸出一行以 `next: ` 開頭的下一步建議:確定性步驟(gate/qa 收報告/review 彙總/finish/終態)給命令骨架或明確說明;判斷型步驟(propose/apply/fix 等)給 `next: dispatch …` 說明文字;apply/fix 有 pending units 或 review/qa 有未收 legs 時 SHALL 優先提示該未完成項。phase=qa 且 checkpoint `flow_profile="light"` 且 `needs_uiux=false` 時,hint SHALL 給 `devloop event --file <f> --event qa_skip`(裁剪路徑零判斷);其餘 qa 情境照 qa 命令骨架。`PHASES` 的每個成員 MUST 都有對應 hint(含終態)。既有第一行內容與 exit code 契約不變。

#### Scenario: gate phase 給命令骨架
- **WHEN** 對 phase=gate 的 checkpoint 執行 `status`
- **THEN** 第一行仍含 `phase=gate`,第二行以 `next: ` 開頭且含 `devloop.cli gate`(config 有 `gate_cmds` 時給完整可執行命令,見 gate-commands-config)

#### Scenario: apply 有 pending units 時優先提示
- **WHEN** phase=apply 且 checkpoint `units[]` 有 `pending` 的 unit
- **THEN** `next:` 行提示 pending units(含 unit id 或 `units-status`)

#### Scenario: 終態明確收束
- **WHEN** phase=done 執行 `status`
- **THEN** `next:` 行明確表示無後續(如 `next: (done)`),exit 0

#### Scenario: qa 在 light 非 uiux 時 hint qa_skip
- **WHEN** phase=qa 且 checkpoint `flow_profile="light"`、`needs_uiux=false`
- **THEN** `next:` 行含 `event` 與 `qa_skip`;若 `needs_uiux=true` 或 profile=full,`next:` 行照舊為 qa 命令骨架

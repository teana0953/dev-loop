# Proposal: flow-profile-and-uiux-thread

## Why

兩個痛點:(1) 小 change(docs/config/微調)跑全流程太重——brainstorm 批准、QA 對它們是純儀式;(2) UX 相關的 change 只在 review 末端有一條 uiux leg,設計方向錯要到最後才發現。把「流程可裁剪」與「UI/UX 全程考量」做成兩條正交軸,由編排自動判定、人批准時可推翻、引擎機械守護。

## What Changes

- **軸 1 `flow_profile`**(change meta,`full` 預設 | `light`):light = 設計縮短併入 proposal、跳過✋批准設計、QA 以 `qa_skip` 誠實跳過;hard gate 恆不可裁。引擎新事件 `qa_skip`(qa→review)帶 guard:checkpoint `flow_profile=light` 且 `needs_uiux=false` 才放行。
- **軸 2 `needs_uiux`** 升級為 UI/UX 線開關(涵蓋 UI 視覺與 UX 流程互動):true 時設計文件必含 UI/UX 節、OpenSpec spec 必含可驗 UI/UX 驗收 scenario、QA 併驗 UX、review 加 uiux leg(現行)。**UX 線不受裁剪**:light+uiux 時 QA 保留(只驗 UX 驗收)、uiux leg 保留。
- 兩軸由編排在 brainstorm 自動判定、批准提案時明示供推翻;`start --meta` 把兩軸凍結進 checkpoint(此後引擎只讀 checkpoint;逃生門重 propose 不重判,要改人工改 meta 重 start)。
- `Checkpoint` 加 `flow_profile`/`needs_uiux` 欄位;`next_hint` qa 階段依兩軸分岔(light 非 uiux → hint `qa_skip`)。
- 新 prompt 正本 `references/uiux-thread.md`(設計節模板/驗收寫法/QA 檢查點/判定準則)。
- review legs kinds 規則零改動(`code[,uiux]`)。
- 版本 0.4.0 → 0.5.0。

## Capabilities

### New Capabilities

- `flow-profile`:流程檔位——meta/checkpoint 欄位與凍結語義、`qa_skip` 轉移與 guard、light 的編排裁剪規則(跳批准設計/縮設計/qa_skip)、gate 恆不可裁。
- `uiux-thread`:UI/UX 線——needs_uiux 自動判定與人工推翻、各階段 UX 要求(設計節/驗收 scenario/QA 檢查)、UX 線不受裁剪規則、prompt 正本。

### Modified Capabilities

- `start-semantics`:start 新增 `--meta` 複製凍結兩軸(新 requirement,覆蓋保護不變)。
- `statemachine-guardrails`:新增 `qa_skip` 轉移與 guard requirement。
- `cli-status`:`status 輸出下一步 hint` requirement 補 qa 階段依兩軸分岔。

## Impact

- `devloop/changemeta.py`(欄位+驗證)、`checkpoint.py`(欄位)、`statemachine.py`(事件/轉移/hint)、`cli.py`(start --meta、event guard、status 傳參)。
- `skills/dev-loop/SKILL.md`(兩軸判定、light 流程、QA 分岔、UX 線)+ 新 `references/uiux-thread.md`。
- `tests/`、README、版本兩處。

# report-validation Specification

## Purpose
review / qa / proposal-review 報告是自動 merge 的守門輸入。subagent 產出的格式錯誤報告 MUST fail loudly,不得與「findings 為空(=pass)」混同而被靜默放行。

## Requirements
### Requirement: 報告 schema strict 驗證
`parse_review_report` SHALL 驗證:檔案可讀且為合法 JSON、頂層為含 `findings` 鍵的物件、`findings` 為 list、每個 finding 為物件且 `severity` ∈ {`blocking`, `non_blocking`}、finding 的 `note` 若存在 SHALL 為字串。任一不符 SHALL 拋 `ReportError`(含檔案路徑與原因);`note` 缺席為合法(視為空字串);空 `findings` list 為合法(表示無 findings)。此驗證 SHALL 同時作用於 `--report` 單報告與 `--from-legs` 彙總的每個 leg 報告。

#### Scenario: 拼錯 key 不被當成 pass
- **WHEN** qa 報告內容為 `{"finding": []}`(缺 `findings` 鍵)
- **THEN** `qa` 命令 stderr 含錯誤訊息、exit 2,checkpoint phase 不變

#### Scenario: 非法 severity 報錯
- **WHEN** review 報告 finding 的 `severity` 為 `"block"`
- **THEN** `review` 命令 exit 2,錯誤訊息含 severity 與檔案位置

#### Scenario: 非字串 note 報錯
- **WHEN** review 報告 finding 為 `{"severity": "non_blocking", "note": 42}`
- **THEN** `review` 命令 exit 2,錯誤訊息含 note 與檔案位置
- **AND** 理由:`note` 最終要被 follow-up 渲染器串進 markdown。不在解析當下擋,它會存進 checkpoint、活到 merge 階段才出事,而且兩個引擎的出事方式不同(一邊拋錯、一邊把數字印進文件)

#### Scenario: 空 findings 合法
- **WHEN** 報告為 `{"findings": []}`
- **THEN** 正常解析為無 findings(qa → pass、review → no blocking)

### Requirement: cli 對 ReportError 的統一處理
吃報告的子命令(`review`、`qa`、`proposal-review`,含 `--from-legs`)遇 `ReportError` SHALL 印 `error: <原因>` 到 stderr 並 exit 2,checkpoint MUST 不被改寫。

#### Scenario: 非 JSON 報告
- **WHEN** proposal-review 的報告檔內容不是 JSON
- **THEN** exit 2,stderr 含錯誤,phase 仍為 `proposal_review`

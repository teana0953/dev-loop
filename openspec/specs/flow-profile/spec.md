# flow-profile Specification

## Purpose
TBD - created by archiving change flow-profile-and-uiux-thread. Update Purpose after archive.
## Requirements
### Requirement: flow_profile 欄位與凍結
change meta SHALL 支援 `flow_profile` 鍵(`"full"`/`"light"`;缺鍵視為 full;其他值 `load_change_meta` SHALL 拋 ValueError)。`start --meta <path>` SHALL 把 meta 的 `flow_profile`(None→`"full"`)與 `needs_uiux` 複製進 checkpoint 欄位並凍結;未帶 `--meta` 時 checkpoint 預設 `full`/`false`。凍結後引擎決策(qa_skip guard、next hint)MUST 只讀 checkpoint,不讀 meta。

#### Scenario: start 凍結兩軸
- **WHEN** meta 為 `{"flow_profile": "light", "needs_uiux": true}`,執行 `start --meta <path> ...`
- **THEN** checkpoint 的 `flow_profile` 為 `"light"`、`needs_uiux` 為 true

#### Scenario: 未帶 meta 走預設
- **WHEN** 執行 `start` 不帶 `--meta`
- **THEN** checkpoint `flow_profile="full"`、`needs_uiux=false`(行為同現行全流程)

#### Scenario: flow_profile typo 即炸
- **WHEN** meta 為 `{"flow_profile": "lite"}`
- **THEN** `load_change_meta` 拋 ValueError,訊息含 `flow_profile` 與 `"lite"`

### Requirement: qa_skip 誠實轉移與 guard
狀態機 SHALL 支援事件 `qa_skip`(qa→review)。CLI `event` SHALL guard:checkpoint `flow_profile=="light"` 且 `needs_uiux==false` 才放行;否則 exit 2、stderr 說明、checkpoint 不動。放行時 SHALL 與其他事件同樣落 history(裁剪可審計)。hard gate MUST 無任何 profile 下的跳過路徑。

#### Scenario: light 非 uiux 放行
- **WHEN** checkpoint phase=qa、flow_profile=light、needs_uiux=false,執行 `event --event qa_skip`
- **THEN** phase=review,history 記錄 qa_skip

#### Scenario: full 拒絕
- **WHEN** checkpoint flow_profile=full,執行 `event --event qa_skip`
- **THEN** exit 2,phase 仍為 qa

#### Scenario: light+uiux 拒絕(UX 線不可裁)
- **WHEN** checkpoint flow_profile=light、needs_uiux=true,執行 `event --event qa_skip`
- **THEN** exit 2,phase 仍為 qa——QA 保留以驗 UX 驗收

### Requirement: light 的編排裁剪
`flow_profile=light` 時編排 skill SHALL:brainstorm 縮為短設計節直接寫入 proposal(不產獨立設計草稿)、跳過「批准設計」人工關卡(「批准提案」保留,兩軸判定值在此明示供推翻);apply、gate、review、fix、finish 流程 MUST 與 full 相同。檔位由編排在 brainstorm 依準則建議(docs/config/文案/微調 → light;功能或行為變更 → full;不確定 MUST 取 full),`auto_approve=true` 時建議自動視為接受。

#### Scenario: light 只停一個關卡
- **WHEN** flow_profile=light 且 auto_approve=false
- **THEN** 唯一人工批准點是「批准提案」;設計內容含在 proposal 內

#### Scenario: 不確定取 full
- **WHEN** 編排無法明確歸類 change 大小
- **THEN** 建議 full(保守;裁剪需要明確理由)


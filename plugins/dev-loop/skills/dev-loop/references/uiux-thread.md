# UI/UX 線正本(needs_uiux=true 時各階段指示)

> 此檔是 UI/UX 線的**唯一正本**——涵蓋 UI(介面視覺)與 UX(流程互動)兩面。各階段照抄對應段落併入產物/prompt,勿即興改寫。

## 1. needs_uiux 判定準則(brainstorm 時自動判)

change 觸及**使用者可見的介面或互動**即為 true:畫面/版面/元件、文案與訊息呈現、互動流程(點擊路徑、表單、導航)、狀態呈現(loading/錯誤/空狀態)、CLI 的人機輸出格式。純後端邏輯、內部 API、build/CI、docs 為 false。**不確定時取 true**(多一條 uiux leg 的成本低於漏掉 UX 缺陷)。判定值寫入 change meta 的 `needs_uiux`,批准提案時明示供使用者推翻。

## 2. 設計文件「UI/UX 設計」節模板(design.md 必含)

- **使用者路徑**:誰、在什麼情境、走哪條流程完成什麼;主路徑與例外路徑。
- **介面與一致性**:改動涉及的畫面/元件/輸出格式;與既有介面語彙的一致性(命名、排版、互動慣例)。
- **狀態設計**:loading、錯誤、空狀態、邊界輸入下使用者看到什麼。
- **可及性/理解性**:訊息是否可理解、錯誤是否可行動(告訴使用者怎麼辦)。

## 3. UI/UX 驗收 scenario 寫法(OpenSpec spec 必含)

只收**可觀察、可驗證**的行為句,拒絕「好看」「直覺」類主觀句:

- ✅「WHEN 表單提交失敗 THEN 錯誤訊息出現在欄位旁,說明原因與修正方式,已填內容保留」
- ✅「WHEN 清單為空 THEN 顯示空狀態指引(含下一步動作),不是空白頁」
- ❌「介面要美觀」「操作要流暢」(不可驗,不收)

## 4. QA 的 UX 檢查點(QA subagent prompt 併入)

依 spec 的 UI/UX 驗收 scenario 逐條實際操作驗證(跑 app/CLI,不是讀 code 推斷),並額外檢查:錯誤路徑訊息是否如設計、狀態轉換(loading→內容/錯誤)是否正確呈現、既有介面是否被此 change 意外破壞。報告 level=behavior,UX 缺陷同功能缺陷分級(影響使用者完成任務 = blocking)。

**light + uiux 組合**:QA 範圍縮為只驗 UI/UX 驗收 scenario(功能面由 gate 與 review 把關)。

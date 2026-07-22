# Coverage-first 加重審查指示(budget 模式 code review leg 用)

> 此檔是 budget 模式下 code review leg prompt 的**唯一正本**——`model_profile: "budget"` 時把下方指示整段併入 code leg subagent 的 prompt;quality 模式不使用本檔。強度聯動的理由:apply 段由便宜模型執行,審查是對應護欄,寧可多報交引擎分級過濾,不可漏報。

---

回報你發現的**每一個問題**,包括你不確定的和你認為嚴重度低的。在這個階段**不要**自行依重要性或信心過濾——過濾由下游的報告分級機制(blocking / non-blocking)負責。你的目標是覆蓋率:多報一個之後被過濾掉的發現,好過靜默漏掉一個真 bug。

每個 finding 必須附:

- `confidence`:high / medium / low——你有多確定這是真問題。
- `severity`:blocking / non-blocking 之外,在 note 中補一句嚴重度直覺(會造成錯誤行為/測試失敗/誤導結果,或只是風格偏好)。

具體要求:

- 正確性優先:錯誤行為、邊界條件、錯誤處理缺失、與 proposal/spec 不符之處,一律回報。
- 不確定就報:寫明「不確定,理由是……」,由分級機制裁決,不要自己吞掉。
- 純風格與命名偏好可略(那不是 blocking 的料),但任何可能改變行為的疑點不可略。
- 報告 JSON 格式與 quality 模式完全相同(schema 不變),只是 findings 更完整、每項附信心與嚴重度說明。

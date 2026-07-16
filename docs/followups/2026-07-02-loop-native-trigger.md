## Follow-up(non-blocking)

> **清點(2026-07-16):全數關閉。** 逐項對照現行程式碼的結果標注於各項開頭。

- ✅ **已解**(cli.py `ensure_armed`)— design Decision 2『ensure_armed 單一實作、arm-local 變薄殼』未處理 stdout 污染:現 _cmd_arm_local(cli.py:224/229)會對 stdout 印 'watcher already running'/'watcher armed'。若直接抽出重用,auto-arm 會把這些行追加到各主命令 stdout,違反 resume-trigger『gate 的 stdout 與 v2 相同』與 cli-status『第一行/stdout 契約不變』scenario。需明訂 ensure_armed 核心邏輯在 auto-arm 路徑靜默(訊息留在 arm-local 薄殼或改走 stderr)。
  *現行 `ensure_armed` 回傳 (status, info) 不印字,訊息留在 `_cmd_arm_local` 薄殼;auto-arm 失敗僅 stderr 警告。*
- ✅ **已解**(config.py + cli.py `_ensure_armed_after_save`)— auto_arm 的 config 讀取路徑未指定、與現有介面不接:design Decision 4 說 auto_arm 放 .devloop/config.json,但那 12 個寫 checkpoint 的子命令(gate/event/…,見 build_parser)都沒有 --config 參數,只有 finish 有;artifacts 未說明 auto-arm helper 如何定位 config(例:取 Path(args.file).parent/'config.json')。此路徑解析機制需在 design/tasks 補明,否則實作要自行臆造慣例。config.py 亦需新增 Config.auto_arm 欄位(現僅 trigger/finish)。
  *`Config.auto_arm` 已存在;auto-arm 以 `Path(args.file).parent / "config.json"` 定位 config,即建議的慣例。*
- ✅ **不再適用** — design.md Risks 第一條殘留舊數字:「[12 個子命令都要掛 helper,易漏]」應為 14,與同檔 Context/Decision 4 及 proposal/spec/tasks 的 14 項清單不一致。純文字殘留,緩解措施(參數化測試 + grep cp.save 對賬)本身正確,不影響可實作性。
  *該 change 的 design.md 已隨 archive 移出 repo,repo 內已無此殘留文字。*
- ✅ **已解**(statemachine.py 註記,2026-07-16 補)— devloop/statemachine.py:82 next_hint — specs/cli-status/spec.md 明文要求「review/qa 有未收 legs 時優先提示」,但實作只判 phase=='review'(不含 qa)。實務上 legs 僅在 review 階段 legs-init(SKILL step 8),qa 階段 review_legs 恆空,故此分支 vacuous、無可觀察行為差異;僅屬 spec 措辭與實作的對齊落差,建議收斂 spec 措辭或加註豁免。
  *已在 next_hint 的 legs 分支加註「legs 僅存在於 review,僅判 review 是刻意的」;該 delta spec 已隨 archive 移出 repo。*
- ✅ **不修(歷史紀錄)** — commit c546dfc 訊息標為「task 1.4 auto-arm 失敗僅 stderr」,實際內容為 tests/test_statemachine.py 的 next_hint 測試(屬 task 2.1)。git hook 自動產生的錯標;無重複測試、無測試名衝突(next_hint 測試在 test_statemachine.py、auto-arm 1.4 真正測試在 test_cli.py a46c175),僅 commit 訊息與內容不符。
  *已進 main 的歷史 commit 不改寫;本條備查即可。*

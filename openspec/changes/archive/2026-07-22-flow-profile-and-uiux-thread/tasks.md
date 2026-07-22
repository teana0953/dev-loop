# Tasks: flow-profile-and-uiux-thread

## 1. 引擎:changemeta/checkpoint(TDD)

- [x] 1.1 tests:changemeta `flow_profile` 載入(full/light/缺鍵→None)與 typo 拋 ValueError
- [x] 1.2 tests:checkpoint 新欄位預設(舊檔載入 `flow_profile="full"`、`needs_uiux=False`)
- [x] 1.3 實作:`ChangeMeta.flow_profile` + load 驗證;`Checkpoint` 兩欄位

## 2. 引擎:start --meta 凍結(TDD)

- [x] 2.1 tests:`start --meta` 複製兩軸;meta 檔缺失走預設不報錯;非法 profile exit 2 不建 checkpoint
- [x] 2.2 實作:start `--meta` 參數與複製邏輯

## 3. 引擎:qa_skip 與 hint(TDD)

- [x] 3.1 tests:`transition("qa", i, "qa_skip")` → review;非 qa phase 拋 InvalidTransition
- [x] 3.2 tests:CLI `event --event qa_skip` guard——light 非 uiux 放行(phase=review、history 記錄);full 拒絕 exit 2 phase 不動;light+uiux 拒絕 exit 2
- [x] 3.3 tests:`next_hint` qa 分岔——light 非 uiux 給 `event ... qa_skip`;light+uiux 與 full 照 qa 骨架;`status` 整合(傳 checkpoint 兩軸)
- [x] 3.4 實作:statemachine `QA_SKIP` 事件/轉移/hint 參數;cli event guard;status 傳參
- [x] 3.5 全測試綠

## 4. SKILL 與 references

- [x] 4.1 新增 `references/uiux-thread.md` 四段正本(設計節模板/驗收 scenario 寫法/QA UX 檢查點/needs_uiux 判定準則)
- [x] 4.2 SKILL:新「流程檔位與 UI/UX 線」節(兩軸判定準則、light 裁剪規則、UX 線不受裁剪、凍結語義)
- [x] 4.3 SKILL:流程步驟改寫——步驟 1(判兩軸;light 縮設計跳批准設計)、步驟 2(兩軸寫 meta)、步驟 3(start 帶 --meta)、步驟 7(QA 三分岔:full 照舊/light 非 uiux 走 qa_skip/uiux 併驗 UX、light+uiux 只驗 UX)、frontmatter description
- [x] 4.4 SKILL:Resume 節補 qa_skip hint 對應動作

## 5. 收尾

- [x] 5.1 README:流程說明補兩軸(自動判定、light、UX 線)
- [x] 5.2 版本 bump 0.4.0 → 0.5.0(兩處)
- [x] 5.3 全測試綠 + `openspec validate --all`

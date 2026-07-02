## Context

上位設計:`docs/superpowers/specs/2026-07-02-dev-loop-v2.1-loop-native-design.md` §2(Change A)。

現況:`statemachine.py` 的 `transition(phase, iteration, event, max_iterations)` 是純函式轉移表;`cli.py` 的 `_apply_event` 是唯一呼叫點;`Checkpoint` 以 JSON 序列化。三個缺口(propose 死路、gate↔fix 不計數、escalated 無出口)全在這條鏈上;`resolve_finish` 在 `config.py`。

## Goals / Non-Goals

**Goals:**
- 狀態機每個宣稱的迴圈都可達且有上限保護;人工介入有正式出口。
- v2 checkpoint 完全向後相容(缺新欄位視為 0)。
- `finish` 無效值 fail-fast。

**Non-Goals:**
- 不做 auto-arm 與 /loop 形態(Change B)。
- 不動 brainstorm 的人工 `start` 語義。
- 不改 `transition` 簽名、不重構既有轉移。

## Decisions

1. **計數存 checkpoint、判斷在 cli、transition 只加離散 event。**
   替代方案:擴充 `transition` 簽名帶計數並回傳三元組——會破唯一呼叫點與全部既有測試,且把「政策」(上限)混進「機制」(轉移表)。離散 event(`*_retry_exceeded`)讓轉移表保持純查表,計數政策集中在 cli 層,與 v2「確定性歸引擎、分層清楚」一致。
2. **`gate_failures` 累計不隨 `gate_pass` 重置,`human_resume_*` 時歸零。**
   替代方案:gate_pass 重置——會讓「pass/fail 交替震盪」逃過保護;iteration 已涵蓋正常輪次,gate_failures 專職守異常紅燈,兩計數各司其職。
3. **超限語義沿 v2 慣例用 `>`**(`new > max` 才升級),與 `iteration > max_iterations` 一致。
4. **`human_resume_*` 歸零三計數在 `_cmd_event` 做**(套用轉移成功後),因為歸零是 checkpoint 政策不是轉移語義。
5. **`resolve_finish` 拋 `ValueError`,cli `finish` 捕捉後印 `error: invalid finish value <v>` exit 2**——與既有 `InvalidTransition` 的 cli 錯誤處理模式(cli.py:515)一致。

## Risks / Trade-offs

- [SKILL 未同步發 `propose_done` 會卡在 propose] → 本 change 一併更新 `skills/dev-loop/SKILL.md` 步驟 4;且 `proposal-review` 在 phase=propose 時的報錯訊息已明確(既有行為)。
- [舊 checkpoint 反序列化] → `Checkpoint.load` 對缺欄位給 0 預設,測試釘住。
- [計數在 cli 判斷 → 直接呼叫 `event` CLI 發 `*_retry_exceeded` 可繞過計數] → 接受:`event` 本就是引擎的低階入口,SKILL 不會這樣用。

## Migration Plan

純新增(events、欄位、驗證),無資料遷移;merge 即生效。回滾 = revert commit。

## Open Questions

(無)

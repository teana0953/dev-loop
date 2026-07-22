# Design: flow-profile-and-uiux-thread

## Context

現行流程對所有 change 一視同仁地跑全流程;UX 只在 review 末端有 uiux leg(change meta 手動標 `needs_uiux`)。使用者定案(2026-07-22 brainstorm):流程可裁剪(固定兩檔 full/light,編排建議+人批)、UI/UX 全程考量(設計/驗收/QA/review,UI 視覺與 UX 流程都涵蓋)、needs_uiux 編排自動判+可人工改、UX 線不受裁剪。

## Goals / Non-Goals

**Goals:**
- 小 change 有輕量路徑,裁剪是誠實可審計的狀態轉移,不是假 pass。
- needs_uiux=true 時 UI/UX 考量貫穿設計→驗收→QA→review,且機械性保證不被 light 裁掉。
- 兩軸判定自動化、人批可推翻,與 `auto_approve` 語義一致。

**Non-Goals:**
- 不做逐階段 skip 開關(組合爆炸,brainstorm 已否決)。
- 不改 review legs kinds 規則、報告 schema、gate 語義(gate 恆不可裁)。
- 不做 loop 中途改軸(凍結於 start;逃生門重 propose 不重判)。

## Decisions

### D1:兩軸凍結進 checkpoint,引擎只讀 checkpoint

`start --meta <path>`(選用)載入 change meta,把 `flow_profile`(None→"full")與 `needs_uiux` 複製進 checkpoint;未帶 --meta 維持預設(full/False)。此後 qa_skip guard 與 next_hint 只讀 checkpoint——單一真理來源,loop 中途改 meta 不影響本輪(防漂移)。限制:review 逃生門回 propose 不重判兩軸;真要改 → 人工改 meta 後重 start(--force)。替代方案「引擎每次讀 meta」被否決:meta 是編排寫的檔,中途可變,拿它做 guard 依據會讓同一 loop 前後不一致。

### D2:`qa_skip` 是帶 guard 的誠實轉移

statemachine 新事件 `qa_skip`:qa→review(純函式無 guard,同其他事件)。guard 放 CLI `event` 命令:`cp.flow_profile == "light" and not cp.needs_uiux` 才放行,否則 exit 2、checkpoint 不動。理由:transition() 維持 (phase, event) 純函式;guard 需要 checkpoint 欄位,屬 CLI 層。跳過有 history 記錄(qa_skip 事件落 history.jsonl),審計誠實。替代方案「SKILL 對 qa 送假 pass」違反不假綠精神,否決。

### D3:next_hint 依兩軸分岔 qa 提示

`next_hint` 加 `flow_profile=None, needs_uiux=None` 參數:phase=qa 且 flow_profile="light" 且 needs_uiux falsy → `next: devloop event --file <f> --event qa_skip`;否則現行 qa 命令骨架。冷啟動續跑零判斷(hint 即正解)。

### D4:light 的編排裁剪(SKILL 層)

light:brainstorm 縮為短設計節直接寫入 proposal(不產獨立 design 草稿、跳過✋批准設計);✋批准提案保留(兩軸判定值在此明示供推翻);apply/gate/review/fix/finish 照常。`auto_approve=true` 時檔位建議自動視為接受(同批准關卡語義)。判定準則:docs/config/文案/微調 → light;功能或行為變更 → full;不確定 → full(保守)。

### D5:UI/UX 線(SKILL 層)+ 正本檔

needs_uiux 判定準則:change 觸及使用者可見介面或互動(UI 視覺與 UX 流程皆算)。true 時:設計文件必含「UI/UX 設計」節(視覺一致性、使用者路徑、狀態/錯誤/空狀態);OpenSpec spec 必含可驗 UI/UX 驗收 scenario(可觀察行為,拒絕「好看」類主觀句);QA prompt 併 UX 驗收檢查——**light+uiux 時 QA 保留、只驗 UX 驗收**(功能面靠 gate+review;此組合 qa_skip 被 guard 擋下,機械保證);review uiux leg 照現行。正本 `references/uiux-thread.md` 四段:設計節模板、驗收 scenario 寫法、QA UX 檢查點、needs_uiux 判定準則(同 coverage-first 前例,勿即興)。

### D6:changemeta 驗證 fail-loudly

`load_change_meta` 對 `flow_profile` 驗值域(None/full/light,typo 拋 ValueError)——與 config 的 model 驗證同精神,壞設定在 start 就炸。`needs_uiux` 沿現行寬鬆(truthy 不 coerce 問題不存在,維持 `data.get(..., False)`)。

## Risks / Trade-offs

- [light 誤判把該全流程的 change 裁了] → 批准提案關卡明示檔位可推翻;不確定→full 的保守預設;gate/review 恆在,底線不破。
- [兩軸凍結後性質變了(逃生門重 propose)] → 罕見;設計明示限制與人工路徑(改 meta 重 start --force)。
- [舊 checkpoint 無新欄位] → dataclass 預設 full/False,行為 = 現行全流程,零遷移。
- [uiux 判定漂移] → 判定準則落正本檔,批准關卡人為後盾。

## Migration Plan

單 PR:引擎(changemeta/checkpoint/statemachine/cli)+ tests → SKILL/references → README → bump 0.5.0。rollback = revert;舊版讀含新鍵的 meta/checkpoint 會忽略未知鍵,無毒。

## Open Questions

(無)

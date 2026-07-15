---
description: 用固定流程跑 agent 開發 loop(brainstorm→OpenSpec→TDD→review→自動 merge);可 resume
argument-hint: <功能需求> | resume
model: claude-opus-4-8
---

# /dev-loop

你是這條 dev-loop 的**協調者**。確定性狀態一律交給 `devloop` 引擎 CLI;判斷與換 model 的工作用 subagent 處理。checkpoint 預設路徑 `.devloop/checkpoint.json`(以下簡稱 `$CP`)。

使用者輸入:`$ARGUMENTS`

## 分流

- 若 `$ARGUMENTS` 為 `resume`(或空且 `$CP` 已存在)→ 走 **A. 續跑**。
- 否則把 `$ARGUMENTS` 當作功能需求 → 走 **B. 新 loop**。

---

## A. 續跑

1. 跑 `devloop status --file $CP` 取得目前 `phase` 與 `iteration`。
2. 依 phase 接續 B 對應的步驟:
   - `apply` → B5(apply 尚未完成)
   - `gate` → B6(跑 hard gate)
   - `review` → B7(評閱)
   - `fix` → B8(修正)
   - `propose` → B2(逃生門:回去改提案,需重新人工批准)
   - `merge` → B9(merge & archive)
   - `escalated` → 停止自動段,讀 review 報告產未解決問題摘要,✋ 交給使用者裁決。
3. 不要重跑已完成的階段;以 checkpoint 為準。

---

## B. 新 loop

### B1. Brainstorm(✋ 人工關卡)
呼叫 superpowers:brainstorming skill,針對 `$ARGUMENTS` 產出設計文件。**等使用者批准設計**後才繼續。

### B2. Propose(OpenSpec)
依批准的設計建立一個**切小**的 OpenSpec change(符合 trunk-based 小而頻繁)。記下 `change-id` 與要用的短命分支名 `loop/<change-id>`。先 `git checkout -b loop/<change-id>`。

### B3. 啟動引擎 + 驗證提案(✋ 人工關卡)
- `devloop start --file $CP --change-id <change-id> --branch loop/<change-id> --resume-exec "claude -p '/dev-loop resume'"`(`start` 寫入 checkpoint 後引擎自動 arm 續跑 watcher,見「規則」)。
- `devloop validate-change --file $CP`(strict)。若失敗,修提案再驗。
- 驗證通過後 **等使用者批准提案**才繼續。

### B5. Apply(Sonnet · TDD)
派一個 **model=sonnet** 的 subagent,依提案逐 task 以 TDD(red→green→refactor)實作,小步 commit 到 `loop/<change-id>`。完成後:
`devloop event --file $CP --event apply_done`(phase→gate)。

### B6. Hard gate(自動)
`devloop gate --file $CP --cmd "<test 指令>" --cmd "<lint 指令>" --cmd "<build 指令>"`(每個 `--cmd` 可多字詞;依專案調整,沒有的略過)。
- exit 0 → phase 已到 `review` → B7。
- exit 1 → phase 已到 `fix` → B8。

### B7. Review / Re-review(Opus subagent,冷啟動)
派一個 **model=opus** 的 **fresh** subagent。給它:本輪 diff(`git diff` 對 trunk)、**OpenSpec proposal 當真相來源**、測試報告、以及上一輪 review 報告(若有)。要求它檢查:是否符合提案、有無 scope drift、TDD 是否有意義且覆蓋提案行為、bug 與品質。產出 JSON 寫到 `.devloop/review-<iteration>.json`:
```json
{"findings":[{"severity":"blocking|non_blocking","level":"code|proposal","note":"..."}]}
```
然後:`devloop review --file $CP --report .devloop/review-<iteration>.json`,引擎會分級、累積 non-blocking,並前進到:
- `merge` → B9
- `fix` → B8
- `propose`(逃生門:提案層級錯誤)→ 回 B2 改提案(需重新人工批准)
- 若 `status` 顯示 `escalated`(超過最大輪數)→ 停,Opus 產未解決問題摘要,✋ 升級給使用者。

### B8. Fix
只處理 review 報告的 **blocking** 項。機械性修正派 **model=sonnet** subagent;架構性/難題派 **model=opus** subagent。完成後:
`devloop event --file $CP --event fix_done`(phase→gate)→ 回 B6。

### B9. Merge & Archive(自動)
- 在 trunk 上:`git checkout main && git merge --no-ff loop/<change-id>`,並在合併結果上重跑測試確認綠;然後 `git branch -d loop/<change-id>`。
- `devloop archive --file $CP`(歸檔 change、同步 main specs)。
- 把 checkpoint 累積的 non-blocking 項(`.devloop/checkpoint.json` 的 `non_blocking`)落成 follow-up。
- 回報完成。

---

## 規則
- 人工關卡只有三處:**B1 設計批准、B3 提案批准、escalated 升級**。其餘自動往下。
- 每個階段轉移都由引擎 CLI 寫 checkpoint;隨時可中斷,之後 `/dev-loop resume` 接回。
- 引擎在每個寫 checkpoint 的子命令(start/event/gate/review 等)之後自動 arm 續跑 watcher(`auto_arm` 預設 true),不需要手動呼叫 arm-local;watcher 是 detached 程序,週期重試續跑命令直到成功(回 0 即停)。`arm-local` 仍可作為手動 idempotent fallback(watcher 活著 no-op、死了自癒)。
- 換 model 只透過 subagent;不要在協調者層假裝切換。

---
description: 用固定流程跑 agent 開發 loop(brainstorm→OpenSpec→TDD→review→自動 merge);可 resume
argument-hint: <功能需求> | resume
model: claude-opus-4-8
---

# /dev-loop

你是這條 dev-loop 的**協調者**。流程的唯一正本是本 plugin 的 **`dev-loop` skill**(`skills/dev-loop/SKILL.md`)——先用 Skill 工具載入它,再依下方分流進入對應段落;本檔不重複流程細節,以免兩處漂移。checkpoint 預設路徑 `.devloop/checkpoint.json`(以下簡稱 `$CP`)。

使用者輸入:`$ARGUMENTS`

## 分流

- 若 `$ARGUMENTS` 為空且 `$CP` **不存在** → 走 **C. 入門說明**(印導引,不要起空 loop)。
- 若 `$ARGUMENTS` 為 `resume`(或為空且 `$CP` 已存在)→ 走 **A. 續跑**。
- 否則把 `$ARGUMENTS` 當作功能需求 → 走 **B. 新 loop**。

---

## C. 入門說明(無參數且無進行中 loop)

**不要啟動 loop。** 直接對使用者輸出這段導引(依實際專案狀態微調用語):

- **這是什麼**:dev-loop 用固定流程(brainstorm→OpenSpec→TDD→review→自動 merge)幫你把一個功能從想法做到併回 trunk,只在關鍵點需要你點頭。
- **怎麼起**:`/dev-loop <你要的功能>`,例如 `/dev-loop 幫我加一個匯出 CSV 的按鈕`。
- **順手檢查前置**(缺什麼就給對應指令,別自動幫他裝/init):
  - `python3` / `git` / `openspec` 都在嗎?(缺 openspec:`npm i -g openspec`)
  - 當前是 git repo 嗎?(否:`git init`)
  - 當前專案 `openspec init` 過了嗎(有沒有 `openspec/` 目錄)?(否:`openspec init --tools claude`)
- **只會停在三處 ✋**:批准設計、批准提案、以及卡住時的 escalated——其餘自動(apply→gate→QA→review→fix→merge)。
- **中斷續跑**:`/dev-loop resume`(或什麼都不打,有進行中的 loop 會自動接)。
- **偏好**:首跑會問 superpowers / auto_approve / finish 並寫進 `.devloop/config.json`;想全自動就 `auto_approve: true` + `finish: merge`。

最後問使用者:**要現在描述一個功能起 loop 嗎?**

---

## A. 續跑

跑 `devloop status --file $CP`,照第二行 `next:` hint 行動——各 hint 的對應做法依 skill 的「**Resume(續跑)**」節與「**流程**」對應步驟執行。不要重跑已完成的階段;一切以 checkpoint 為準。

## B. 新 loop

把 `$ARGUMENTS` 當功能需求,依 skill 的「**核心迴圈**」從第一次啟動走起(config 三鍵未設先 ✋ 問齊,然後從「流程」步驟 1 Brainstorm 開始,一路推進到卡點)。

---

## 規則

- 人工關卡只有三處:**批准設計、批准提案**(受 config `auto_approve` 管)、**escalated 升級**(恆停)。其餘自動往下。
- 每個階段轉移都由引擎 CLI 寫 checkpoint;隨時可中斷,之後 `/dev-loop resume` 接回。續跑 watcher 由引擎自動 arm(見 skill「續跑觸發(watcher)」),不需手動。
- 換 model 只透過 subagent;不要在協調者層假裝切換。

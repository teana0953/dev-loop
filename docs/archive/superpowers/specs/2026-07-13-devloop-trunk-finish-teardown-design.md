> **歷史設計文件(point-in-time)**:記錄該輪設計當下的決策與脈絡,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop 設計規格 — trunk-based 收尾:archive 前置 + teardown 清殘留

- **日期**:2026-07-13
- **基線**:[2026-07-02-dev-loop-v2.1-loop-native-design.md](2026-07-02-dev-loop-v2.1-loop-native-design.md)
- **產物形態**:設計文件 / 規格(spec);本份不含實作
- **切分**:一個 OpenSpec change(`trunk-finish-teardown`),一輪 dev-loop

## 1. 動機

把收尾流程對齊 trunk-based 原則(短命分支、頻繁併入、trunk 恆一致)後,發現現況兩個缺口:

1. **spec sync 相對 trunk merge 非原子**。`openspec archive` 是單一命令,一次做「delta specs 套進 `openspec/specs/` 主規格(sync)＋ 把 `changes/<id>/` 移進 archive」;`--skip-specs` 可關掉 sync 子步驟,反證 sync 是 archive 內建。SKILL 步驟 10 的 **merge 路徑**順序是 `短命分支 merge 回 trunk → 才 openspec archive`,等於 sync 落在 trunk 上、merge **之後**的另一個 commit。後果:
   - trunk 會短暫停在「delta 已合、主規格未 sync」的不一致態;
   - archive 失敗發生在 merge **之後** → trunk 已髒、半途;
   - 那個 archive commit 由誰下,SKILL 文字沒明講(隱性缺口)。
   反觀 **pr 路徑**已是 `archive → push → PR`(archive 是被合併單元的一部分),順序才對。兩條路徑不一致。

2. **loop-scoped 殘留無收尾**。既有清理只覆蓋部分:`archive_workfiles` 移工作檔、`units-cleanup` 清 unit worktree(happy path)、`openspec archive` 移 change。但下列殘留無人清(現場證據:`.devloop/changes/engine-semantics-fixes.json` 對應 change 已 archive、meta 卻仍在 `changes/`):
   - 已 merged 的**短命分支從不刪**(引擎只刪 unit 分支);
   - **watcher 程序 / `watcher.pid`**:`KEEP_FILES` 保護 pid、done 不 disarm;
   - **crash 孤兒 worktree**(`.devloop/wt`)只有 happy path 清;
   - `changes/<id>.json` meta 殘留(archive_workfiles 應移卻可能漏)。

**非目標(明確 YAGNI)**:不加 `--skip-specs` per-change 旗標。archive 一律 sync 主規格(維持 `openspec archive <id> --yes`)——這是本專案已拍板的決定,change 都視為會改規格。

## 2. 設計總覽

兩塊,無第三個變數:

- **A. archive 前置**:merge 路徑改成「**短命分支上先 archive＋commit,再原子 merge 回 trunk**」,與 pr 路徑收斂成同一套「分支上 archive＋commit → 再整合」。純 SKILL 層重排,不動引擎 archive 命令。
- **B. teardown 新 phase**:`merge` 與 `done` 之間插入 `teardown` phase 與 `devloop teardown` 引擎子命令,idempotent、resume-safe 地清 loop-scoped 殘留。

## 3. Part A — archive 前置(SKILL 步驟 10 重排)

### 3.1 merge 路徑(phase=merge、短命分支仍 checkout 著)

1. `devloop finish` → 決策 merge、寫 followup(不變)。
2. **分支上** `devloop archive` → `openspec archive <id> --yes`(= sync 主規格 ＋ 移檔)＋ 收 `.devloop` 工作檔。
3. **分支上明確 commit** openspec 檔案變動:`git add openspec/ && git commit -m "chore(<id>): archive change + sync specs"`。補掉現在的隱性 commit。
4. **原子 merge 回 trunk**:`git checkout <trunk> && git merge --no-ff <branch>`。trunk 一次拿到 實作＋archive＋synced specs。
5. `devloop event --event finish_done --finish-mode merge` → phase=`teardown`。

### 3.2 pr 路徑(已合規,只補明確 commit)

1. `devloop finish` → pr、印 follow-up 供 PR body。
2. **分支上** `devloop archive` ＋ `git add openspec/ && git commit`。
3. push 分支 → `gh pr create`。
4. `devloop event --event finish_done --finish-mode pr` → phase=`teardown`。

### 3.3 好處

- **trunk 恆一致**:merge commit 一次帶進 code＋archive＋synced specs,無中間不一致窗口。
- **原子回退**:revert 該 merge 同時退掉 spec sync。
- **失敗隔離**:archive 失敗停在分支,trunk 未動 → 乾淨升級。
- **路徑收斂**:merge / pr 都是「分支上 archive＋commit → 再整合」,SKILL 文字與心智模型統一。

## 4. Part B — teardown phase 與子命令

### 4.1 狀態機變更

`.devloop/checkpoint.json` 新增 nullable 欄位:

```jsonc
"finish_mode": null   // finish_done 時由 --finish-mode 落地;∈ {merge, pr, null}
```

缺欄位視為 `null`(向後相容)。

VALID_PHASES 於 `merge` 與 `done` 之間新增 `teardown`。新增 event 常數 `TEARDOWN_DONE = "teardown_done"`。transition 表變更:

| 現 phase | event | 原 → | 新 → | 說明 |
|---|---|---|---|---|
| `merge` | `finish_done` | `done` | **`teardown`** | 整合(merge/PR)完成後進清殘留階段;`event` 帶 `--finish-mode` 落地 `finish_mode` |
| `teardown` | `teardown_done` | — | **`done`**(新) | teardown 子命令清完殘留後自行推進至終態 |

- `_cmd_event`:`finish_done` 接受可選 `--finish-mode {merge,pr}`,寫入 `checkpoint.finish_mode`(未帶則不動,保持既有相容)。
- 其餘 transition 不變。

### 4.2 next_hint

`_DETERMINISTIC_HINTS` 新增 `teardown`,依 `checkpoint.finish_mode` 給完整命令:

```
next: python3 -m devloop.cli teardown --file <cp> --repo . --mode <merge|pr>
```

`finish_mode` 已知時直接填入 `--mode`;為 `null`(舊 checkpoint / 未落地)時給骨架 `<merge|pr>` 由 SKILL 補。

### 4.3 `devloop teardown` 子命令

簽名:`teardown --file <cp> [--repo .] --mode {merge,pr}`。**全程 idempotent**——每一步「已清就跳過、不存在不報錯」,resume 重入或重跑皆無害。清完後**自行** apply `teardown_done` → `done`(比照 `gate`/`proposal-review` 由 cli 推進 phase 的既有模式,收尾階段不留 SKILL→event 的空窗)。

清理項(依 mode):

| 項目 | merge | pr | 做法 |
|---|---|---|---|
| disarm watcher | ✅ | ✅ | pid 檔在且程序活著 → `os.kill(pid, SIGTERM)`;刪 `watcher.pid`。done 為終態,watcher 不再需要 |
| prune worktree | ✅ | ✅ | `git worktree prune`;`.devloop/wt` 尚存且無註冊 worktree → 移除(crash 孤兒兜底) |
| 確保 meta 已離開 changes/ | ✅ | ✅ | `changes/<id>.json` 仍在 → 移進 `archive/<id>/`(補 archive_workfiles 漏網;idempotent) |
| 刪短命分支 | ✅ | ❌ | merge:`git branch -d <branch>`(已 merged,safe delete)。pr:分支需活到 PR 併掉,**不刪**;最終清理在 PR merge 之後,屬 loop 職責外 |

- watcher disarm 失敗、branch 刪除失敗等**非致命**:印 stderr 警告但不阻斷 teardown(比照 archive_workfiles「不反噬」原則);唯有能重試的殘留才值得擋。
- `checkpoint.json` 本身**不刪**:done 終態記錄要可讀,且 `start` 已有「done 覆蓋放行」語義(下輪 `start` 自然蓋掉),不構成殘留。

### 4.4 SKILL 步驟 10 收尾接續

`finish_done` 進 `teardown` 後,SKILL(或冷啟動 resume 讀 `next:`)跑一次 `devloop teardown --mode <finish_mode>`,子命令清殘留並推進至 `done`。`next: (done)` 即整輪完結。

## 5. 殘留盤點對照(收尾後)

| 殘留物 | 清理者 |
|---|---|
| 報告/followup/history/watcher-log | `archive_workfiles`(archive 階段) |
| `openspec/changes/<id>/` ＋主規格 sync | `openspec archive`(分支上,merge 前) |
| unit worktree / 分支 | `units-cleanup`(apply,happy path)＋ teardown `worktree prune` 兜底 |
| **短命分支(merge 後)** | **teardown**(merge mode) |
| **watcher 程序 / `watcher.pid`** | **teardown** |
| **crash 孤兒 worktree `.devloop/wt`** | **teardown** |
| **`changes/<id>.json` meta 漏網** | **teardown**(idempotent 補收) |
| `checkpoint.json`(done) | 不清;下次 `start` 依 done 語義覆蓋 |

## 6. 測試策略

- **狀態機**(純函式):`transition('merge', i, 'finish_done')==('teardown', i)`;`transition('teardown', i, 'teardown_done')==('done', i)`;舊 `merge→done` 直達路徑移除的迴歸。
- **next_hint**:`teardown` phase 在 `finish_mode∈{merge,pr,null}` 三種下的輸出;`(done)` 終態不變。
- **event**:`finish_done --finish-mode merge/pr` 落地 `finish_mode`;不帶時保持 `null` 相容。
- **teardown 子命令**(以 fake repo / temp `.devloop`):
  - merge mode 刪 merged 分支;pr mode 保留分支。
  - watcher.pid 存/不存、程序活/死 的 disarm 分支;刪 pid 後再跑無害(idempotent)。
  - `changes/<id>.json` 存 → 移走;不存 → 靜默通過。
  - 孤兒 `.devloop/wt` 移除;無 wt 時不報錯。
  - 清完 phase == `done`;`done` 上重跑 teardown 無害。
- **相容**:缺 `finish_mode` 欄位的舊 checkpoint 讀取視為 `null`。

## 7. 不做(YAGNI)

- 不加 `--skip-specs` / `skip_specs` meta 旗標(archive 一律 sync)。
- 不把 trunk merge / PR 開立本身收進引擎:它們是 git/gh 判斷型操作,維持 SKILL orchestration;引擎只接管確定性的 teardown。
- 不刪 `checkpoint.json`(done 記錄保留,`start` 覆蓋語義已足)。
- pr 路徑不在 loop 內刪分支(PR 未併前分支不可刪)。

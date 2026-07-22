# dev-loop

[![CI](https://github.com/teana0953/dev-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/teana0953/dev-loop/actions/workflows/ci.yml)

把「用 agent 開發」的固定流程形式化成一個可重複、可中斷續跑、只在關鍵點需人工的 loop。

**流程**:brainstorm(可選 superpowers 驅動)→ ✋批准設計 → OpenSpec propose → proposal-review(自動修到乾淨)→ ✋批准提案 → apply + TDD(可平行 worktree)→ hard gate → QA gate → code ‖ UI-UX review legs → fix↺ → 依 config 收尾(merge / pr / ask)。subagent 預設全程繼承 session 模型;要省成本可用 config `model_profile: "budget"`(apply/機械 fix 改走 `sonnet`)或 `models` 逐階段指定。兩個 ✋ 批准關卡可用 `auto_approve` 關閉(escalated 安全閥恆停);token 用罄則由 detached watcher 兜底自動續跑。

## Quickstart(第一次用)

1. **裝 plugin**(在 Claude Code 裡):

   ```
   /plugin marketplace add teana0953/dev-loop
   /plugin install dev-loop@dev-loop
   ```

2. **準備專案**(每個新專案一次):

   ```bash
   cd /your/project
   git init                       # 若還不是 git repo
   openspec init --tools claude   # 初始化 OpenSpec
   ```

3. **起一條 loop**:在該專案的 Claude Code 裡打

   ```
   /dev-loop 幫我加一個 X 功能
   ```

   (什麼都不打的 `/dev-loop` 會印一段入門說明,不會亂起 loop。)

4. **只會停在三個 ✋ 人工關卡**,其餘全自動:
   - **批准設計** — brainstorm 產出設計文件,你看過點頭
   - **批准提案** — 轉成 OpenSpec change,你看過點頭
   - **escalated**(只在卡住時) — 重試耗盡或設計層問題,交你裁決

   中間 apply(TDD)→ gate → QA → review → fix 全自動;跑完依 `finish` 自動 merge 回 trunk。

5. **中斷了就續跑**:`/dev-loop resume`(或什麼都不打,有進行中的 loop 會自動接);token 用罄時 watcher 也會自動兜底續跑。

首跑會一次問你三個偏好(要不要用 superpowers、批准關卡要不要自動、收尾 merge/pr/ask),寫進 `.devloop/config.json`,之後不再問。想全自動就設 `auto_approve: true` + `finish: merge`,只在 escalated 時找你。

> 以下是完整參考(安裝細節、config、引擎 CLI)。

確定性的部分(狀態機、checkpoint、gate、review 分級、resume 排程、OpenSpec 封裝)由一個 stdlib-only 的 Python 引擎負責;判斷與換 model 的部分由 `dev-loop` skill 編排。

## 文件地圖

- **現在的行為**:[`openspec/specs/`](openspec/specs/) — living spec,隨每次 change archive 自動同步,是行為契約的唯一真理來源。
- **怎麼操作**:[`docs/runbooks/`](docs/runbooks/) — 各種續跑情境的操作步驟。
- **當初為什麼這樣設計**:[`openspec/changes/archive/`](openspec/changes/archive/)(各 change 的 design/proposal/tasks 整包)與 [`docs/archive/`](docs/archive/)(2026-07 之前的歷史設計敘事與實作計畫,point-in-time,不再更新)。

## 安裝(參考)

安裝與每專案設定的步驟見上方 Quickstart;本節只補細節。

前置:`python3`(3.10+)、`git`、`openspec`(`npm i -g openspec`)。

裝最新版讀 `main`;要 pin 特定版本用 `#tag`(release 由 CI 依 plugin.json 的 version 自動打):

    /plugin marketplace add teana0953/dev-loop#v0.2.0

本 repo 根即 marketplace,plugin 正本在 `plugins/dev-loop/`;引擎、skill、command、wrapper 皆在其下,無 build、無安裝副本。也可用本地路徑或私有 git URL 直接 `add`。

## 設定(.devloop/config.json)

可選的專案級設定(`superpowers` / `auto_approve` / `finish` 未設時會在第一次啟動 loop 問一次並寫回;續跑固定由本機 watcher 兜底):

```json
{
  "finish": "merge",
  "gate_cmds": ["python3 -m pytest -q"],
  "superpowers": true,
  "auto_approve": false
}
```

- `finish`:`merge`(自動合並回 trunk)| `pr`(開 PR 交棒給人)| `ask`(停下問人工,預設)。可被單一 change 的 `.devloop/changes/<id>.json` 的 `finish` override。
- `gate_cmds`:list,專案的 test/lint/build 命令(每項語義同 gate 的一個 `--cmd`)。設了之後 `gate` 不帶 `--cmd` 即用它,`status` 的 gate hint 也會給完整可執行命令(續跑零判斷);`--cmd` 仍可臨時 override。
- `superpowers`:布林。true 時判斷型步驟優先用 [superpowers](https://github.com/obra/superpowers) skills 驅動(brainstorming / TDD / systematic-debugging / code-review 標準;未安裝自動 fallback 內建做法);false 用內建流程。未設 → 第一次啟動時問使用者一次並寫回。
- `auto_approve`:布林,預設 false。true 時「批准設計」「批准提案」兩個人工關卡自動通過;**escalated 安全閥恆停,不受此鍵影響**。只認 JSON `true`,錯值朝「要人工」方向保守退化。未設 → 第一次啟動時問使用者一次並寫回。
- `auto_arm`:布林,預設 true。引擎在每個寫 checkpoint 的子命令之後自動確保 watcher 在位;設 false 關閉此自動行為(手動 `arm-local` 不受影響),一般不需要動這個鍵。
- `model_profile`:`"quality"`(預設,未設同此)| `"budget"`。quality = 所有 subagent 繼承 session 模型(品質最優);budget = 省成本檔位——apply(TDD)與機械性 fix 改用 `sonnet`,把關步驟(brainstorm/review/架構性 fix)仍留在 session 模型,且 review 自動改用 coverage-first 加重審查當護欄。取捨:執行段品質換 output token 成本。有安全預設,首次啟動不會問。
- `models`:dict,逐階段 model override(優先於 `model_profile`),如 `{"apply": "haiku"}`。鍵限 `brainstorm`/`apply`/`review`/`fix`,值限 alias(`sonnet`/`opus`/`haiku`/`fable`),**不收完整 model id**——alias 跟著 Claude Code 換代,config 免維護;非法鍵值啟動時直接報錯。想確認某階段實際會用哪個 model:`devloop model --stage apply`(印 alias 或 `inherit`)。

checkpoint 落在各專案的 `.devloop/`,狀態彼此獨立。人工關卡有哪些、以及 `auto_approve: true` + `finish: merge` 的全自動組合,見 Quickstart 第 4 點與其後說明。

## 引擎 CLI

手動驅動:

```bash
# plugin 情境(任意目錄;wrapper 自我定位、免設 PYTHONPATH)
devloop <子命令> --file .devloop/checkpoint.json [...]

# repo 內開發時
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli <子命令> --file .devloop/checkpoint.json [...]
```

| 子命令 | 作用 |
|---|---|
| `start --change-id <id> --branch <b> [--resume-exec "<cmd>"] [--force]` | 建立 checkpoint(phase=apply);存續跑命令。既有 checkpoint 非 done → 拒絕(exit 2,防丟進行中的 loop),`--force` 明確覆蓋 |
| `status [--json]` | 印 `phase / iteration / change_id / branch`;第二行 `next: ` 給下一步命令骨架或說明(冷啟動續跑照這行動);第三行 `updated_at=` 判斷 loop 是否停滯。`--json` 輸出完整 checkpoint(含 `next`)供程式化消費 |
| `event --event <e> [--max N]` | 套用狀態轉移 |
| `gate [--cmd "<cmd>" ...] [--timeout N]` | 依序跑命令(無 `--cmd` 時用 config 的 `gate_cmds`;皆無 → exit 2,不假綠);全綠→qa(exit 0),失敗→fix(exit 1),連續失敗超過 `--max-gate`→escalated(exit 3);失敗分支末行印 `phase=` |
| `review --report <json>` | 依 review 報告分級並前進(merge/fix/propose) |
| `validate-change` | `openspec validate <change> --strict` |
| `archive` | `openspec archive <change> --yes`;成功後把該 change 的工作檔(報告/followup/history/watcher log + `changes/<id>.json`)收進 `.devloop/archive/<change-id>/`(checkpoint 留快照) |
| `arm-local [--exec "<cmd>"] [--heartbeat N]` | 手動確保有且僅一個 detached watcher(idempotent);一般不需要——引擎在每個寫 checkpoint 的子命令後已自動做同一件事 |
| `watcher-status` | watcher 排障一眼看:行程狀態(running/dead/not armed)、`resume_exec`、最近一次嘗試(讀 `watcher-log.jsonl`);該在而不在 → exit 1 + arm-local 提示 |
| `units-init --repo <r> --meta <json> --wt-root <d>` | 依平行群建 worktree + 寫 units |
| `unit-done --id <gid>` | 標記平行單元完成 |
| `unit-claim --id <gid>` | 標記平行單元 in_progress |
| `unit-resolve --repo <r> --id <gid>` | 衝突 unit 退串行收尾(標 merged + 清 worktree) |
| `units-merge --repo <r>` | 依序合並 unit 分支;衝突標記退串行 |
| `units-cleanup --repo <r>` | 移除 merged + 孤兒 worktree |
| `units-status` | 印各單元狀態 + pending 清單(續跑用) |
| `proposal-review --report <json>` | 提案 review 分級(clean→apply / proposal→propose / design→escalated) |
| `qa --report <json>` | QA 行為驗證分級(pass→review / blocking→fix) |
| `legs-init --kinds code,uiux` | 初始化唯讀型平行 review legs |
| `leg-done --kind <k> --report <p>` | 回收某 leg 報告 |
| `review --from-legs` | 彙總所有 collected legs 報告後分級 |
| `finish --config <c> --meta <m> --followup <f>` | 依 config/meta 決策 merge\|pr\|ask + 落 follow-up |

review 報告格式:
```json
{"findings": [{"severity": "blocking|non_blocking", "level": "code|proposal", "note": "..."}]}
```

報告經 strict schema 驗證(缺 `findings`、非 list、severity 非法 → exit 2 報錯,不會被當成空報告放行);空 `findings` 才是合法的 pass。

通過條件:測試全綠 **且** review 無 blocking;超過最大輪數(預設 3)→ escalated 停下升級。各上限(`--max` / `--max-propose` / `--max-gate`)的 N 皆為**容許次數**:允許 N 次,第 N+1 次才升級。

每次狀態轉移都追加一行到 checkpoint 同目錄的 `history.jsonl`(`ts / event / from / to / iteration`,append-only),供事後排障與耗時分析。

## Token 用罄續跑

關鍵是**引擎自動兜底**,不需要手動部署:每個會寫 checkpoint 的子命令(start / event / gate / proposal-review / qa / leg-done / review / units-*)存檔後都會自動確保 watcher 在位(前提是 checkpoint 有 `resume_exec` 且 config `auto_arm` 未關閉)。`start` 以 `--resume-exec` 把續跑命令寫進 checkpoint,之後全程自動接手。

續跑機制固定為 detached watcher:OS 程序(不依賴被卡住的 agent)反覆執行續跑命令,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s、上限 3600s)再試。每次嘗試都記到 checkpoint 同目錄的 `watcher-log.jsonl`(時間、exit code、輸出尾巴);`watcher-status` 一眼看行程狀態與最近嘗試,`status` 在 watcher 該在而不在時也會 stderr 示警。

需要手動介入時(例如換一條續跑命令、或懷疑 watcher 掛了)才用 `arm-local`,idempotent——watcher 活著 no-op、死了自癒重生:

```bash
devloop arm-local --file /your/project/.devloop/checkpoint.json
```

> 各種續跑情境(token 用罄、主動接回、平行 units、escalated、watcher 排障)的操作步驟見 [docs/runbooks/resume.md](docs/runbooks/resume.md)。

## 開發本工具

引擎(`plugins/dev-loop/devloop/`)與編排 skill(`plugins/dev-loop/skills/dev-loop/SKILL.md`)都在 `plugins/dev-loop/` 下,無 build、無安裝副本。

```bash
make test       # 全套測試(= python3 -m pytest -q;stdlib-only + pytest)
```

需求:Python 3.10+、`openspec` CLI、`pytest`(僅測試用)。lint 用 `ruff check plugins/dev-loop/devloop tests`(CI 亦跑)。

**CI/CD**(`.github/workflows/`):`ci.yml` 在 push/PR 跑 ruff lint + pytest(Python 3.10 / 3.12 / 3.13 矩陣);`release.yml` 在 `plugins/dev-loop/.claude-plugin/plugin.json` 的 `version` bump 進 `main` 時,自動打 tag `vX.Y.Z` + 建 GitHub Release(冪等)。**發版 = 改 plugin.json 的 version 並推 main。**

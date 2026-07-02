# dev-loop

把「用 agent 開發」的固定流程形式化成一個可重複、可中斷續跑、只在關鍵點需人工的 loop。

**流程**:`/brainstorming`(Opus)→ OpenSpec propose → proposal-review(Opus,自動修到乾淨)→ ✋批准提案 → apply + TDD(Sonnet,可平行 worktree)→ hard gate → QA gate → code ‖ UI-UX review legs → fix↺ → 依 config 收尾(merge / pr / ask);token 用罄則在配額 reset 時間點自動續跑。

> 設計與三份實作計畫見 `docs/superpowers/specs/2026-06-30-dev-loop-v2-design.md` 與 `docs/superpowers/plans/2026-06-30-dev-loop-v2-*.md`。

確定性的部分(狀態機、checkpoint、gate、review 分級、resume 排程、OpenSpec 封裝)由一個 stdlib-only 的 Python 引擎負責;判斷與換 model 的部分由 `dev-loop` skill 編排。

- 設計規格:[docs/superpowers/specs/2026-06-18-dev-loop-design.md](docs/superpowers/specs/2026-06-18-dev-loop-design.md)
- 實作計畫:[docs/superpowers/plans/2026-06-18-dev-loop-engine.md](docs/superpowers/plans/2026-06-18-dev-loop-engine.md)

## 在任何專案使用(全域 skill)

`dev-loop` 已安裝成使用者層級 skill(`~/.claude/skills/dev-loop/`),引擎內嵌、零安裝。

**每個新專案一次性設定:**

```bash
cd /your/project
git init                       # 若還不是 git repo(trunk-based)
openspec init --tools claude   # 初始化 OpenSpec
```

可選:在 `.devloop/config.json` 設定收尾策略與續跑觸發器(未設則收尾停下問人工、觸發器用本機 watcher):

```json
{ "trigger": "local", "finish": "merge" }
```

- `finish`:`merge`(自動合並回 trunk)| `pr`(開 PR 交棒給人)| `ask`(停下問人工,預設)。可被單一 change 的 `.devloop/changes/<id>.json` 的 `finish` override。
- `trigger`:`local`(預設,只靠 detached watcher)| `harness`(watcher 兜底 + `/loop` 續跑正職,見「Token 用罄續跑」)。
- `auto_arm`:布林,預設 true。引擎在每個寫 checkpoint 的子命令之後自動確保 watcher 在位;設 false 關閉此自動行為(手動 `arm-local` 不受影響),一般不需要動這個鍵。

**之後**在該專案的 Claude Code session 直接呼叫 skill:

> 「用 dev-loop 幫我做 X 功能」 / 「dev-loop resume」(續跑)

Claude 會依流程跑:brainstorm ✋ → propose → proposal-review(自動修到乾淨)✋ → apply+TDD(可平行)→ hard gate → QA → review(code‖UI-UX legs)→ fix↺ → 依 `finish` 收尾(merge / pr / ask)。checkpoint 落在該專案的 `.devloop/`,各專案狀態獨立。

**人工關卡**:批准設計、批准提案(proposal-review 判定 clean 後)、超過最大輪數時的升級;若 `finish` 未設或為 `ask`,收尾時多一處選 merge/pr。其餘自動。

## 引擎 CLI

手動驅動(任意目錄;wrapper 自我定位、免設 PYTHONPATH):

```bash
~/.claude/skills/dev-loop/devloop <子命令> --file .devloop/checkpoint.json [...]
```

| 子命令 | 作用 |
|---|---|
| `start --change-id <id> --branch <b> [--resume-exec "<cmd>"]` | 建立 checkpoint(phase=apply);存續跑命令 |
| `status` | 印 `phase / iteration / change_id / branch`;第二行 `next: ` 給下一步命令骨架或說明(冷啟動續跑照這行動) |
| `event --event <e> [--max N]` | 套用狀態轉移 |
| `gate --cmd "<cmd>" [...] [--timeout N]` | 依序跑命令;全綠→review,失敗→fix |
| `review --report <json>` | 依 review 報告分級並前進(merge/fix/propose) |
| `validate-change` | `openspec validate <change> --strict` |
| `archive` | `openspec archive <change> --yes` |
| `arm-local [--exec "<cmd>"] [--heartbeat N]` | 手動確保有且僅一個 detached watcher(idempotent);一般不需要——引擎在每個寫 checkpoint 的子命令後已自動做同一件事 |
| `resume [--reset-at <ISO>]` | 回報 ready / sleep_seconds / phase |
| `auto-resume --reset-at <ISO> --exec "<cmd>"` | 本機等到 reset 後執行續跑命令(進階:精準睡) |
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

通過條件:測試全綠 **且** review 無 blocking;超過最大輪數(預設 3)→ escalated 停下升級。

## Token 用罄續跑

關鍵是**引擎自動兜底**,不需要手動部署:每個會寫 checkpoint 的子命令(start / event / gate / proposal-review / qa / leg-done / review / units-*)存檔後都會自動確保 watcher 在位(前提是 checkpoint 有 `resume_exec` 且 config `auto_arm` 未關閉)。`start` 以 `--resume-exec` 把續跑命令寫進 checkpoint,之後全程自動接手。

`trigger` 決定續跑機制的組成:

| `trigger` | 續跑機制 |
|---|---|
| `local`(預設) | 只有 watcher:detached OS 程序(不依賴被卡住的 agent)反覆執行續跑命令,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s、上限 3600s)再試。 |
| `harness` | watcher 兜底(引擎仍自動 arm)+ `/loop` 是續跑正職:harness 原生排程精準觸發下一輪,watcher 只在排程失效時墊底。 |

需要手動介入時(例如換一條續跑命令、或懷疑 watcher 掛了)才用 `arm-local`,idempotent——watcher 活著 no-op、死了自癒重生:

```bash
~/.claude/skills/dev-loop/devloop arm-local \
  --file /your/project/.devloop/checkpoint.json
```

> 進階(已知 reset 時間想精準睡):`auto-resume --reset-at <ISO> --exec "<cmd>"` 睡到 T 再跑。雲端替代:`trigger=harness` 搭配 cron / `/schedule`,並每階段 push 分支 + checkpoint。

## 開發本工具

本 repo 是引擎(`devloop/`)與編排 skill(`skills/dev-loop/SKILL.md`)的原始碼家;`~/.claude/skills/dev-loop/` 是安裝副本。

```bash
python3 -m pytest -q        # 全套測試(stdlib-only + pytest)
```

改完後,同步到全域 skill(引擎 + SKILL):

```bash
cp devloop/*.py        ~/.claude/skills/dev-loop/engine/devloop/   # 引擎
cp skills/dev-loop/SKILL.md ~/.claude/skills/dev-loop/SKILL.md     # 編排 skill
```

> 編排流程的權威來源是 repo 的 `skills/dev-loop/SKILL.md`;改流程請改它再同步,別只改安裝副本。

需求:Python 3.9+、`openspec` CLI、`pytest`(僅測試用)。

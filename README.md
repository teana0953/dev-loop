# dev-loop

把「用 agent 開發」的固定流程形式化成一個可重複、可中斷續跑、只在關鍵點需人工的 loop。

**流程**:`/brainstorming`(Opus)→ OpenSpec propose → apply + TDD(Sonnet)→ hard gate → Opus subagent review / re-review → 自動 merge 回 trunk;token 用罄則在配額 reset 時間點自動續跑。

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

**之後**在該專案的 Claude Code session 直接呼叫 skill:

> 「用 dev-loop 幫我做 X 功能」 / 「dev-loop resume」(續跑)

Claude 會依流程跑:brainstorm ✋ → OpenSpec propose → validate ✋ → apply+TDD → gate → review → 自動 merge + archive。checkpoint 落在該專案的 `.devloop/`,各專案狀態獨立。

**人工關卡只有三處**:批准設計、批准提案、超過最大輪數時的升級。其餘自動。

## 引擎 CLI

手動驅動(任意目錄;wrapper 自我定位、免設 PYTHONPATH):

```bash
~/.claude/skills/dev-loop/devloop <子命令> --file .devloop/checkpoint.json [...]
```

| 子命令 | 作用 |
|---|---|
| `start --change-id <id> --branch <b> [--resume-exec "<cmd>"]` | 建立 checkpoint(phase=apply);存續跑命令 |
| `status` | 印 `phase / iteration / change_id / branch` |
| `event --event <e> [--max N]` | 套用狀態轉移 |
| `gate --cmd "<cmd>" [...] [--timeout N]` | 依序跑命令;全綠→review,失敗→fix |
| `review --report <json>` | 依 review 報告分級並前進(merge/fix/propose) |
| `validate-change` | `openspec validate <change> --strict` |
| `archive` | `openspec archive <change> --yes` |
| `arm-local [--exec "<cmd>"] [--heartbeat N]` | 確保有且僅一個 detached watcher(idempotent) |
| `resume [--reset-at <ISO>]` | 回報 ready / sleep_seconds / phase |
| `auto-resume --reset-at <ISO> --exec "<cmd>"` | 本機等到 reset 後執行續跑命令(進階:精準睡) |
| `units-init --repo <r> --meta <json> --wt-root <d>` | 依平行群建 worktree + 寫 units |
| `unit-done --id <gid>` | 標記平行單元完成 |
| `units-merge --repo <r>` | 依序合並 unit 分支;衝突標記退串行 |
| `units-cleanup --repo <r>` | 移除 merged + 孤兒 worktree |
| `units-status` | 印各單元狀態 + pending 清單(續跑用) |

review 報告格式:
```json
{"findings": [{"severity": "blocking|non_blocking", "level": "code|proposal", "note": "..."}]}
```

通過條件:測試全綠 **且** review 無 blocking;超過最大輪數(預設 3)→ escalated 停下升級。

## Token 用罄續跑

關鍵是**事前部署**:每個會寫 checkpoint 的點(start/event/gate/review)之後都 `arm-local`,確保 token 用罄前觸發器已就位。`start` 以 `--resume-exec` 把續跑命令寫進 checkpoint,arm-local spawn 的 detached watcher 便能自包讀取。

```bash
~/.claude/skills/dev-loop/devloop arm-local \
  --file /your/project/.devloop/checkpoint.json
```

watcher 是獨立 OS 程序(不依賴被卡住的 agent):反覆執行續跑命令,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s、上限 3600s)再試。arm-local idempotent——watcher 活著 no-op、死了自癒重生。被推進的 agent 在其首個 checkpoint 再次 arm,心跳自我延續。

> 進階(已知 reset 時間想精準睡):`auto-resume --reset-at <ISO> --exec "<cmd>"` 睡到 T 再跑。雲端替代:`trigger=harness` 搭配 cron / `/schedule`,並每階段 push 分支 + checkpoint。

## 開發本工具

本 repo 是引擎的原始碼家。

```bash
python3 -m pytest -q        # 全套測試(stdlib-only + pytest)
```

改完引擎後,同步到全域 skill:

```bash
cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/
```

需求:Python 3.9+、`openspec` CLI、`pytest`(僅測試用)。

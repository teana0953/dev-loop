# Runbook:dev-loop 續跑

一個 dev-loop 被中斷(token/配額用罄、手動停下、機器重啟)之後,怎麼把它接回去繼續跑。

## 名詞與命令基線

- **checkpoint**:loop 的全部狀態(phase / iteration / 計數器 / `resume_exec` / units / review legs)。預設路徑 `.devloop/checkpoint.json`(以下記為 `$CP`)。
- **watcher**:引擎自動部署的 detached OS 程序,token 用罄後週期重試續跑命令,不依賴被卡住的 agent。pid 記在 checkpoint 同目錄的 `.devloop/watcher.pid`。
- **續跑命令(`resume_exec`)**:`start` 時以 `--resume-exec` 寫進 checkpoint,通常是 `claude -p '/dev-loop resume'`。是自動續跑的起點。

引擎 CLI 有兩種等價寫法,本 runbook 用第一種(免設 `PYTHONPATH`,任意目錄可跑):

```bash
# 全域 wrapper(自我定位)
~/.claude/skills/dev-loop/devloop <子命令> --file $CP

# 在本 repo 開發時等價於
python3 -m devloop.cli <子命令> --file $CP
```

## 先看一眼:目前卡在哪

```bash
~/.claude/skills/dev-loop/devloop status --file .devloop/checkpoint.json
```

- 第一行:`phase / iteration / change_id / branch`。
- 第二行 `next:`:下一步命令骨架或說明。**冷啟動續跑照這行動即可**,不用記哪個 phase 對應哪個命令。

`next:` 的四種形態:

| `next:` 第二行 | 意思 | 動作 |
|---|---|---|
| 完整命令骨架(如 `next: … gate --cmd "<test>"`) | 確定型步驟 | 補上實際參數執行 |
| `next: dispatch <說明>` | 判斷型步驟(apply/fix/propose) | 依流程 dispatch 對應 subagent |
| `next: (done)` | loop 已完成 | 無需動作 |
| `next: (escalated) …` | 卡在人工升級 | 見 [場景 D](#場景-d卡在-escalated人工升級) |

> 若有 units 未完成或 review legs 未收齊,`next:` 會優先提示該未完成項(如 `units-status`)。

---

## 場景 A:token / 配額用罄,loop 停在半路

**多數情況下你什麼都不用做。** 引擎在每個寫 checkpoint 的子命令之後已自動 arm 一個 watcher(前提:checkpoint 有 `resume_exec` 且 config `auto_arm` 未關)。配額恢復後,watcher 反覆執行續跑命令,回 0(loop 已推進)即停,否則睡一個 heartbeat(預設 1800s、上限 3600s)再試。

**想確認 watcher 真的在位:**

```bash
~/.claude/skills/dev-loop/devloop watcher-status --file .devloop/checkpoint.json
```

一次印出行程狀態(`running` / `dead` / `not armed`)、續跑命令、與最近一次嘗試(時間、exit code、輸出尾巴,讀自 `.devloop/watcher-log.jsonl`):

- `watcher: running` 且 exit 0 → 續跑已就位,等配額恢復即可。
- `watcher: dead` / `not armed` 且 exit 1(附 `hint:`)→ 見 [場景 E](#場景-ewatcher-掛了--要換續跑命令--沒自動-arm)。
- 想看 watcher 每次重試的完整歷史:`cat .devloop/watcher-log.jsonl`。

(`status` 也會在 watcher 該在而不在時于 stderr 印 `warning: watcher not running`,平時看 status 就能發現。)

---

## 場景 B:想主動接回(不等 watcher)

在**該專案的 Claude Code session** 直接說:

> dev-loop resume

(等價於 slash command `/dev-loop resume`。)協調者會跑一次 `status`,照第二行 `next:` 從 checkpoint 記錄的 phase 接著跑,不會重跑已完成的階段。

若你想手動驅動引擎(不透過 agent),就照上面「先看一眼」的 `next:` 骨架逐步執行。phase → 步驟對照:

| phase | 接續 |
|---|---|
| `apply` | apply 尚未完成,繼續 TDD 實作 |
| `gate` | 跑 hard gate |
| `review` | 評閱(code ‖ UI-UX legs) |
| `fix` | 修正 review findings |
| `propose` | 逃生門:回去改提案(需重新人工批准) |
| `merge` | merge & archive |
| `escalated` | 見場景 D |

---

## 場景 C:平行 units 沒跑完

```bash
~/.claude/skills/dev-loop/devloop units-status --file .devloop/checkpoint.json
```

看 `pending:` 清單,**只對 pending 的 unit 重新 dispatch subagent**,已 done/merged 的不要重跑。全部完成後再照 `next:` 進到 units-merge / 收尾。

---

## 場景 D:卡在 escalated(人工升級)

`status` 顯示 `escalated` 代表超過最大輪數(propose 或 gate 重試用盡),自動段已停、等你裁決。處理完根因後,依情境選一個人工續跑出口——套用後 `iteration` / `propose_attempts` / `gate_failures` 三個計數全部歸零,重新起算:

```bash
# 修正設計方向 / 重新規劃提案內容後,回 propose 重跑
~/.claude/skills/dev-loop/devloop event --file .devloop/checkpoint.json --event human_resume_propose

# 手動排除卡住 gate 的根因後,直接回 fix 修
~/.claude/skills/dev-loop/devloop event --file .devloop/checkpoint.json --event human_resume_fix
```

之後回場景 B 續跑即可。

---

## 場景 E:watcher 掛了 / 要換續跑命令 / 沒自動 arm

用 `arm-local` 手動兜底,idempotent——watcher 活著 no-op、死了自癒重生:

```bash
~/.claude/skills/dev-loop/devloop arm-local --file .devloop/checkpoint.json
```

換一條續跑命令時加 `--exec`:

```bash
~/.claude/skills/dev-loop/devloop arm-local \
  --file .devloop/checkpoint.json \
  --exec "claude -p '/dev-loop resume'"
```

**若 `arm-local` 報 `no resume command`**:checkpoint 的 `resume_exec` 是空的(通常是 `start` 時沒帶 `--resume-exec`)。要嘛用上面的 `--exec` 明確給一條,要嘛就走場景 B 手動接回。

**若怎麼都不自動 arm**:檢查 `.devloop/config.json` 是否設了 `"auto_arm": false`——關掉時所有子命令都不自動 arm(但手動 `arm-local` 不受影響)。

---

## 命令速查

| 目的 | 命令 |
|---|---|
| 看目前 phase / 下一步 | `devloop status --file $CP` |
| 主動接回 | 在專案 session 說「dev-loop resume」 |
| 確認 watcher 在位 / 排障 | `devloop watcher-status --file $CP` |
| watcher 重試完整歷史 | `cat $CP_DIR/watcher-log.jsonl` |
| 手動確保 watcher | `devloop arm-local --file $CP [--exec "<cmd>"]` |
| 平行 units 進度 | `devloop units-status --file $CP` |
| escalated 續跑(重提案) | `devloop event --file $CP --event human_resume_propose` |
| escalated 續跑(直接修) | `devloop event --file $CP --event human_resume_fix` |

> `devloop` = `~/.claude/skills/dev-loop/devloop`;`$CP` = `.devloop/checkpoint.json`;`$CP_DIR` = `.devloop`。

## 已經沒有的東西

下列在移除「token 用罄自動接上第二層」後**已不存在**,舊筆記若提到請忽略:

- `resume` / `auto-resume` 子命令、`plan_resume`(「已知 reset 時間精準睡」路徑)。
- config 的 `trigger` 鍵(`local` / `harness` 之分)。舊 config 若還留著 `"trigger"` 會被靜默忽略。
- SKILL 由 agent 用 `ScheduleWakeup` 自排下一輪的行為。

現在自動續跑**只**靠 detached watcher 一種機制。

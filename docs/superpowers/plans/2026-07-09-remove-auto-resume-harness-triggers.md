# 移除 harness 自排 + 精準睡續跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除「token 用罄」續跑的第二層機制(harness `ScheduleWakeup` 自排 + `resume`/`auto-resume`/`plan_resume` 精準睡 + `trigger` config),只保留引擎 detached watcher 作為唯一自動續跑手段;手動續跑(`dev-loop resume`、`status next:` hint、`human_resume_*`)不受影響。

**Architecture:** 純刪除 + 精簡。引擎分三塊拆解:先斷開 `cli.py` 對將被刪函式的引用,再刪 `resume.py` / `adapter.run_adapter`,最後清 `config.trigger`。每個任務結束時全套 `pytest` 必須綠(中間狀態不得留下壞 import)。之後同步更新 README / SKILL / OpenSpec spec,並同步安裝副本。

**Tech Stack:** Python 3.9+(stdlib-only)、pytest、OpenSpec CLI。

## Global Constraints

- stdlib-only,不得引入第三方依賴。
- 每個引擎任務結束時 `python3 -m pytest -q` 必須全綠。
- **保留不動**:`run_watcher`、`DEFAULT_HEARTBEAT`、`arm-local`/`watch` 子命令、`ensure_armed`/`_spawn_watcher`/`_ensure_armed_after_save`、`--resume-exec`、checkpoint 的 `resume_exec`、`config.auto_arm`/`config.finish`、`human_resume_propose`/`human_resume_fix` 事件、`status` 的 `next:` hint。
- `config.py` 刪 `trigger` 後,舊 `config.json` 若含 `"trigger"` 鍵一律**靜默忽略**(不報錯、不警告)。
- 設計來源:`docs/superpowers/specs/2026-07-09-remove-auto-resume-harness-triggers-design.md`。

---

### Task 1: cli 移除 `resume` / `auto-resume` 子命令(先斷開對 run_adapter / plan_resume 的引用)

**Files:**
- Modify: `devloop/cli.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: 無(純刪除)。
- Produces: 移除後 `cli.py` 不再 import `run_adapter`、`plan_resume`,不再定義 `_cmd_resume` / `_cmd_auto_resume`,`build_parser` 不再註冊 `resume` / `auto-resume` 兩個子命令。`adapter.run_adapter` 與 `resume.py` 此任務尚不刪(下一任務刪),故仍可 import,測試保持綠。

- [ ] **Step 1: 刪除 `tests/test_cli.py` 中四個測試函式**

刪除以下四個函式(整段,含裝飾器與函式體):
- `test_resume_ready_when_no_reset_at`(以 `main(["resume", "--file", str(f)])` 呼叫)
- `test_resume_not_ready_when_reset_in_future`(以 `main(["resume", ..., "--reset-at", future])` 呼叫)
- `test_auto_resume_subcommand`
- `test_auto_resume_propagates_exit_code`

- [ ] **Step 2: 清理 `tests/test_cli.py` 因刪測試而孤立的 import**

執行:`grep -nE "\bdatetime\b|\btimedelta\b|\btimezone\b" tests/test_cli.py`
- 若除了 `from datetime import timezone, datetime, timedelta` 那一行外**再無其他命中**,刪除該 import 行。
- 若仍有其他測試使用,保留。
`import json`(緊鄰其後那行)同理:`grep -nE "\bjson\b" tests/test_cli.py`,僅剩 import 行才刪。

- [ ] **Step 3: 修改 `devloop/cli.py` import 區**

把第 11 行:
```python
from devloop.adapter import DEFAULT_HEARTBEAT, run_adapter, run_watcher
```
改為:
```python
from devloop.adapter import DEFAULT_HEARTBEAT, run_watcher
```
刪除第 18 行:
```python
from devloop.resume import plan_resume
```
刪除第 8 行(`datetime`/`timezone` 刪 `_cmd_resume`/`_cmd_auto_resume` 後不再被用;`gate` 用的是 `shlex`,不受影響):
```python
from datetime import datetime, timezone
```

- [ ] **Step 4: 刪除 `devloop/cli.py` 的 `_cmd_resume` 與 `_cmd_auto_resume`**

刪除 `_cmd_resume`(函式體為 `plan_resume(cp.phase, now, reset_at)` 並印 `ready=... sleep_seconds=... phase=...`)整段函式。
刪除 `_cmd_auto_resume`(函式體為 `return run_adapter(args.file, reset_at, shlex.split(args.exec))`)整段函式。

- [ ] **Step 5: 刪除 `devloop/cli.py` `build_parser` 中兩個 parser 註冊**

刪除 `p_resume` 區塊:
```python
    p_resume = sub.add_parser("resume")
    p_resume.add_argument("--file", required=True)
    p_resume.add_argument("--reset-at", dest="reset_at", default=None)
    p_resume.set_defaults(func=_cmd_resume)
```
刪除 `p_auto` 區塊:
```python
    p_auto = sub.add_parser("auto-resume")
    p_auto.add_argument("--file", required=True)
    p_auto.add_argument("--reset-at", dest="reset_at", required=True)
    p_auto.add_argument("--exec", dest="exec", required=True)
    p_auto.set_defaults(func=_cmd_auto_resume)
```

- [ ] **Step 6: 跑全套測試確認綠**

Run: `python3 -m pytest -q`
Expected: PASS(全綠;`test_adapter.py` 的 `run_adapter` 測試此刻仍在、仍綠,因為 `adapter.run_adapter` 尚未刪)。

- [ ] **Step 7: 驗證 `resume`/`auto-resume` 子命令已消失**

Run: `python3 -m devloop.cli resume --file /tmp/x.json 2>&1 | head -1`
Expected: argparse 報 `invalid choice: 'resume'`(子命令已移除)。

- [ ] **Step 8: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "$(cat <<'EOF'
refactor(cli): 移除 resume / auto-resume 子命令(精準睡續跑)

斷開對 plan_resume / run_adapter 的引用;手動 resume 與 watcher 不受影響。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 2: 移除精準睡引擎(`resume.py` 全刪 + `adapter.run_adapter`),`MAX_SLEEP_SECONDS` 搬進 adapter

**Files:**
- Delete: `devloop/resume.py`
- Modify: `devloop/adapter.py`
- Delete: `tests/test_resume.py`
- Modify: `tests/test_adapter.py`

**Interfaces:**
- Consumes: 前一任務已確保 `cli.py` 不再引用 `run_adapter` / `plan_resume`。
- Produces: `devloop/adapter.py` 自帶 `MAX_SLEEP_SECONDS = 3600` 常量;對外只提供 `run_watcher`、`DEFAULT_HEARTBEAT`、`MAX_SLEEP_SECONDS`。`devloop/resume.py` 不再存在。

- [ ] **Step 1: 用新內容整檔覆寫 `devloop/adapter.py`**

```python
from __future__ import annotations

import subprocess
import time

DEFAULT_HEARTBEAT = 1800  # 兩次重試間預設間隔(秒)
MAX_SLEEP_SECONDS = 3600  # 單次睡眠上限(harness wakeup 上限)


def _default_run(cmd):
    return subprocess.run(cmd).returncode


def run_watcher(
    exec_command,
    heartbeat=DEFAULT_HEARTBEAT,
    sleep_fn=None,
    run_fn=None,
):
    """無 reset 時間 · 週期重試的續跑 watcher(resume-trigger 規格)。

    反覆執行 exec_command:回傳 0 即視為 loop 已被重新推進,停止並回傳 0;
    回傳非 0 視為仍被限流,睡一個 heartbeat 後重試。heartbeat 夾到
    MAX_SLEEP_SECONDS(harness wakeup 上限)。

    sleep_fn / run_fn 可注入以便測試。
    """
    sleep_fn = sleep_fn or time.sleep
    run_fn = run_fn or _default_run
    interval = min(heartbeat, MAX_SLEEP_SECONDS)
    while True:
        code = run_fn(exec_command)
        if code == 0:
            return 0
        sleep_fn(interval)
```

- [ ] **Step 2: 刪除 `devloop/resume.py`**

Run: `git rm devloop/resume.py`

- [ ] **Step 3: 用新內容整檔覆寫 `tests/test_adapter.py`(保留 watcher 測試,import 改從 adapter)**

```python
from devloop.adapter import MAX_SLEEP_SECONDS, run_watcher


def test_watcher_returns_immediately_on_first_success():
    slept = []
    runs = []
    code = run_watcher(
        exec_command=["echo", "hi"],
        run_fn=lambda cmd: runs.append(cmd) or 0,
        sleep_fn=slept.append,
    )
    assert code == 0
    assert runs == [["echo", "hi"]]
    assert slept == []


def test_watcher_retries_until_success():
    # 前兩次回非 0,第三次回 0 → 睡兩次(預設 heartbeat 1800)後返回
    codes = iter([1, 1, 0])
    slept = []
    code = run_watcher(
        exec_command=["x"],
        run_fn=lambda cmd: next(codes),
        sleep_fn=slept.append,
    )
    assert code == 0
    assert slept == [1800, 1800]


def test_watcher_clamps_heartbeat_to_max():
    codes = iter([1, 0])
    slept = []
    run_watcher(
        exec_command=["x"],
        heartbeat=9999,
        run_fn=lambda cmd: next(codes),
        sleep_fn=slept.append,
    )
    assert slept == [MAX_SLEEP_SECONDS]
```

- [ ] **Step 4: 刪除 `tests/test_resume.py`**

Run: `git rm tests/test_resume.py`

- [ ] **Step 5: 跑全套測試確認綠**

Run: `python3 -m pytest -q`
Expected: PASS(全綠;`test_resume.py`、`test_adapter.py` 的三個 `run_adapter` 測試已不存在)。

- [ ] **Step 6: 驗證引擎無殘留引用**

Run: `grep -rnE "plan_resume|run_adapter|ResumeAction|from devloop.resume" devloop/ tests/`
Expected: 無任何命中(exit 1)。

- [ ] **Step 7: Commit**

```bash
git add devloop/adapter.py tests/test_adapter.py
git commit -m "$(cat <<'EOF'
refactor(adapter): 刪 run_adapter + resume.py(精準睡),MAX_SLEEP_SECONDS 移入 adapter

保留 run_watcher / DEFAULT_HEARTBEAT。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 3: config 移除 `trigger` 鍵

**Files:**
- Modify: `devloop/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: 無。
- Produces: `Config` dataclass 只剩 `finish` 與 `auto_arm` 兩欄;`load_config` 不再讀 `trigger`。舊 config 的 `trigger` 鍵被 `json.loads` 讀進 dict 但不取用 → 靜默忽略。

- [ ] **Step 1: 修改 `tests/test_config.py` 三個測試(移除 trigger 斷言)**

`test_missing_file_returns_defaults`:刪除 `assert cfg.trigger == "local"` 一行,保留 `assert cfg.finish is None`。
`test_loads_fields`:把 `p.write_text(json.dumps({"trigger": "harness", "finish": "pr"}), ...)` 改為 `p.write_text(json.dumps({"finish": "pr"}), encoding="utf-8")`,並刪除 `assert cfg.trigger == "harness"` 一行。
`test_partial_file_fills_defaults`:刪除 `assert cfg.trigger == "local"` 一行,保留 `assert cfg.finish == "merge"`。

- [ ] **Step 2: 修改 `devloop/config.py`**

把 `Config` dataclass 改為:
```python
@dataclass
class Config:
    finish: str | None = None
    auto_arm: bool = True
```
把 `load_config` 的回傳改為:
```python
    return Config(
        finish=data.get("finish", None),
        auto_arm=bool(data.get("auto_arm", True)),
    )
```
(即移除 `trigger: str = "local"` 欄位與 `trigger=data.get("trigger", "local"),` 那一行。)

- [ ] **Step 3: 跑全套測試確認綠**

Run: `python3 -m pytest -q`
Expected: PASS(全綠)。

- [ ] **Step 4: 驗證 config 無殘留 trigger 引用**

Run: `grep -rnE "\.trigger|\"trigger\"|trigger=" devloop/ tests/`
Expected: 無命中(exit 1)。

- [ ] **Step 5: Commit**

```bash
git add devloop/config.py tests/test_config.py
git commit -m "$(cat <<'EOF'
refactor(config): 移除 trigger 鍵(local/harness 之分)

引擎固定以 watcher 兜底續跑;舊 config 的 trigger 鍵靜默忽略。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 4: OpenSpec spec 移除「既有 resume 路徑向後相容」Requirement

**Files:**
- Modify: `openspec/specs/resume-trigger/spec.md`

**Interfaces:**
- Consumes: 無。
- Produces: spec 不再描述 `plan_resume` / `resume` / `auto-resume`;週期重試 watcher、arm-local、checkpoint `resume_exec`、`auto_arm`、自動 arm 四個 Requirement 保留。

- [ ] **Step 1: 刪除該 Requirement 區塊**

刪除 `### Requirement: 既有 resume 路徑向後相容` 整段(從該標題到其下 `#### Scenario: 既有 plan_resume 行為不變` 場景結尾、下一個 `### Requirement:` 之前的所有內容)。其餘 Requirement 不動。

- [ ] **Step 2: 驗證 OpenSpec spec 仍合法**

Run: `grep -nE "plan_resume|auto-resume|### Requirement:" openspec/specs/resume-trigger/spec.md`
Expected: 無 `plan_resume` / `auto-resume` 命中;`### Requirement:` 仍有(週期重試 watcher / arm-local / checkpoint / auto_arm / 自動 arm / auto_arm 開關 / auto-arm 失敗)數個。

- [ ] **Step 3: Commit**

```bash
git add openspec/specs/resume-trigger/spec.md
git commit -m "$(cat <<'EOF'
docs(openspec): resume-trigger spec 移除精準睡(plan_resume/resume/auto-resume)Requirement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 5: 更新 README.md

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 無。
- Produces: README 不再提 `trigger` config、`resume`/`auto-resume` 子命令、`ScheduleWakeup`/harness 自排、精準睡進階;watcher 兜底敘述保留。

- [ ] **Step 1: 第 5 行流程摘要句尾**

把 `token 用罄則在配額 reset 時間點自動續跑。` 改為 `token 用罄則由 detached watcher 兜底自動續跑。`

- [ ] **Step 2: 「一次性設定」config 說明(約 26–34 行)**

把 config 範例 `{ "trigger": "local", "finish": "merge" }` 改為 `{ "finish": "merge" }`。
刪除 `- \`trigger\`:...` 整條列點(描述 local/harness 那條)。
`finish` 與 `auto_arm` 兩條列點保留。

- [ ] **Step 3: 引擎 CLI 表格**

刪除表格中 `resume` 與 `auto-resume` 兩列:
- `| \`resume [--reset-at <ISO>]\` | 回報 ready / sleep_seconds / phase |`
- `| \`auto-resume --reset-at <ISO> --exec "<cmd>"\` | 本機等到 reset 後執行續跑命令(進階:精準睡) |`
`arm-local` 那列保留。

- [ ] **Step 4: 「Token 用罄續跑」章節**

- 刪除 `trigger` 決定續跑機制的表格(local / harness 兩列)及其引言句「`trigger` 決定續跑機制的組成:」。改為一句:「續跑機制固定為 detached watcher:OS 程序(不依賴被卡住的 agent)反覆執行續跑命令,回 0 即停(loop 已推進),否則睡一個 heartbeat(預設 1800s、上限 3600s)再試。」
- 刪除結尾 `> 進階(已知 reset 時間想精準睡):auto-resume ...` 那段引用區塊中關於 `auto-resume` 的句子;若該段同時提到 `trigger=harness` 雲端替代,一併刪除(harness 已不存在)。

- [ ] **Step 5: 驗證 README 無殘留**

Run: `grep -nE "auto-resume|ScheduleWakeup|trigger.*harness|harness.*trigger|plan_resume" README.md`
Expected: 無命中(exit 1)。`dev-loop resume`(手動)等敘述允許保留。

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): 移除 trigger/resume/auto-resume/harness 自排敘述,續跑固定為 watcher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 6: 更新 `skills/dev-loop/SKILL.md`

**Files:**
- Modify: `skills/dev-loop/SKILL.md`

**Interfaces:**
- Consumes: 無。
- Produces: SKILL 步驟 3 不再要求 agent `ScheduleWakeup` 自排;不再有 Trigger 語義的 local/harness 表;config 說明不再列 `trigger`;Token 用罄節不再有精準睡進階。

- [ ] **Step 1: 每回合邏輯步驟 3(約 22 行)**

把步驟 3「未到終態則排程下一輪:...呼叫 `ScheduleWakeup` 排程下一輪...」整條改為:
「**未到終態即本回合結束**:若 phase 還不是 `done` 或停等人工的 `escalated`,本回合到此為止;token/配額恢復後由引擎自動 arm 的 detached watcher 冷啟動續跑(見「Token 用罄續跑」),本 skill 不需自行排程。」
(移除所有 `ScheduleWakeup` 提及。)

- [ ] **Step 2: config 說明(約 12 行)**

刪除 `- \`trigger\`:token 用罄續跑的觸發語義。...` 整條列點。`auto_arm` 那條保留。

- [ ] **Step 3: 「Trigger(觸發器語義)」章節(約 88–95 行)**

刪除 local/harness 兩列表格。整節改寫為一段:
「引擎在每個寫 checkpoint 的子命令 save 之後自動確保續跑 watcher 在位(`resume_exec` 非空且 `auto_arm` 未關閉時),SKILL 不需手動呼叫 `arm-local`。watcher 是 detached OS 程序,週期重試 `resume_exec`,回 0 即停。」
(可將標題改為「續跑觸發(watcher)」。)

- [ ] **Step 4: 「Token 用罄續跑」章節(約 97–105 行)**

- 主段保留 watcher 敘述(「續跑觸發器由引擎自動兜底...watcher 反覆執行 `resume_exec`...」),把其中對「見『Trigger(觸發器語義)』」的交叉引用改為指向 Step 3 改寫後的節名。
- 刪除 `**進階(已知 reset 時間想精準睡)**:` 整段(含 `resume` 與 `auto-resume` 兩個 bullet)。
- 刪除 `> 雲端替代方案:trigger=harness 搭配 cron / /schedule ...` 那段引用區塊。

- [ ] **Step 5: 掃描其餘 ScheduleWakeup / trigger / 精準睡殘留**

Run: `grep -nE "ScheduleWakeup|auto-resume|trigger.*harness|harness|精準睡|reset 時間" skills/dev-loop/SKILL.md`
Expected: 無命中(exit 1)。`arm-local`、`resume_exec`、`dev-loop resume`(手動)、`watcher` 等敘述允許保留。

- [ ] **Step 6: Commit**

```bash
git add skills/dev-loop/SKILL.md
git commit -m "$(cat <<'EOF'
docs(skill): 移除 ScheduleWakeup 自排 / trigger 語義 / 精準睡進階,續跑固定 watcher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014UaxFCtZTKxXCSsyR974Kv
EOF
)"
```

---

### Task 7: 全套驗證 + 同步安裝副本

**Files:**
- Sync only(不改本 repo 檔案):`~/.claude/skills/dev-loop/engine/devloop/`、`~/.claude/skills/dev-loop/SKILL.md`

**Interfaces:**
- Consumes: 前六個任務全部完成。
- Produces: 安裝副本與 repo 一致;`resume.py` 也從安裝副本移除。

- [ ] **Step 1: 全套測試最終確認**

Run: `python3 -m pytest -q`
Expected: PASS(全綠)。

- [ ] **Step 2: 全域殘留掃描**

Run: `grep -rniE "plan_resume|run_adapter|_cmd_resume|_cmd_auto_resume|ScheduleWakeup" devloop/ tests/ skills/ README.md openspec/specs/`
Expected: 無命中(exit 1)。

- [ ] **Step 3: 同步引擎 + SKILL 到安裝副本(含刪除 resume.py)**

```bash
cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/
rm -f ~/.claude/skills/dev-loop/engine/devloop/resume.py
cp skills/dev-loop/SKILL.md ~/.claude/skills/dev-loop/SKILL.md
```

- [ ] **Step 4: 驗證安裝副本引擎可 import 且無 resume.py**

Run: `ls ~/.claude/skills/dev-loop/engine/devloop/resume.py 2>&1; python3 -c "import sys; sys.path.insert(0, '$HOME/.claude/skills/dev-loop/engine'); import devloop.cli, devloop.adapter, devloop.config; print('import OK')"`
Expected: `No such file`(resume.py 已移除)+ `import OK`。

---

## Self-Review

**Spec coverage:**
- 精準睡刪除(resume.py / run_adapter / resume / auto-resume)→ Task 1 + Task 2 ✓
- trigger config 移除 → Task 3 ✓
- OpenSpec spec 更新 → Task 4 ✓
- README 更新 → Task 5 ✓
- SKILL(含 ScheduleWakeup 自排)更新 → Task 6 ✓
- watcher / arm-local / resume_exec / auto_arm 保留 → Global Constraints + 各任務保留清單 ✓
- 驗證 + 同步 → Task 7 ✓

**Placeholder scan:** 無 TBD/TODO;所有代碼步驟給出完整內容;文檔步驟給出精確舊文→新文。

**Type consistency:** `MAX_SLEEP_SECONDS` 於 Task 2 定義在 `adapter.py`,`test_adapter.py`(Task 2)與 `run_watcher` 皆從 adapter 取用,一致。`Config` 移除 `trigger` 後 Task 3 的 test 不再引用該屬性,一致。

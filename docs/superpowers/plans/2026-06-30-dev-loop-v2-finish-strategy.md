# Dev-Loop v2 收尾策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 dev-loop 通過所有關卡後,依 `.devloop/config.json` 的 `finish`(可被 change metadata override)決定直接 merge 回 trunk、開 PR、或停下問人工;並把累積的 non-blocking 落成 follow-up。

**Architecture:** 延續「確定性決策交引擎、環境 git 操作交 skill」。引擎新增 `config.py`(讀 config + `resolve_finish` 決策純邏輯)與 `finish.py`(follow-up 渲染/寫檔),以及 `finish` CLI 子命令(回報 decision + 落 follow-up)。實際的 `git merge 回 trunk` / `gh pr create` 由 SKILL.md 依 decision 編排(與 v1 第 8 步 merge 一致,git 一向由 skill 執行)。

**Tech Stack:** Python 3.9+(stdlib only)、pytest(僅測試)。

**Base:** 第 1、2 份已 merge 回 main(merge commits `506e27c`、`bf069f5`)。本份以 main 為基線。`ChangeMeta` 已有 `finish` 欄位(第 1 份),`Checkpoint.non_blocking` 已累積(v1)。

## Global Constraints

- **stdlib-only**;**Python 3.9+** 相容;**確定性**:引擎不做 git 環境操作,只做決策與檔案。
- **向後相容**:無 `.devloop/config.json` 或無 `finish` → decision 預設 `ask`(停下問人工,等同保守行為)。
- **決策優先序**:change metadata 的 `finish`(`.devloop/changes/<id>.json`)override 全域 `config.finish`;兩者皆無 → `ask`。
- **finish 值域**:`merge` | `pr` | `ask`(其他值視為無效,留待 self-review 決定是否驗證)。
- **檔案編碼**:讀寫一律 `encoding="utf-8"`、JSON `ensure_ascii=False`。
- **測試模式**:每模組對應 `tests/test_<module>.py`。
- **同步全域 skill**:引擎改完後 `cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`(最後一個 task)。

---

### Task 1: `config.py` — Config 讀取

**Files:**
- Create: `devloop/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `@dataclass Config(trigger: str = "local", finish: str | None = None)`
  - `load_config(path) -> Config`(檔案不存在 → 全預設;部分欄位 → 其餘預設)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_config.py
import json

from devloop.config import Config, load_config


def test_missing_file_returns_defaults(tmp_path):
    cfg = load_config(tmp_path / "nope.json")
    assert cfg.trigger == "local"
    assert cfg.finish is None


def test_loads_fields(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"trigger": "harness", "finish": "pr"}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.trigger == "harness"
    assert cfg.finish == "pr"


def test_partial_file_fills_defaults(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"finish": "merge"}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.trigger == "local"
    assert cfg.finish == "merge"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_config.py -v`
Expected: FAIL(`ModuleNotFoundError: No module named 'devloop.config'`)

- [ ] **Step 3: Write minimal implementation**

```python
# devloop/config.py
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Config:
    trigger: str = "local"
    finish: str = None


def load_config(path) -> "Config":
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        trigger=data.get("trigger", "local"),
        finish=data.get("finish", None),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_config.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/config.py tests/test_config.py
git commit -m "feat(config): 讀取 .devloop/config.json(trigger/finish)"
```

---

### Task 2: `config.py` — `resolve_finish` 決策

**Files:**
- Modify: `devloop/config.py`(新增 `resolve_finish`)
- Test: `tests/test_config.py`(append)

**Interfaces:**
- Consumes: `Config`(T1)、`ChangeMeta`(devloop/changemeta.py,有 `.finish` 屬性)。
- Produces:`resolve_finish(config, meta) -> str`:`meta.finish` 非 None → 回 `meta.finish`;否則 `config.finish` 非 None → 回 `config.finish`;否則回 `"ask"`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_config.py  (append)
from devloop.config import resolve_finish
from devloop.changemeta import ChangeMeta


def test_resolve_meta_overrides_config():
    cfg = Config(finish="merge")
    meta = ChangeMeta(finish="pr")
    assert resolve_finish(cfg, meta) == "pr"


def test_resolve_falls_back_to_config():
    cfg = Config(finish="merge")
    meta = ChangeMeta(finish=None)
    assert resolve_finish(cfg, meta) == "merge"


def test_resolve_defaults_to_ask():
    assert resolve_finish(Config(), ChangeMeta()) == "ask"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_config.py -k resolve -v`
Expected: FAIL(`cannot import name 'resolve_finish'`)

- [ ] **Step 3: Write minimal implementation**

`devloop/config.py` 新增:

```python
def resolve_finish(config, meta) -> str:
    """決定收尾策略:change metadata 的 finish override 全域 config;皆無 → ask。"""
    if meta.finish is not None:
        return meta.finish
    if config.finish is not None:
        return config.finish
    return "ask"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_config.py -k resolve -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/config.py tests/test_config.py
git commit -m "feat(config): resolve_finish 收尾決策(meta override config)"
```

---

### Task 3: `finish.py` — follow-up 渲染與寫檔

**Files:**
- Create: `devloop/finish.py`
- Test: `tests/test_finish.py`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `render_followup(notes) -> str`:notes 非空 → `"## Follow-up(non-blocking)\n\n" + "\n".join("- " + n for n in notes)`;空 → `""`。
  - `write_followup(path, notes) -> None`:把 `render_followup(notes)` 寫入 path(utf-8);notes 空則仍寫空字串(呼叫端自行決定是否呼叫)。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_finish.py
from devloop.finish import render_followup, write_followup


def test_render_followup_lists_notes():
    out = render_followup(["rename x", "add docstring"])
    assert "## Follow-up(non-blocking)" in out
    assert "- rename x" in out
    assert "- add docstring" in out


def test_render_followup_empty():
    assert render_followup([]) == ""


def test_write_followup_creates_file(tmp_path):
    p = tmp_path / "followup.md"
    write_followup(p, ["fix typo"])
    content = p.read_text(encoding="utf-8")
    assert "- fix typo" in content
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_finish.py -v`
Expected: FAIL(`ModuleNotFoundError: No module named 'devloop.finish'`)

- [ ] **Step 3: Write minimal implementation**

```python
# devloop/finish.py
from __future__ import annotations

from pathlib import Path


def render_followup(notes) -> str:
    if not notes:
        return ""
    lines = ["## Follow-up(non-blocking)", ""]
    lines.extend("- " + n for n in notes)
    return "\n".join(lines)


def write_followup(path, notes) -> None:
    Path(path).write_text(render_followup(notes), encoding="utf-8")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_finish.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/finish.py tests/test_finish.py
git commit -m "feat(finish): follow-up 渲染與寫檔"
```

---

### Task 4: CLI `finish` 子命令

**Files:**
- Modify: `devloop/cli.py`(`_cmd_finish` + sub-parser;import config/finish)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `load_config`/`resolve_finish`(config.py)、`load_change_meta`(changemeta.py,已 import)、`render_followup`/`write_followup`(finish.py)、`Checkpoint`。
- Produces: 子命令 `finish --file <cp> --config <config.json> --meta <change.json> --followup <followup.md>`。
  - decision = `resolve_finish(load_config(config), load_change_meta(meta))`;印 `finish: <decision>`。
  - decision == `merge`:若 `cp.non_blocking` 非空 → `write_followup(followup, cp.non_blocking)` 並印 `followup: <path>`。
  - decision == `pr`:若 follow-up 非空 → 印 `--- PR body follow-up ---` 與 `render_followup` 內容(供 skill 放進 PR body)。
  - decision == `ask`:只印 decision。
  - 一律 return 0(decision 由 stdout 傳給 skill 編排 git)。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_finish_merge_writes_followup(tmp_path, capsys):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b",
               non_blocking=["rename x"]).save(cp_path)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"finish": "merge"}), encoding="utf-8")
    meta = tmp_path / "c.json"
    meta.write_text(json.dumps({}), encoding="utf-8")
    followup = tmp_path / "followup.md"
    rc = main(["finish", "--file", str(cp_path), "--config", str(cfg),
               "--meta", str(meta), "--followup", str(followup)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "finish: merge" in out
    assert "- rename x" in followup.read_text(encoding="utf-8")


def test_finish_pr_prints_body(tmp_path, capsys):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b",
               non_blocking=["polish ui"]).save(cp_path)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"finish": "pr"}), encoding="utf-8")
    meta = tmp_path / "c.json"
    meta.write_text(json.dumps({}), encoding="utf-8")
    rc = main(["finish", "--file", str(cp_path), "--config", str(cfg),
               "--meta", str(meta), "--followup", str(tmp_path / "f.md")])
    assert rc == 0
    out = capsys.readouterr().out
    assert "finish: pr" in out
    assert "- polish ui" in out


def test_finish_defaults_to_ask(tmp_path, capsys):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(cp_path)
    cfg = tmp_path / "config.json"   # 不建立(不存在 → 預設)
    meta = tmp_path / "c.json"
    meta.write_text(json.dumps({}), encoding="utf-8")
    rc = main(["finish", "--file", str(cp_path), "--config", str(cfg),
               "--meta", str(meta), "--followup", str(tmp_path / "f.md")])
    assert rc == 0
    assert "finish: ask" in capsys.readouterr().out


def test_finish_meta_overrides_config(tmp_path, capsys):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(cp_path)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"finish": "merge"}), encoding="utf-8")
    meta = tmp_path / "c.json"
    meta.write_text(json.dumps({"finish": "pr"}), encoding="utf-8")
    main(["finish", "--file", str(cp_path), "--config", str(cfg),
          "--meta", str(meta), "--followup", str(tmp_path / "f.md")])
    assert "finish: pr" in capsys.readouterr().out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k finish -v`
Expected: FAIL(`invalid choice: 'finish'`)

- [ ] **Step 3: Write minimal implementation**

`cli.py` import 區新增:

```python
from devloop.config import load_config, resolve_finish
from devloop.finish import render_followup, write_followup
```

(`load_change_meta` 已 import。)

新增函式(放在 `_cmd_archive` 之後):

```python
def _cmd_finish(args):
    cp = Checkpoint.load(args.file)
    config = load_config(args.config)
    meta = load_change_meta(args.meta)
    decision = resolve_finish(config, meta)
    print("finish: %s" % decision)
    if decision == "merge":
        if cp.non_blocking:
            write_followup(args.followup, cp.non_blocking)
            print("followup: %s" % args.followup)
    elif decision == "pr":
        body = render_followup(cp.non_blocking)
        if body:
            print("--- PR body follow-up ---")
            print(body)
    return 0
```

sub-parser(放在 `archive` 之後):

```python
    p_finish = sub.add_parser("finish")
    p_finish.add_argument("--file", required=True)
    p_finish.add_argument("--config", required=True)
    p_finish.add_argument("--meta", required=True)
    p_finish.add_argument("--followup", required=True)
    p_finish.set_defaults(func=_cmd_finish)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k finish -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): finish 子命令(決策 + follow-up 落地)"
```

---

### Task 5: spec 加註 + SKILL.md 第 8 步收尾 + README + 同步

**Files:**
- Modify: `docs/superpowers/specs/2026-06-30-dev-loop-v2-design.md`(§3 design-layer 加註)
- Modify: `~/.claude/skills/dev-loop/SKILL.md`(第 8 步收尾改為 finish 決策驅動)
- Modify: `README.md`(引擎 CLI 表格新增 `finish`)
- Sync: `devloop/*.py` → `~/.claude/skills/dev-loop/engine/devloop/`

**Interfaces:**
- Consumes: `finish` 子命令。
- Produces: 無新程式碼;文件 + 同步。

- [ ] **Step 1: 跑全套測試確認全綠**

Run: `python3 -m pytest -q`
Expected: 全 PASS(既有 136 + 本份新增約 13)

- [ ] **Step 2: spec 加註 design-layer**

在 `docs/superpowers/specs/2026-06-30-dev-loop-v2-design.md` §3 狀態機,於 Proposal Review 的「根本問題(design 層)」一行後補一句註記(承第 2 份最終 review):

```markdown
> 註:design 層 blocking 在引擎實作為 `PROPOSE_BLOCKING_DESIGN → escalated`(escalated 即「停下升級給人工」狀態)。brainstorm 無 inbound auto-transition(設計上由人工驅動),故「回 brainstorm」由人工在升級後手動發起,而非引擎自動轉移。
```

- [ ] **Step 3: 更新 SKILL.md 第 8 步**

把 `~/.claude/skills/dev-loop/SKILL.md` 的「8. Merge & Archive」步驟改為 finish 決策驅動(讀檔後對應改寫):

```markdown
8. **收尾(finish 決策驅動)**:review 無 blocking 進入 merge phase 後,先問引擎決策:
   `python3 -m devloop.cli finish --file .devloop/checkpoint.json --config .devloop/config.json --meta .devloop/changes/<id>.json --followup .devloop/followup-<id>.md`
   - stdout `finish: merge` → 短命分支 merge 回 trunk → `python3 -m devloop.cli archive --file .devloop/checkpoint.json`;`followup: <path>` 指出已落地的 non-blocking follow-up 檔。
   - stdout `finish: pr` → `archive`(commit change 移檔)→ push 分支 → `gh pr create`(PR body 放入 `--- PR body follow-up ---` 之後印出的內容)→ 終態,等人 review/合並。
   - stdout `finish: ask` → ✋ 停下問使用者選 merge 或 pr,再依上述對應路徑執行。
```

並在「設定」段補上 `finish` 設定說明:`finish`:收尾策略 `merge`|`pr`|`ask`(未設等同 `ask`);可被 `.devloop/changes/<id>.json` 的 `finish` override。

- [ ] **Step 4: 更新 README.md CLI 表格 + 同步**

README 引擎 CLI 表格新增列:

```markdown
| `finish --config <c> --meta <m> --followup <f>` | 依 config/meta 決策 merge\|pr\|ask + 落 follow-up |
```

接著同步:`cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`,再 `python3 -m pytest -q` 確認全綠。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-30-dev-loop-v2-design.md README.md
git commit -m "docs: finish 收尾策略(spec 加註 design-layer + SKILL/README);同步全域 skill"
```

(SKILL.md 在 `~/.claude/` 不在本 repo,不納入 commit。)

---

## Self-Review

**1. Spec coverage**(對照 design spec §7):
- config.finish + change meta override → Task 1/2 ✓
- merge / pr / ask 決策 → Task 2 `resolve_finish` + Task 4 CLI ✓
- non_blocking follow-up(merge 寫檔、pr 進 PR body)→ Task 3 + Task 4 ✓
- 實際 git merge / archive / push / gh pr → SKILL.md 第 8 步編排(Task 5)✓(依 dev-loop 哲學,git 環境操作由 skill)
- design-layer → escalated 的 spec 加註(承第 2 份 review)→ Task 5 ✓

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 均含完整實作。

**3. Type consistency:** `Config(trigger, finish)`(T1)、`resolve_finish(config, meta)`(T2)、`render_followup/write_followup`(T3)在 cli.py(T4)一致消費;`ChangeMeta.finish` 為第 1 份既有欄位。

**4. 邊界決策(self-review)**:`finish` 值域為 merge|pr|ask;`resolve_finish` 對未知字串會原樣回傳(如 config 寫了 `finish: "foo"` → 回 `"foo"`),`_cmd_finish` 對非 merge/pr 的值都走「只印 decision」路徑(等同 ask 的保守行為,但印出原值),由 SKILL 編排時辨識;不在引擎強制 choices,保留前向彈性。此為刻意選擇,非缺口。

> **註**:本份為 dev-loop v2 三份計畫的最後一份;完成後 v2(Proposal Review + QA + 平行 + UIUX + 收尾)全部落地。

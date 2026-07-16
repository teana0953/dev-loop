> **歷史實作計畫(point-in-time)**:該輪執行完成即凍結,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop trunk-based 收尾(archive 前置 + teardown)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 trunk merge 前 OpenSpec 收尾原子化(archive 前置於短命分支),並新增 `teardown` phase 與子命令,idempotent 清掉短命分支/watcher/孤兒 worktree/漏網 meta。

**Architecture:** 狀態機在 `merge` 與 `done` 之間插入 `teardown` phase(`merge --finish_done--> teardown --teardown_done--> done`),確定性清殘留邏輯放進新模組 `devloop/teardown.py`、由 `devloop teardown` 子命令編排並自行推進終態;checkpoint 新增 `finish_mode` 讓 resume 得知 merge/pr 以決定刪不刪分支。archive 前置與 trunk merge 本身維持 SKILL orchestration(Part A 只改 SKILL 文字)。

**Tech Stack:** Python 3(stdlib only:`subprocess`/`os`/`signal`/`pathlib`/`dataclasses`)、pytest、git CLI、openspec CLI 1.5.0。

## Global Constraints

- 語言:繁體中文註解與 docstring,對齊現有模組風格。
- 依賴:僅標準庫;不引第三方套件。
- archive **一律 sync** 主規格(`openspec archive <id> --yes`),**不**加 `--skip-specs`。
- 所有 teardown 清理步驟必須 **idempotent**:已清跳過、不存在不報錯、重跑無害。
- 非致命清理失敗(watcher disarm、branch 刪除)只印 stderr/stdout 警告,**不得阻斷** teardown 推進(比照 `archive_workfiles`「不反噬」原則)。
- `.devloop/` 已 gitignore;openspec 檔案變動的 git commit 由 SKILL 在短命分支上下,引擎不碰。
- checkpoint 向後相容:缺 `finish_mode` 欄位的舊檔載入視為 `None`。

---

### Task 1: Checkpoint 新增 `finish_mode` 欄位

**Files:**
- Modify: `devloop/checkpoint.py:23`(`gate_failures` 欄位之後)
- Test: `tests/test_checkpoint.py`

**Interfaces:**
- Produces: `Checkpoint.finish_mode: str = None`(∈ `{"merge","pr",None}`),供 Task 2 next_hint、Task 3 event、Task 5 teardown 讀取。

- [ ] **Step 1: 寫失敗測試**

在 `tests/test_checkpoint.py` 末尾加:

```python
def test_finish_mode_defaults_none_and_roundtrips(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(f)
    assert Checkpoint.load(f).finish_mode is None
    cp = Checkpoint.load(f)
    cp.finish_mode = "merge"
    cp.save(f)
    assert Checkpoint.load(f).finish_mode == "merge"


def test_load_legacy_checkpoint_without_finish_mode(tmp_path):
    import json
    f = tmp_path / "cp.json"
    f.write_text(json.dumps(
        {"phase": "merge", "change_id": "c", "branch": "b"}), encoding="utf-8")
    assert Checkpoint.load(f).finish_mode is None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_checkpoint.py::test_finish_mode_defaults_none_and_roundtrips -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'finish_mode'`(或 AttributeError)

- [ ] **Step 3: 加欄位**

`devloop/checkpoint.py`,在 `gate_failures: int = 0` 之後新增一行:

```python
    propose_attempts: int = 0
    gate_failures: int = 0
    finish_mode: str = None
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_checkpoint.py -v`
Expected: PASS(全綠,含既有測試)

- [ ] **Step 5: Commit**

```bash
git add devloop/checkpoint.py tests/test_checkpoint.py
git commit -m "feat(checkpoint): 新增 finish_mode 欄位(merge/pr 收尾模式)"
```

---

### Task 2: 狀態機 — teardown phase、transition、next_hint

**Files:**
- Modify: `devloop/statemachine.py`(PHASES、event 常數、`transition`、`next_hint`)
- Modify: `devloop/cli.py`(`_cmd_status` 傳 `finish_mode` 給 `next_hint`)
- Modify: `tests/test_statemachine.py:97-98`(既有 `test_merge_finish_done_to_done`)
- Test: `tests/test_statemachine.py`

**Interfaces:**
- Consumes: `Checkpoint.finish_mode`(Task 1)。
- Produces: `TEARDOWN_DONE = "teardown_done"`;`"teardown"` ∈ `PHASES`;`transition("merge",i,FINISH_DONE)==("teardown",i)`;`transition("teardown",i,TEARDOWN_DONE)==("done",i)`;`next_hint` 新增 `finish_mode=None` 參數,`teardown` phase 回 `next: python3 -m devloop.cli teardown --file <cp> --repo . --mode <merge|pr 或 finish_mode>`。

- [ ] **Step 1: 改既有測試 + 寫新失敗測試**

先把 `tests/test_statemachine.py:97-98` 的 `test_merge_finish_done_to_done` 改成指向 teardown:

```python
def test_merge_finish_done_to_teardown():
    assert transition("merge", 2, FINISH_DONE) == ("teardown", 2)
```

在 import 區(第 5 行附近 `FINISH_DONE,` 之後)加入 `TEARDOWN_DONE,`,並在該檔末尾新增:

```python
def test_teardown_done_to_done():
    from devloop.statemachine import TEARDOWN_DONE
    assert transition("teardown", 2, TEARDOWN_DONE) == ("done", 2)


def test_teardown_in_phases():
    assert "teardown" in PHASES


def test_next_hint_teardown_fills_finish_mode():
    h = next_hint("teardown", "/x/cp.json", finish_mode="merge")
    assert h.startswith("next: ") and "teardown" in h and "--mode merge" in h


def test_next_hint_teardown_skeleton_when_mode_absent():
    h = next_hint("teardown", "/x/cp.json")
    assert "<merge|pr>" in h
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_statemachine.py::test_merge_finish_done_to_teardown tests/test_statemachine.py::test_teardown_done_to_done -v`
Expected: FAIL — `ImportError: cannot import name 'TEARDOWN_DONE'` / `AssertionError`(merge 仍轉 done)

- [ ] **Step 3: 加 phase、event、transition、next_hint**

`devloop/statemachine.py`:

(a) `PHASES` 在 `"merge",` 之後、`"escalated",` 之前插入 `"teardown",`:

```python
    "merge",
    "teardown",
    "escalated",
    "done",
```

(b) event 區,在 `PROPOSE_DONE = "propose_done"` 之後新增:

```python
FINISH_DONE = "finish_done"
PROPOSE_DONE = "propose_done"
TEARDOWN_DONE = "teardown_done"
```

(c) `transition` 內,把現有 `merge`/`FINISH_DONE` 分支改為轉 teardown,並緊接新增 teardown 分支:

```python
    if phase == "merge" and event == FINISH_DONE:
        return ("teardown", iteration)
    if phase == "teardown" and event == TEARDOWN_DONE:
        return ("done", iteration)
```

(d) `next_hint` 簽名尾端加 `finish_mode=None`,並在 `gate`+`gate_cmds` 特例之後、`_TERMINAL_HINTS` 判斷之前,新增 teardown 特例:

```python
def next_hint(phase, checkpoint_path, units=None, review_legs=None, gate_cmds=None,
              finish_mode=None):
    ...
    if phase == "gate" and gate_cmds:
        return "next: python3 -m devloop.cli gate --file %s" % checkpoint_path
    if phase == "teardown":
        mode = finish_mode or "<merge|pr>"
        return ("next: python3 -m devloop.cli teardown --file %s --repo . --mode %s"
                % (checkpoint_path, mode))
```

- [ ] **Step 4: 讓 status 傳 finish_mode**

`devloop/cli.py` 的 `_cmd_status`,把 `next_hint(...)` 呼叫補上 `finish_mode=cp.finish_mode`:

```python
    hint = next_hint(cp.phase, args.file, units=cp.units, review_legs=cp.review_legs,
                     gate_cmds=config.gate_cmds, finish_mode=cp.finish_mode)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `python3 -m pytest tests/test_statemachine.py tests/test_cli.py -v`
Expected: PASS(全綠)

- [ ] **Step 6: Commit**

```bash
git add devloop/statemachine.py devloop/cli.py tests/test_statemachine.py
git commit -m "feat(statemachine): 插入 teardown phase(merge->teardown->done)+ next_hint"
```

---

### Task 3: `event --finish-mode` 落地 finish_mode

**Files:**
- Modify: `devloop/cli.py`(`_cmd_event` + event 子解析器 `p_event`,約 581-585)
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `Checkpoint.finish_mode`(Task 1)、`TEARDOWN_DONE`/teardown transition(Task 2)。
- Produces: `event --event finish_done --finish-mode {merge,pr}` 把值寫進 `checkpoint.finish_mode`;未帶則不動(相容)。

- [ ] **Step 1: 寫失敗測試**

在 `tests/test_cli.py` 末尾加:

```python
def test_event_finish_done_stores_finish_mode(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "finish_done",
                 "--finish-mode", "merge"])
    assert code == 0
    cp = Checkpoint.load(f)
    assert cp.phase == "teardown"
    assert cp.finish_mode == "merge"


def test_event_without_finish_mode_leaves_it_none(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)
    main(["event", "--file", str(f), "--event", "apply_done"])
    assert Checkpoint.load(f).finish_mode is None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_cli.py::test_event_finish_done_stores_finish_mode -v`
Expected: FAIL — `error: unrecognized arguments: --finish-mode merge`(SystemExit 2)

- [ ] **Step 3: 加解析器參數 + 寫入邏輯**

(a) `devloop/cli.py` 的 `p_event` 區塊(`p_event.add_argument("--max", ...)` 之後)新增:

```python
    p_event.add_argument("--finish-mode", dest="finish_mode",
                         choices=("merge", "pr"), default=None)
```

(b) `_cmd_event`,在 `human_resume` 計數歸零區塊之後、`_save_with_history` 之前插入:

```python
    if getattr(args, "finish_mode", None):
        cp.finish_mode = args.finish_mode
    _save_with_history(cp, args, args.event, from_phase)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_cli.py -k "finish_mode or event" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): event --finish-mode 落地 checkpoint.finish_mode"
```

---

### Task 4: `devloop/teardown.py` 清殘留純模組

**Files:**
- Create: `devloop/teardown.py`
- Test: `tests/test_teardown.py`

**Interfaces:**
- Consumes: `devloop.worktree.list_worktree_paths`(既有)。
- Produces:
  - `disarm_watcher(checkpoint_path) -> str`(`"killed"`/`"absent"`)
  - `prune_orphan_worktrees(repo, wt_root) -> int`(移除數)
  - `sweep_change_meta(checkpoint_path, change_id) -> bool`
  - `delete_merged_branch(repo, branch) -> bool`
  皆 idempotent、非致命。Task 5 的 `_cmd_teardown` 消費之。

- [ ] **Step 1: 寫失敗測試**

新建 `tests/test_teardown.py`:

```python
import subprocess
import time
from pathlib import Path

import pytest

from devloop.teardown import (
    disarm_watcher, prune_orphan_worktrees, sweep_change_meta, delete_merged_branch,
)
from devloop.worktree import add_worktree


def _run(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    _run(r, "init", "-b", "main")
    _run(r, "config", "user.email", "t@t")
    _run(r, "config", "user.name", "t")
    (r / "base.txt").write_text("base\n")
    _run(r, "add", "."); _run(r, "commit", "-m", "init")
    return r


def test_disarm_watcher_absent_when_no_pidfile(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    assert disarm_watcher(cp) == "absent"


def test_disarm_watcher_kills_live_process_and_removes_pidfile(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    proc = subprocess.Popen(["sleep", "30"])
    (tmp_path / "watcher.pid").write_text(str(proc.pid))
    assert disarm_watcher(cp) == "killed"
    assert not (tmp_path / "watcher.pid").exists()
    proc.wait(timeout=5)
    assert proc.returncode is not None


def test_disarm_watcher_dead_pid_removes_file(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    # spawn+reap 取得一個必死的 pid
    proc = subprocess.Popen(["true"]); proc.wait()
    (tmp_path / "watcher.pid").write_text(str(proc.pid))
    assert disarm_watcher(cp) == "absent"
    assert not (tmp_path / "watcher.pid").exists()


def test_prune_orphan_worktrees_removes_under_root(repo, tmp_path):
    wt_root = repo / ".devloop" / "wt"
    add_worktree(repo, wt_root / "g1", "loop-g1", "main")
    removed = prune_orphan_worktrees(repo, wt_root)
    assert removed == 1
    assert not (wt_root / "g1").exists()


def test_prune_orphan_worktrees_noop_when_root_absent(repo, tmp_path):
    assert prune_orphan_worktrees(repo, repo / ".devloop" / "wt") == 0


def test_sweep_change_meta_moves_then_idempotent(tmp_path):
    cp = tmp_path / "checkpoint.json"; cp.write_text("{}")
    meta = tmp_path / "changes" / "c1.json"
    meta.parent.mkdir(parents=True); meta.write_text("{}")
    assert sweep_change_meta(cp, "c1") is True
    assert (tmp_path / "archive" / "c1" / "c1.json").exists()
    assert not meta.exists()
    assert sweep_change_meta(cp, "c1") is False


def test_delete_merged_branch_true_for_merged(repo):
    _run(repo, "checkout", "-b", "feat")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main"); _run(repo, "merge", "--no-ff", "-m", "m", "feat")
    assert delete_merged_branch(repo, "feat") is True


def test_delete_merged_branch_false_for_unmerged(repo):
    _run(repo, "checkout", "-b", "feat")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main")
    assert delete_merged_branch(repo, "feat") is False  # 未 merged,-d 拒刪
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_teardown.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.teardown'`

- [ ] **Step 3: 實作模組**

新建 `devloop/teardown.py`:

```python
from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path

from devloop.worktree import list_worktree_paths


def disarm_watcher(checkpoint_path) -> str:
    """終態不再需要 watcher:程序活著就 SIGTERM,再刪 watcher.pid。
    回傳 "killed"(有活程序被送訊號)/ "absent"(無 pid 檔、內容非法或已死)。
    idempotent:無檔即 "absent",刪檔用 missing_ok。"""
    pid_path = Path(checkpoint_path).parent / "watcher.pid"
    if not pid_path.exists():
        return "absent"
    result = "absent"
    try:
        pid = int(pid_path.read_text().strip())
    except ValueError:
        pid = None
    if pid is not None:
        try:
            os.kill(pid, signal.SIGTERM)
            result = "killed"
        except (ProcessLookupError, PermissionError, OSError):
            result = "absent"
    pid_path.unlink(missing_ok=True)
    return result


def prune_orphan_worktrees(repo, wt_root) -> int:
    """git worktree prune + 移除 wt_root 底下殘留的 worktree(crash 兜底)。
    回傳實際移除數;wt_root 不存在則僅 prune 回 0。目錄清空後收掉。idempotent。"""
    subprocess.run(["git", "-C", str(repo), "worktree", "prune"],
                   capture_output=True, text=True)
    root = Path(wt_root)
    if not root.exists():
        return 0
    prefix = str(root.resolve()) + os.sep
    removed = 0
    for p in list_worktree_paths(repo):
        if p.startswith(prefix):
            subprocess.run(["git", "-C", str(repo), "worktree", "remove", "--force", p],
                           capture_output=True, text=True)
            removed += 1
    try:
        if root.exists() and not any(root.iterdir()):
            root.rmdir()
    except OSError:
        pass
    return removed


def sweep_change_meta(checkpoint_path, change_id) -> bool:
    """補收 archive_workfiles 漏網的 changes/<id>.json → archive/<id>/。
    回傳是否有搬動;不存在回 False。idempotent。"""
    root = Path(checkpoint_path).parent
    meta = root / "changes" / ("%s.json" % change_id)
    if not meta.exists():
        return False
    dest = root / "archive" / str(change_id)
    dest.mkdir(parents=True, exist_ok=True)
    meta.replace(dest / meta.name)
    return True


def delete_merged_branch(repo, branch) -> bool:
    """git branch -d(safe delete:僅已 merged 才刪)。
    回傳是否刪成功;未 merged / 不存在時 git 回非 0 → False(非致命)。"""
    r = subprocess.run(["git", "-C", str(repo), "branch", "-d", branch],
                       capture_output=True, text=True)
    return r.returncode == 0
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_teardown.py -v`
Expected: PASS(8 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/teardown.py tests/test_teardown.py
git commit -m "feat(teardown): 清殘留純模組(watcher/worktree/meta/branch)"
```

---

### Task 5: `devloop teardown` 子命令

**Files:**
- Modify: `devloop/cli.py`(import、`_cmd_teardown`、`p_teardown` 解析器)
- Test: `tests/test_teardown.py`(沿用該檔 `repo` fixture)

**Interfaces:**
- Consumes: Task 4 四個函式;`_apply_event`/`_save_with_history`/`TEARDOWN_DONE`(既有 + Task 2)。
- Produces: CLI `teardown --file <cp> [--repo .] --mode {merge,pr} [--wt-root <p>] [--max N]`;清完 idempotent 殘留後 apply `TEARDOWN_DONE` → phase=`done`;merge mode 刪短命分支、pr mode 保留。

- [ ] **Step 1: 寫失敗測試**

在 `tests/test_teardown.py` 末尾加(需 import `from devloop.checkpoint import Checkpoint` 與 `from devloop.cli import main`):

```python
from devloop.checkpoint import Checkpoint
from devloop.cli import main


def _teardown_repo_with_checkpoint(repo, mode):
    _run(repo, "checkout", "-b", "loop-x")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main"); _run(repo, "merge", "--no-ff", "-m", "m", "loop-x")
    cp = repo / ".devloop" / "checkpoint.json"
    Checkpoint(phase="teardown", change_id="x", branch="loop-x",
               finish_mode=mode).save(cp)
    return cp


def test_teardown_merge_deletes_branch_and_reaches_done(repo):
    cp = _teardown_repo_with_checkpoint(repo, "merge")
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    assert code == 0
    assert Checkpoint.load(cp).phase == "done"
    branches = subprocess.run(["git", "-C", str(repo), "branch"],
                              capture_output=True, text=True).stdout
    assert "loop-x" not in branches


def test_teardown_pr_keeps_branch(repo):
    cp = _teardown_repo_with_checkpoint(repo, "pr")
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "pr"])
    assert code == 0
    assert Checkpoint.load(cp).phase == "done"
    branches = subprocess.run(["git", "-C", str(repo), "branch"],
                              capture_output=True, text=True).stdout
    assert "loop-x" in branches


def test_teardown_idempotent_on_done(repo):
    cp = _teardown_repo_with_checkpoint(repo, "merge")
    main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    # 已 done;重跑會嘗試 transition(done, teardown_done) → InvalidTransition,回非 0 但不炸
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    assert code != 0
    assert Checkpoint.load(cp).phase == "done"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_teardown.py::test_teardown_merge_deletes_branch_and_reaches_done -v`
Expected: FAIL — `error: argument {...}: invalid choice: 'teardown'`(SystemExit 2)

- [ ] **Step 3: 實作命令 + 解析器**

(a) `devloop/cli.py` import 區(靠近 `from devloop.openspec import ...`)新增:

```python
from devloop.teardown import (
    delete_merged_branch, disarm_watcher, prune_orphan_worktrees, sweep_change_meta,
)
```

並確保 `TEARDOWN_DONE` 在 statemachine import 清單內。

(b) 新增命令函式(放在 `_cmd_archive` 附近):

```python
def _cmd_teardown(args):
    cp = Checkpoint.load(args.file)
    wt_root = args.wt_root or (Path(args.file).parent / "wt")
    print("watcher: %s" % disarm_watcher(args.file))
    print("worktrees pruned: %d" % prune_orphan_worktrees(args.repo, wt_root))
    if sweep_change_meta(args.file, cp.change_id):
        print("swept change meta: %s" % cp.change_id)
    if args.mode == "merge":
        ok = delete_merged_branch(args.repo, cp.branch)
        print("branch %s: %s" % (cp.branch, "deleted" if ok else "kept (unmerged/absent)"))
    else:
        print("branch %s: kept (pr)" % cp.branch)
    from_phase = cp.phase
    try:
        cp = _apply_event(cp, TEARDOWN_DONE, args.max)
    except InvalidTransition as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    _save_with_history(cp, args, TEARDOWN_DONE, from_phase)
    print("phase=%s" % cp.phase)
    return 0
```

(c) 解析器(放在 `p_archive` 之後):

```python
    p_teardown = sub.add_parser("teardown")
    p_teardown.add_argument("--file", required=True)
    p_teardown.add_argument("--repo", default=".")
    p_teardown.add_argument("--mode", required=True, choices=("merge", "pr"))
    p_teardown.add_argument("--wt-root", dest="wt_root", default=None)
    p_teardown.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_teardown.set_defaults(func=_cmd_teardown)
```

> 注意:`_apply_event` 現以 `transition(...)` 直呼,`transition` 於未知轉移會 `raise InvalidTransition`。確認 `InvalidTransition` 已從 `devloop.statemachine` import(既有 cli.py 應已 import;若無則補)。

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_teardown.py -v`
Expected: PASS(全綠)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_teardown.py
git commit -m "feat(cli): devloop teardown 子命令(清殘留 + 推進 done)"
```

---

### Task 6: SKILL.md 步驟 10 重排 + teardown 敘事

**Files:**
- Modify: `skills/dev-loop/SKILL.md`(「流程」步驟 10「收尾」段;「Resume(續跑)」段補 teardown hint)
- Test: 無自動化測試(文件);以下列人工檢查為驗收

**Interfaces:**
- Consumes: Task 3 `event --finish-mode`、Task 5 `teardown` 子命令、Task 2 teardown phase 語義。

- [ ] **Step 1: 重寫步驟 10「收尾」**

把現行步驟 10 的 merge/pr 兩條路徑改為「短命分支上先 archive＋commit → 再整合 → finish_done(帶 finish-mode)→ teardown」。以下為替換後內容(對齊現有條列風格):

```markdown
10. **收尾(finish 決策驅動)**:review 無 blocking 進入 merge phase 後,先問引擎決策:
   `python3 -m devloop.cli finish --file .devloop/checkpoint.json --config .devloop/config.json --meta .devloop/changes/<id>.json --followup .devloop/followup-<id>.md`
   收尾一律「**在短命分支上先 archive＋commit,再整合**」,讓 spec sync 隨分支原子併入。
   - stdout `finish: merge`:
     1. **短命分支上** `python3 -m devloop.cli archive --file .devloop/checkpoint.json`(= `openspec archive` sync 主規格＋移檔,並收工作檔進 `.devloop/archive/<id>/`)。
     2. **短命分支上 commit** openspec 變動:`git add openspec/ && git commit -m "chore(<id>): archive change + sync specs"`。
     3. **原子 merge 回 trunk**:`git checkout <trunk> && git merge --no-ff <branch>`。
     4. `python3 -m devloop.cli event --file .devloop/checkpoint.json --event finish_done --finish-mode merge`(→ phase=teardown)。
   - stdout `finish: pr`:
     1. **短命分支上** `archive` ＋ `git add openspec/ && git commit`(同上)。
     2. push 分支 → `gh pr create`(PR body 放入 `finish` 印出 `--- PR body follow-up ---` 之後的內容)。
     3. `event --event finish_done --finish-mode pr`(→ phase=teardown)。
   - stdout `finish: ask` → ✋ 停下問使用者選 merge 或 pr,再依上述對應路徑執行(選定後務必重跑 `finish` 以落地 follow-up,並在 `event` 帶對應 `--finish-mode`)。
   - **teardown(phase=teardown)**:整合完成後跑
     `python3 -m devloop.cli teardown --file .devloop/checkpoint.json --repo . --mode <merge|pr>`
     子命令 idempotent 清殘留(disarm watcher、`worktree prune`、補收漏網 meta;merge mode 額外 `git branch -d` 已 merged 的短命分支,pr mode 保留分支待 PR 併掉),清完自行推進 `teardown → done`(終態)。
```

- [ ] **Step 2: 補「Resume(續跑)」的 teardown 情形**

在「Resume(續跑)」條列中,`next: (done)` 那條之前加一條:

```markdown
- 第二行是 `next: python3 -m devloop.cli teardown …`(phase=teardown)→ 整合已完成、只差清殘留:依骨架補 `--mode`(checkpoint 的 `finish_mode` 已填時 hint 會直接帶出)執行,子命令會推進到 done。
```

- [ ] **Step 3: 人工檢查驗收**

逐項確認:
- 步驟 10 兩條路徑都是「archive→commit→整合」順序,archive 不再出現在 trunk merge 之後。
- `finish_done` 兩處都帶 `--finish-mode`。
- teardown 段落存在且說明 merge/pr 對分支的差異。
- Resume 段有 teardown hint 說明。

Run: `python3 -m pytest -q`(全套迴歸,確認前五個 task 未被文件步驟影響)
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add skills/dev-loop/SKILL.md
git commit -m "docs(skill): 步驟 10 收尾改 archive 前置 + teardown 清殘留"
```

---

## Self-Review

**1. Spec coverage**(對照 `2026-07-13-devloop-trunk-finish-teardown-design.md`):
- §3 Part A archive 前置 → Task 6(SKILL 步驟 10 重排)＋ Task 3(finish_mode 落地);archive 命令本身不變(§7 明列)。✅
- §4.1 狀態機 finish_mode 欄位 → Task 1;teardown phase/transition → Task 2。✅
- §4.2 next_hint teardown → Task 2。✅
- §4.3 teardown 子命令四項清理(watcher/worktree/meta/branch by mode)＋自行推進 done → Task 4(模組)＋ Task 5(命令)。✅
- §5 殘留對照(checkpoint 不刪)→ Task 5 未刪 checkpoint、Task 4 sweep meta。✅
- §6 測試策略 → 各 Task 皆 TDD;idempotent/相容/mode 分支測試齊備。✅
- §7 YAGNI(不加 `--skip-specs`、不把 merge 收進引擎、不刪 checkpoint、pr 不刪分支)→ 計畫皆遵守。✅

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 給完整程式碼與可執行命令。✅

**3. Type consistency:** `finish_mode`(str/None)、`TEARDOWN_DONE`、四個 teardown 函式簽名在 Task 1/2/4/5 間名稱與型別一致;`next_hint` 新增 `finish_mode` 參數在 Task 2 定義、Task 2 Step 4 於 `_cmd_status` 消費一致;`_cmd_teardown` 消費的 `_apply_event`/`InvalidTransition`/`TEARDOWN_DONE` 皆已定義。✅

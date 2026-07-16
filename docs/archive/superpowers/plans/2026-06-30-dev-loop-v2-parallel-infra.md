> **歷史實作計畫(point-in-time)**:該輪執行完成即凍結,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop v2 並行基建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 dev-loop 的 Apply/Fix 階段能依提案標注的「平行群」分派多個 subagent,各自在 git worktree 上工作再合並回短命分支,並支援 token 用罄續跑時只重跑未完成的 unit。

**Architecture:** 在既有 stdlib-only 引擎上,新增 (1) change metadata 讀取模組、(2) Checkpoint 的 `units[]`/`review_legs[]` 欄位、(3) git worktree 操作模組、(4) units 純邏輯模組、(5) `units-*` CLI 子命令與續跑對賬。狀態機與既有 phase 不動;平行只發生在 apply/fix phase 內,由 checkpoint 的 `units[]` 追蹤以支撐確定性續跑。

**Tech Stack:** Python 3.9+(stdlib only)、`git`(subprocess)、pytest(僅測試)。

## Global Constraints

- **stdlib-only**:引擎執行期不得引入第三方套件;pytest 僅用於測試。
- **Python 3.9+**:相容語法(可用 `from __future__ import annotations`)。
- **確定性**:引擎不做判斷、不換 model;所有狀態落在 checkpoint JSON。
- **向後相容**:舊 checkpoint(無 `units`/`review_legs` 欄位)載入後視為空 list,走串行路徑。
- **檔案編碼**:讀寫 JSON 一律 `encoding="utf-8"`、`ensure_ascii=False`。
- **測試模式**:每個模組對應 `tests/test_<module>.py`;git 相關用 `tmp_path` 建臨時 repo fixture。
- **同步到全域 skill**:引擎改完後 `cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`(最後一個 task 處理)。

---

### Task 1: change metadata 讀取(`changemeta.py`)

讀 `.devloop/changes/<change-id>.json` 的平行群標注;缺檔或缺欄位時回安全預設(串行)。

**Files:**
- Create: `devloop/changemeta.py`
- Test: `tests/test_changemeta.py`

**Interfaces:**
- Consumes: 無(讀檔)。
- Produces:
  - `@dataclass ChangeMeta(parallel_groups: list, needs_uiux: bool, finish: str|None)`
  - `load_change_meta(path) -> ChangeMeta`(檔案不存在 → 全預設)
  - `is_serial(meta: ChangeMeta) -> bool`(`len(parallel_groups) <= 1` → True)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_changemeta.py
import json

from devloop.changemeta import ChangeMeta, load_change_meta, is_serial


def test_missing_file_returns_defaults(tmp_path):
    meta = load_change_meta(tmp_path / "nope.json")
    assert meta.parallel_groups == []
    assert meta.needs_uiux is False
    assert meta.finish is None


def test_loads_fields(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({
        "parallel_groups": [{"id": "g1", "tasks": ["1"], "files_hint": ["src/"]}],
        "needs_uiux": True,
        "finish": "pr",
    }), encoding="utf-8")
    meta = load_change_meta(p)
    assert meta.parallel_groups[0]["id"] == "g1"
    assert meta.needs_uiux is True
    assert meta.finish == "pr"


def test_partial_file_fills_defaults(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"needs_uiux": True}), encoding="utf-8")
    meta = load_change_meta(p)
    assert meta.parallel_groups == []
    assert meta.needs_uiux is True
    assert meta.finish is None


def test_is_serial():
    assert is_serial(ChangeMeta(parallel_groups=[])) is True
    assert is_serial(ChangeMeta(parallel_groups=[{"id": "g1"}])) is True
    assert is_serial(ChangeMeta(parallel_groups=[{"id": "g1"}, {"id": "g2"}])) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_changemeta.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'devloop.changemeta'`

- [ ] **Step 3: Write minimal implementation**

```python
# devloop/changemeta.py
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ChangeMeta:
    parallel_groups: list = field(default_factory=list)
    needs_uiux: bool = False
    finish: str = None


def load_change_meta(path) -> "ChangeMeta":
    p = Path(path)
    if not p.exists():
        return ChangeMeta()
    data = json.loads(p.read_text(encoding="utf-8"))
    return ChangeMeta(
        parallel_groups=data.get("parallel_groups", []),
        needs_uiux=data.get("needs_uiux", False),
        finish=data.get("finish", None),
    )


def is_serial(meta) -> bool:
    return len(meta.parallel_groups) <= 1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_changemeta.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/changemeta.py tests/test_changemeta.py
git commit -m "feat(changemeta): 讀取 .devloop/changes 平行群標注"
```

---

### Task 2: Checkpoint 擴充 `units[]` / `review_legs[]`

加兩個 list 欄位,確保新舊 checkpoint 序列化相容。

**Files:**
- Modify: `devloop/checkpoint.py:9-20`(dataclass 欄位)
- Test: `tests/test_checkpoint.py`(新增測試,append)

**Interfaces:**
- Consumes: 無。
- Produces:`Checkpoint` 新增欄位 `units: list = field(default_factory=list)`、`review_legs: list = field(default_factory=list)`;`load` 對缺欄位的舊檔回空 list。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_checkpoint.py  (append)
import json
from devloop.checkpoint import Checkpoint


def test_units_and_legs_default_empty():
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.units == []
    assert cp.review_legs == []


def test_units_roundtrip(tmp_path):
    path = tmp_path / "cp.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="b",
                    units=[{"id": "g1", "status": "pending"}],
                    review_legs=[{"kind": "code", "status": "pending"}])
    cp.save(path)
    loaded = Checkpoint.load(path)
    assert loaded.units == [{"id": "g1", "status": "pending"}]
    assert loaded.review_legs == [{"kind": "code", "status": "pending"}]


def test_load_legacy_checkpoint_without_units(tmp_path):
    path = tmp_path / "legacy.json"
    path.write_text(json.dumps({
        "phase": "apply", "change_id": "c", "branch": "b",
        "iteration": 0, "last_artifact": "", "non_blocking": [],
        "updated_at": "", "resume_exec": None,
    }), encoding="utf-8")
    loaded = Checkpoint.load(path)
    assert loaded.units == []
    assert loaded.review_legs == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_checkpoint.py -k "units or legacy" -v`
Expected: FAIL(`TypeError` 或 `AttributeError`:`units` 未定義)

- [ ] **Step 3: Write minimal implementation**

在 `devloop/checkpoint.py` 的 dataclass 內,`resume_exec` 之後新增兩行欄位:

```python
    resume_exec: str = None
    units: list = field(default_factory=list)
    review_legs: list = field(default_factory=list)
```

`load` 不需改:現有 `cls(**data)` 對舊檔缺 key 會落到 default_factory。

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_checkpoint.py -v`
Expected: PASS(含既有測試全綠)

- [ ] **Step 5: Commit**

```bash
git add devloop/checkpoint.py tests/test_checkpoint.py
git commit -m "feat(checkpoint): 新增 units/review_legs 欄位(向後相容)"
```

---

### Task 3: units 純邏輯(`units.py`)

不碰 git 的純函式:從平行群建 unit 結構、查詢/更新狀態。

**Files:**
- Create: `devloop/units.py`
- Test: `tests/test_units.py`

**Interfaces:**
- Consumes: `ChangeMeta.parallel_groups`(Task 1)。
- Produces:
  - `build_units(parallel_groups, branch, wt_root) -> list[dict]`,每個 dict:`{"id","tasks","worktree","branch","status"}`,status 初始 `"pending"`。`worktree = f"{wt_root}/{id}"`,`branch = f"{branch}-{id}"`。
  - `pending_units(units) -> list[dict]`(status ∈ {pending, in_progress})
  - `mark(units, unit_id, status) -> None`(原地改)
  - `all_done(units) -> bool`(全部 status==done|merged)
  - `all_merged(units) -> bool`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_units.py
from devloop.units import build_units, pending_units, mark, all_done, all_merged


GROUPS = [
    {"id": "g1", "tasks": ["1", "2"], "files_hint": ["a/"]},
    {"id": "g2", "tasks": ["3"], "files_hint": ["b/"]},
]


def test_build_units_paths_and_branches():
    units = build_units(GROUPS, branch="loop/x", wt_root=".devloop/wt")
    assert units[0] == {
        "id": "g1", "tasks": ["1", "2"],
        "worktree": ".devloop/wt/g1", "branch": "loop/x-g1", "status": "pending",
    }
    assert units[1]["branch"] == "loop/x-g2"


def test_pending_units_includes_in_progress():
    units = build_units(GROUPS, "b", ".w")
    mark(units, "g1", "in_progress")
    mark(units, "g2", "done")
    pend = pending_units(units)
    assert [u["id"] for u in pend] == ["g1"]


def test_all_done_and_all_merged():
    units = build_units(GROUPS, "b", ".w")
    assert all_done(units) is False
    mark(units, "g1", "done")
    mark(units, "g2", "merged")
    assert all_done(units) is True
    assert all_merged(units) is False
    mark(units, "g1", "merged")
    assert all_merged(units) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_units.py -v`
Expected: FAIL(`ModuleNotFoundError: devloop.units`)

- [ ] **Step 3: Write minimal implementation**

```python
# devloop/units.py
from __future__ import annotations

_PENDING = ("pending", "in_progress")


def build_units(parallel_groups, branch, wt_root):
    units = []
    for g in parallel_groups:
        gid = g["id"]
        units.append({
            "id": gid,
            "tasks": g.get("tasks", []),
            "worktree": "%s/%s" % (wt_root, gid),
            "branch": "%s-%s" % (branch, gid),
            "status": "pending",
        })
    return units


def pending_units(units):
    return [u for u in units if u["status"] in _PENDING]


def mark(units, unit_id, status):
    for u in units:
        if u["id"] == unit_id:
            u["status"] = status
            return
    raise KeyError("no unit %r" % unit_id)


def all_done(units):
    return bool(units) and all(u["status"] in ("done", "merged") for u in units)


def all_merged(units):
    return bool(units) and all(u["status"] == "merged" for u in units)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_units.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/units.py tests/test_units.py
git commit -m "feat(units): 平行工作單元純邏輯"
```

---

### Task 4: git worktree 操作(`worktree.py`)

封裝 git worktree 與 merge,衝突偵測後 abort。

**Files:**
- Create: `devloop/worktree.py`
- Test: `tests/test_worktree.py`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `@dataclass MergeResult(ok: bool, conflict: bool, output: str)`
  - `add_worktree(repo, path, branch, base) -> None`(`git -C repo worktree add -b branch path base`)
  - `merge_branch(repo, branch) -> MergeResult`(`git -C repo merge --no-ff branch`;非 0 → `git -C repo merge --abort` 並回 `conflict=True`)
  - `remove_worktree(repo, path, branch) -> None`(`git -C repo worktree remove --force path` 後 `git -C repo branch -D branch`)
  - `list_worktree_paths(repo) -> list[str]`(解析 `git -C repo worktree list --porcelain` 的 `worktree ` 行,**絕對路徑**,排除主工作區)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_worktree.py
import subprocess
from pathlib import Path

import pytest

from devloop.worktree import (
    add_worktree, merge_branch, remove_worktree, list_worktree_paths,
)


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
    _run(r, "add", ".")
    _run(r, "commit", "-m", "init")
    return r


def test_add_and_list_worktree(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    assert wt.exists()
    paths = list_worktree_paths(repo)
    assert str(wt.resolve()) in paths
    assert str(repo.resolve()) not in paths  # 主工作區排除


def test_merge_no_conflict(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    (wt / "g1.txt").write_text("g1\n")
    _run(wt, "add", "."); _run(wt, "commit", "-m", "g1")
    res = merge_branch(repo, "loop-g1")
    assert res.ok is True and res.conflict is False
    assert (repo / "g1.txt").exists()


def test_merge_conflict_aborts(repo, tmp_path):
    # 兩個分支都改同一檔 base.txt → 衝突
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    (wt / "base.txt").write_text("from-g1\n")
    _run(wt, "add", "."); _run(wt, "commit", "-m", "g1 edits base")
    (repo / "base.txt").write_text("from-main\n")
    _run(repo, "add", "."); _run(repo, "commit", "-m", "main edits base")
    res = merge_branch(repo, "loop-g1")
    assert res.ok is False and res.conflict is True
    # abort 後工作區乾淨(無 merge 進行中)
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"],
                            capture_output=True, text=True)
    assert status.stdout.strip() == ""


def test_remove_worktree(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    remove_worktree(repo, wt, "loop-g1")
    assert not wt.exists()
    assert str(wt.resolve()) not in list_worktree_paths(repo)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_worktree.py -v`
Expected: FAIL(`ModuleNotFoundError: devloop.worktree`)

- [ ] **Step 3: Write minimal implementation**

```python
# devloop/worktree.py
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MergeResult:
    ok: bool
    conflict: bool
    output: str


def _git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True,
    )


def add_worktree(repo, path, branch, base) -> None:
    r = _git(repo, "worktree", "add", "-b", branch, str(path), base)
    if r.returncode != 0:
        raise RuntimeError("worktree add failed: %s" % (r.stderr or r.stdout))


def merge_branch(repo, branch) -> "MergeResult":
    r = _git(repo, "merge", "--no-ff", "-m", "merge %s" % branch, branch)
    if r.returncode == 0:
        return MergeResult(ok=True, conflict=False, output=r.stdout)
    _git(repo, "merge", "--abort")
    return MergeResult(ok=False, conflict=True, output=r.stdout + r.stderr)


def remove_worktree(repo, path, branch) -> None:
    _git(repo, "worktree", "remove", "--force", str(path))
    _git(repo, "branch", "-D", branch)


def list_worktree_paths(repo) -> list:
    r = _git(repo, "worktree", "list", "--porcelain")
    main = str(Path(repo).resolve())
    paths = []
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            p = str(Path(line[len("worktree "):]).resolve())
            if p != main:
                paths.append(p)
    return paths
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_worktree.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/worktree.py tests/test_worktree.py
git commit -m "feat(worktree): git worktree 生命週期 + 衝突 abort"
```

---

### Task 5: CLI `units-init`

讀 change meta → build_units → 為每個 unit 建 worktree → 寫進 checkpoint。

**Files:**
- Modify: `devloop/cli.py`(新增 `_cmd_units_init` + sub-parser;import units/worktree/changemeta)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `load_change_meta`(T1)、`build_units`(T3)、`add_worktree`(T4)、`Checkpoint`(T2)。
- Produces: 子命令 `units-init --file <cp> --repo <repo> --meta <change.json> --wt-root <dir>`;寫 `checkpoint.units`,回傳 0。串行(meta `parallel_groups` 空)→ 不建 worktree,`units=[]`,印 `units-init: serial`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append; 既有檔頂部已 import subprocess/Path 視情況補)
import json
import subprocess
from pathlib import Path

from devloop.checkpoint import Checkpoint
from devloop.cli import main


def _git(repo, *a):
    subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True)


def _repo(tmp_path):
    r = tmp_path / "repo"; r.mkdir()
    _git(r, "init", "-b", "main"); _git(r, "config", "user.email", "t@t")
    _git(r, "config", "user.name", "t")
    (r / "base.txt").write_text("x\n"); _git(r, "add", "."); _git(r, "commit", "-m", "init")
    return r


def test_units_init_creates_worktrees(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": [
        {"id": "g1", "tasks": ["1"], "files_hint": ["a/"]},
        {"id": "g2", "tasks": ["2"], "files_hint": ["b/"]},
    ]}), encoding="utf-8")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert [u["id"] for u in cp.units] == ["g1", "g2"]
    assert (repo / ".devloop/wt/g1").exists()
    assert cp.units[0]["status"] == "pending"


def test_units_init_serial_no_worktrees(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": []}), encoding="utf-8")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    assert Checkpoint.load(cp_path).units == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k units_init -v`
Expected: FAIL(`argument command: invalid choice: 'units-init'`)

- [ ] **Step 3: Write minimal implementation**

在 `devloop/cli.py` 頂部 import 區新增:

```python
from devloop.changemeta import load_change_meta
from devloop.units import build_units
from devloop.worktree import add_worktree
```

新增指令函式(放在 `_cmd_archive` 之後):

```python
def _cmd_units_init(args):
    cp = Checkpoint.load(args.file)
    meta = load_change_meta(args.meta)
    units = build_units(meta.parallel_groups, cp.branch, args.wt_root)
    if not units:
        cp.units = []
        cp.save(args.file)
        print("units-init: serial")
        return 0
    for u in units:
        base = cp.branch if _branch_exists(args.repo, cp.branch) else "HEAD"
        add_worktree(args.repo, u["worktree"], u["branch"], base)
    cp.units = units
    cp.save(args.file)
    print("units-init: %d units" % len(units))
    return 0


def _branch_exists(repo, branch):
    r = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", branch],
        capture_output=True, text=True,
    )
    return r.returncode == 0
```

在 `build_parser` 內 `p_archive` 之後新增 sub-parser:

```python
    p_ui = sub.add_parser("units-init")
    p_ui.add_argument("--file", required=True)
    p_ui.add_argument("--repo", required=True)
    p_ui.add_argument("--meta", required=True)
    p_ui.add_argument("--wt-root", dest="wt_root", required=True)
    p_ui.set_defaults(func=_cmd_units_init)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k units_init -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): units-init 建立平行 worktree"
```

---

### Task 6: CLI `unit-done`

標記某 unit 完成。

**Files:**
- Modify: `devloop/cli.py`(`_cmd_unit_done` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `mark`(T3)、`Checkpoint`(T2)。
- Produces: 子命令 `unit-done --file <cp> --id <unit-id>`;將該 unit status 設 `done`,印 `unit-done: <id>`。未知 id → 回 2 + stderr。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_unit_done_marks_done(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"},
                      {"id": "g2", "status": "pending"}]).save(cp_path)
    rc = main(["unit-done", "--file", str(cp_path), "--id", "g1"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.units[0]["status"] == "done"
    assert cp.units[1]["status"] == "pending"


def test_unit_done_unknown_id(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    rc = main(["unit-done", "--file", str(cp_path), "--id", "zzz"])
    assert rc == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k unit_done -v`
Expected: FAIL(`invalid choice: 'unit-done'`)

- [ ] **Step 3: Write minimal implementation**

`cli.py` import 區的 `from devloop.units import build_units` 改為:

```python
from devloop.units import build_units, mark
```

新增函式:

```python
def _cmd_unit_done(args):
    cp = Checkpoint.load(args.file)
    try:
        mark(cp.units, args.id, "done")
    except KeyError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    cp.save(args.file)
    print("unit-done: %s" % args.id)
    return 0
```

sub-parser:

```python
    p_ud = sub.add_parser("unit-done")
    p_ud.add_argument("--file", required=True)
    p_ud.add_argument("--id", required=True)
    p_ud.set_defaults(func=_cmd_unit_done)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k unit_done -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): unit-done 標記單元完成"
```

---

### Task 7: CLI `units-merge`

依序把 done 的 unit 分支合並回短命分支;衝突標 `conflict`。

**Files:**
- Modify: `devloop/cli.py`(`_cmd_units_merge` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `merge_branch`/`MergeResult`(T4)、`mark`(T3)、`Checkpoint`(T2)。
- Produces: 子命令 `units-merge --file <cp> --repo <repo>`。對每個 status==done 的 unit:先 checkout 短命分支(`git -C repo checkout <branch>`),`merge_branch`;成功→status `merged`;衝突→status `conflict`。全部處理完:若有 conflict 回 1 並印衝突 unit；否則回 0。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_units_merge_success(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    # 手動建兩個不衝突的 unit 分支
    for gid, fname in (("g1", "g1.txt"), ("g2", "g2.txt")):
        wt = repo / (".devloop/wt/" + gid)
        from devloop.worktree import add_worktree
        add_worktree(repo, wt, "loop/x-" + gid, "loop/x")
        (wt / fname).write_text(gid + "\n")
        _git(wt, "add", "."); _git(wt, "commit", "-m", gid)
    cp = Checkpoint.load(cp_path)
    cp.units = [
        {"id": "g1", "worktree": str(repo / ".devloop/wt/g1"), "branch": "loop/x-g1", "status": "done"},
        {"id": "g2", "worktree": str(repo / ".devloop/wt/g2"), "branch": "loop/x-g2", "status": "done"},
    ]
    cp.save(cp_path)
    rc = main(["units-merge", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert all(u["status"] == "merged" for u in cp.units)
    assert (repo / "g1.txt").exists() and (repo / "g2.txt").exists()


def test_units_merge_conflict_marks_unit(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    (wt / "base.txt").write_text("g1\n"); _git(wt, "add", "."); _git(wt, "commit", "-m", "g1")
    # 短命分支也改 base.txt → 衝突
    (repo / "base.txt").write_text("main\n"); _git(repo, "add", "."); _git(repo, "commit", "-m", "main")
    cp = Checkpoint.load(cp_path)
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "done"}]
    cp.save(cp_path)
    rc = main(["units-merge", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 1
    assert Checkpoint.load(cp_path).units[0]["status"] == "conflict"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k units_merge -v`
Expected: FAIL(`invalid choice: 'units-merge'`)

- [ ] **Step 3: Write minimal implementation**

import 區新增:

```python
from devloop.worktree import add_worktree, merge_branch, remove_worktree, list_worktree_paths
```

(把 T5 既有的 `from devloop.worktree import add_worktree` 這行替換成上面這行,避免重複 import。)

新增函式:

```python
def _cmd_units_merge(args):
    cp = Checkpoint.load(args.file)
    subprocess.run(["git", "-C", str(args.repo), "checkout", cp.branch],
                   capture_output=True, text=True)
    conflicts = []
    for u in cp.units:
        if u["status"] != "done":
            continue
        res = merge_branch(args.repo, u["branch"])
        u["status"] = "merged" if res.ok else "conflict"
        if not res.ok:
            conflicts.append(u["id"])
    cp.save(args.file)
    if conflicts:
        print("units-merge: conflict in %s" % ", ".join(conflicts))
        return 1
    print("units-merge: all merged")
    return 0
```

sub-parser:

```python
    p_um = sub.add_parser("units-merge")
    p_um.add_argument("--file", required=True)
    p_um.add_argument("--repo", required=True)
    p_um.set_defaults(func=_cmd_units_merge)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k units_merge -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): units-merge 依序合並 + 衝突標記"
```

---

### Task 8: CLI `units-cleanup`(含孤兒對賬)

移除已 merged 的 worktree;清掉 checkpoint 沒記的孤兒 worktree。

**Files:**
- Modify: `devloop/cli.py`(`_cmd_units_cleanup` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `remove_worktree`/`list_worktree_paths`(T4)、`Checkpoint`(T2)。
- Produces: 子命令 `units-cleanup --file <cp> --repo <repo>`。對 status==merged 的 unit:`remove_worktree`。對 `list_worktree_paths` 回的、不在 checkpoint.units 任何 worktree 的路徑(孤兒):`git -C repo worktree remove --force <path>`。印移除數。回 0。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_units_cleanup_removes_merged(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="loop/x")
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "merged"}]
    cp.save(cp_path)
    rc = main(["units-cleanup", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 0
    assert not wt.exists()


def test_units_cleanup_removes_orphan(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    orphan = repo / ".devloop/wt/ghost"
    add_worktree(repo, orphan, "loop/x-ghost", "loop/x")  # checkpoint 不記
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x", units=[]).save(cp_path)
    rc = main(["units-cleanup", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 0
    assert not orphan.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k units_cleanup -v`
Expected: FAIL(`invalid choice: 'units-cleanup'`)

- [ ] **Step 3: Write minimal implementation**

```python
def _cmd_units_cleanup(args):
    cp = Checkpoint.load(args.file)
    removed = 0
    known = set()
    for u in cp.units:
        known.add(str(Path(u["worktree"]).resolve()))
        if u["status"] == "merged":
            remove_worktree(args.repo, u["worktree"], u["branch"])
            removed += 1
    for p in list_worktree_paths(args.repo):
        if p not in known:
            subprocess.run(["git", "-C", str(args.repo), "worktree", "remove", "--force", p],
                           capture_output=True, text=True)
            removed += 1
    cp.save(args.file)
    print("units-cleanup: removed %d" % removed)
    return 0
```

sub-parser:

```python
    p_uc = sub.add_parser("units-cleanup")
    p_uc.add_argument("--file", required=True)
    p_uc.add_argument("--repo", required=True)
    p_uc.set_defaults(func=_cmd_units_cleanup)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k units_cleanup -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): units-cleanup 移除 merged + 孤兒 worktree"
```

---

### Task 9: CLI `units-status`(續跑對賬報告)

讓被續跑的 agent 一眼看出還要 spawn 哪些 unit。

**Files:**
- Modify: `devloop/cli.py`(`_cmd_units_status` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `pending_units`(T3)、`Checkpoint`(T2)。
- Produces: 子命令 `units-status --file <cp>`。印每個 unit `id status`,最後一行 `pending: <id1>,<id2>`(逗號分隔,空則 `pending: -`)。回 0。供續跑時讀「pending」清單只重 spawn 未完成的。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
import io
from contextlib import redirect_stdout


def test_units_status_lists_pending(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b", units=[
        {"id": "g1", "status": "merged"},
        {"id": "g2", "status": "pending"},
        {"id": "g3", "status": "in_progress"},
    ]).save(cp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = main(["units-status", "--file", str(cp_path)])
    assert rc == 0
    out = buf.getvalue()
    assert "pending: g2,g3" in out


def test_units_status_none_pending(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "merged"}]).save(cp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = main(["units-status", "--file", str(cp_path)])
    assert "pending: -" in buf.getvalue()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k units_status -v`
Expected: FAIL(`invalid choice: 'units-status'`)

- [ ] **Step 3: Write minimal implementation**

import 區 `from devloop.units import build_units, mark` 改為:

```python
from devloop.units import build_units, mark, pending_units
```

新增函式:

```python
def _cmd_units_status(args):
    cp = Checkpoint.load(args.file)
    for u in cp.units:
        print("%s %s" % (u["id"], u["status"]))
    pend = [u["id"] for u in pending_units(cp.units)]
    print("pending: %s" % (",".join(pend) if pend else "-"))
    return 0
```

sub-parser:

```python
    p_us = sub.add_parser("units-status")
    p_us.add_argument("--file", required=True)
    p_us.set_defaults(func=_cmd_units_status)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k units_status -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): units-status 續跑對賬報告"
```

---

### Task 10: 全套測試 + SKILL.md 編排更新 + 同步全域 skill

收束:跑全套測試、把 Apply/Fix 平行編排寫進 SKILL.md、同步引擎到全域 skill 目錄。

**Files:**
- Modify: `~/.claude/skills/dev-loop/SKILL.md`(Apply 步驟新增平行編排說明)
- Modify: `README.md`(引擎 CLI 表格新增 `units-*` 列)
- Sync: `devloop/*.py` → `~/.claude/skills/dev-loop/engine/devloop/`

**Interfaces:**
- Consumes: 全部前述子命令。
- Produces: 無新程式碼;文件 + 同步。

- [ ] **Step 1: 跑全套測試確認全綠**

Run: `python3 -m pytest -q`
Expected: 全 PASS(含既有 + 新增約 20+ 測試)

- [ ] **Step 2: 更新 SKILL.md 的 Apply 步驟**

在 `~/.claude/skills/dev-loop/SKILL.md` 的「4. Apply(Sonnet · TDD)」段落,改寫為(保留原串行說明,新增平行分支):

```markdown
4. **Apply(Sonnet · TDD)**:
   - **判斷平行**:讀 `.devloop/changes/<change-id>.json` 的 `parallel_groups`。
   - **串行**(0 或 1 群):逐 task red→green→refactor(同 v1)。
   - **平行**(≥2 群):
     1. `python3 -m devloop.cli units-init --file .devloop/checkpoint.json --repo . --meta .devloop/changes/<id>.json --wt-root .devloop/wt`
     2. 對每個 unit,dispatch 一個 Sonnet subagent 在其 `worktree` 上做該群 tasks(TDD);完成後該 subagent 回報,主編排呼叫 `unit-done --id <gid>`。
     3. 全部 done 後:`units-merge --file ... --repo .`。exit 1(衝突)→ 對 conflict 的 unit **退串行**:在最新短命分支 HEAD 重做該群 tasks,再 `units-merge`。
     4. `units-cleanup --file ... --repo .` 清掉 worktree。
   - **續跑**:reset 後讀 `units-status`,只對 `pending:` 清單的 unit 重新 dispatch subagent。
   - 完成後 `event --event apply_done`。
```

並在「每個 checkpoint 後 arm」清單補一句:`units-init`/`unit-done`/`units-merge` 之後同樣要確保觸發器在位(它們都寫 checkpoint)。

- [ ] **Step 3: 更新 README.md CLI 表格**

在 `README.md` 的引擎 CLI 表格(`| 子命令 | 作用 |`)新增列:

```markdown
| `units-init --repo <r> --meta <json> --wt-root <d>` | 依平行群建 worktree + 寫 units |
| `unit-done --id <gid>` | 標記平行單元完成 |
| `units-merge --repo <r>` | 依序合並 unit 分支;衝突標記退串行 |
| `units-cleanup --repo <r>` | 移除 merged + 孤兒 worktree |
| `units-status` | 印各單元狀態 + pending 清單(續跑用) |
```

- [ ] **Step 4: 同步引擎到全域 skill**

Run: `cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`
Expected: 無輸出(成功)。接著驗證:`python3 -m pytest -q` 仍全綠。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README + SKILL Apply 平行編排;同步全域 skill"
```

(SKILL.md 在 `~/.claude/` 不在本 repo,不納入 commit;若使用者有 dotfiles repo 另行處理。)

---

## Self-Review

**1. Spec coverage**(對照 spec §4、§5、§10):
- checkpoint `units[]`/`review_legs[]` 擴充 → Task 2 ✓(`review_legs` 欄位本計畫建立,實際消費在第 2 份計畫)
- `.devloop/changes/<id>.json` 標注讀取 → Task 1 ✓
- `units-init/unit-done/units-merge/units-cleanup` → Task 5/6/7/8 ✓
- worktree 生命週期 → Task 4 ✓
- 衝突退串行 → Task 7(標 conflict)+ SKILL.md 編排(Task 10 退串行說明)✓
- 續跑對賬(只重 spawn pending + 孤兒清理)→ Task 9(pending 清單)+ Task 8(孤兒)✓
- 向後相容(無 groups→串行)→ Task 1 `is_serial` + Task 5 serial 分支 ✓

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 均含完整實作。

**3. Type consistency:** unit dict 鍵 `{id,tasks,worktree,branch,status}` 在 T3 定義,T5–T9 一致使用;`MergeResult(ok,conflict,output)` T4 定義、T7 使用 `.ok`;`ChangeMeta` 欄位 T1 定義、T5 使用 `.parallel_groups`。一致。

> **註(scope)**:`review_legs` 的 `legs-init/leg-done` 子命令與消費屬第 2 份計畫(新審查階段);本計畫只建立 checkpoint 欄位以利序列化相容。

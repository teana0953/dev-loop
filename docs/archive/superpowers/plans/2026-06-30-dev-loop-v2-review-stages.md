> **歷史實作計畫(point-in-time)**:該輪執行完成即凍結,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop v2 新審查階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 dev-loop 狀態機加入 Proposal Review(提案自動 review 修到乾淨)與 QA Gate(行為驗證),把 Review 階段拆成 code‖uiux 平行 legs 並彙總,並補上第 1 份並行基建遺留的 conflict 狀態清除 / units-init 冪等 / in_progress 可達。

**Architecture:** 延續「確定性狀態機 + checkpoint + stdlib-only 引擎;判斷與換 model 由 skill 編排」。本份擴充 `statemachine.py`(新增 proposal_review、qa phase 與轉移)、`review.py`(qa / proposal 分類 + 多 leg 彙總)、`cli.py`(proposal-review / qa / legs-init / leg-done / unit-resolve / unit-claim 子命令 + review 彙總)。

**Tech Stack:** Python 3.9+(stdlib only)、git(subprocess,沿用第 1 份 worktree.py)、pytest(僅測試)。

**Base:** 第 1 份「並行基建」已 merge 回 main(merge commit 506e27c)。本份以 main 為基線。

## Global Constraints

- **stdlib-only**:引擎執行期不得引入第三方套件;pytest 僅用於測試。
- **Python 3.9+**:相容語法(可用 `from __future__ import annotations`)。
- **確定性**:引擎不做判斷、不換 model;所有狀態落在 checkpoint JSON。
- **向後相容**:`start` 預設 `--phase apply`(等同 v1);舊 checkpoint 無新欄位時走既有路徑。
- **報告格式**:沿用 `{"findings":[{"severity":"blocking|non_blocking","level":"...","note":"..."}]}`。QA 報告 level 用 `behavior`;proposal review level 用 `proposal`/`design`;code/uiux review level 用 `code`/`proposal`。
- **iteration 計數**:內圈為 `gate → qa → review → fix`;在 `gate_pass` 進入 `qa` 時 `iteration+1`,超過 `max_iterations`(預設 3)→ `escalated`。
- **檔案編碼**:讀寫 JSON 一律 `encoding="utf-8"`、`ensure_ascii=False`。
- **測試模式**:每個模組對應 `tests/test_<module>.py`;git 相關用 `tmp_path` 臨時 repo。
- **同步全域 skill**:引擎改完後 `cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`(最後一個 task)。

---

## Part A — 並行收尾(承接第 1 份的最終 review gap)

### Task 1: `unit-resolve`(conflict → merged 退串行收尾)

第 1 份的 `units-merge` 把衝突 unit 標 `conflict`,但無路徑讓它離開該狀態。「退串行」在短命分支重做該群後,需把 unit 標為 merged 並清其 worktree,流程才能繼續。

**Files:**
- Modify: `devloop/cli.py`(新增 `_cmd_unit_resolve` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `mark`(units.py)、`remove_worktree`(worktree.py)、`Checkpoint`。
- Produces: 子命令 `unit-resolve --file <cp> --repo <repo> --id <unit-id>`。將該 unit status 設 `merged`,並 `remove_worktree(repo, worktree, branch)` 清掉其 worktree(退串行已在短命分支重做完成)。未知 id → stderr + return 2。印 `unit-resolve: <id> merged`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_unit_resolve_marks_merged_and_removes_worktree(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="loop/x")
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "conflict"}]
    cp.save(cp_path)
    rc = main(["unit-resolve", "--file", str(cp_path), "--repo", str(repo), "--id", "g1"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.units[0]["status"] == "merged"
    assert not wt.exists()


def test_unit_resolve_unknown_id(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "conflict"}]).save(cp_path)
    rc = main(["unit-resolve", "--file", str(cp_path), "--repo", str(repo), "--id", "zzz"])
    assert rc == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k unit_resolve -v`
Expected: FAIL(`invalid choice: 'unit-resolve'`)

- [ ] **Step 3: Write minimal implementation**

新增函式(放在 `_cmd_units_cleanup` 之後):

```python
def _cmd_unit_resolve(args):
    cp = Checkpoint.load(args.file)
    target = None
    for u in cp.units:
        if u["id"] == args.id:
            target = u
            break
    if target is None:
        print("error: no unit %r" % args.id, file=sys.stderr)
        return 2
    remove_worktree(args.repo, target["worktree"], target["branch"])
    target["status"] = "merged"
    cp.save(args.file)
    print("unit-resolve: %s merged" % args.id)
    return 0
```

sub-parser(放在 `units-cleanup` 之後):

```python
    p_ur = sub.add_parser("unit-resolve")
    p_ur.add_argument("--file", required=True)
    p_ur.add_argument("--repo", required=True)
    p_ur.add_argument("--id", required=True)
    p_ur.set_defaults(func=_cmd_unit_resolve)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k unit_resolve -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): unit-resolve 衝突 unit 退串行收尾"
```

---

### Task 2: units-init 冪等 + `unit-claim`(in_progress 可達)

兩個小修:(a) `units-init` 對已存在的 worktree 跳過而非報錯(crash 後可重跑);(b) 新增 `unit-claim` 把 unit 標 `in_progress`,讓平行 dispatch 時可標記進行中,使續跑對賬精確。

**Files:**
- Modify: `devloop/cli.py`(`_cmd_units_init` 加冪等判斷;新增 `_cmd_unit_claim` + sub-parser)
- Modify: `devloop/worktree.py`(新增 `worktree_exists(repo, path) -> bool`)
- Test: `tests/test_cli.py`、`tests/test_worktree.py`(append)

**Interfaces:**
- Consumes: `mark`、`list_worktree_paths`、`Checkpoint`。
- Produces:
  - `worktree.worktree_exists(repo, path) -> bool`(path 的 resolved 絕對路徑在 `list_worktree_paths(repo)` 中)
  - `units-init`:建 worktree 前若 `worktree_exists` 則跳過該 unit 的 `add_worktree`(其餘不變)。
  - 子命令 `unit-claim --file <cp> --id <id>`:status 設 `in_progress`;未知 id → stderr + 2;印 `unit-claim: <id>`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_worktree.py  (append)
def test_worktree_exists(repo, tmp_path):
    from devloop.worktree import add_worktree, worktree_exists
    wt = tmp_path / "wt-g1"
    assert worktree_exists(repo, wt) is False
    add_worktree(repo, wt, "loop-g1", "main")
    assert worktree_exists(repo, wt) is True
```

```python
# tests/test_cli.py  (append)
def test_units_init_idempotent_skips_existing(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": [
        {"id": "g1", "tasks": ["1"]}, {"id": "g2", "tasks": ["2"]},
    ]}), encoding="utf-8")
    wt_root = repo / ".devloop/wt"
    # 預先建立 g1 的 worktree,模擬 crash 後重跑
    from devloop.worktree import add_worktree
    add_worktree(repo, wt_root / "g1", "loop/x-g1", "loop/x")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(wt_root)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert [u["id"] for u in cp.units] == ["g1", "g2"]
    assert (wt_root / "g2").exists()


def test_unit_claim_marks_in_progress(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    rc = main(["unit-claim", "--file", str(cp_path), "--id", "g1"])
    assert rc == 0
    assert Checkpoint.load(cp_path).units[0]["status"] == "in_progress"


def test_unit_claim_unknown_id(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    assert main(["unit-claim", "--file", str(cp_path), "--id", "zzz"]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_worktree.py -k worktree_exists tests/test_cli.py -k "units_init_idempotent or unit_claim" -v`
Expected: FAIL(`worktree_exists` 未定義;`invalid choice: 'unit-claim'`)

- [ ] **Step 3: Write minimal implementation**

`devloop/worktree.py` 新增(放在 `list_worktree_paths` 之後):

```python
def worktree_exists(repo, path) -> bool:
    return str(Path(path).resolve()) in list_worktree_paths(repo)
```

`devloop/cli.py`:import 區 worktree 行加入 `worktree_exists`:

```python
from devloop.worktree import add_worktree, merge_branch, remove_worktree, list_worktree_paths, worktree_exists
```

`_cmd_units_init` 內,建 worktree 的迴圈改為冪等(`add_worktree` 前判斷):

```python
    base = cp.branch if _branch_exists(args.repo, cp.branch) else "HEAD"
    for u in units:
        if not worktree_exists(args.repo, u["worktree"]):
            add_worktree(args.repo, u["worktree"], u["branch"], base)
```

新增 `_cmd_unit_claim`(放在 `_cmd_unit_done` 之後):

```python
def _cmd_unit_claim(args):
    cp = Checkpoint.load(args.file)
    try:
        mark(cp.units, args.id, "in_progress")
    except KeyError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    cp.save(args.file)
    print("unit-claim: %s" % args.id)
    return 0
```

sub-parser(放在 `unit-done` 之後):

```python
    p_ucl = sub.add_parser("unit-claim")
    p_ucl.add_argument("--file", required=True)
    p_ucl.add_argument("--id", required=True)
    p_ucl.set_defaults(func=_cmd_unit_claim)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_worktree.py tests/test_cli.py -k "worktree_exists or units_init or unit_claim" -v`
Expected: PASS(含既有 units_init 測試)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py devloop/worktree.py tests/test_cli.py tests/test_worktree.py
git commit -m "feat(cli): units-init 冪等 + unit-claim(in_progress 可達)"
```

---

## Part B — QA Gate

### Task 3: 狀態機加入 `qa` phase(iteration 計數搬移)

把內圈從 `gate→review` 改為 `gate→qa→review`。**這是破壞性改動**:iteration 的 +1 點從「gate_pass 進 review」搬到「gate_pass 進 qa」,既有 statemachine 測試需同步更新。

**Files:**
- Modify: `devloop/statemachine.py`(PHASES、events、transition)
- Test: `tests/test_statemachine.py`(更新既有 gate_pass 測試 + 新增 qa 測試)

**Interfaces:**
- Consumes: 無。
- Produces:
  - PHASES 新增 `"qa"`。
  - 新 events:`QA_PASS = "qa_pass"`、`QA_FAIL = "qa_fail"`。
  - transition 改動:
    - `gate` + `GATE_PASS` → `("qa", iteration+1)`(超上限 → `("escalated", iteration+1)`)
    - `qa` + `QA_PASS` → `("review", iteration)`(iteration 不變)
    - `qa` + `QA_FAIL` → `("fix", iteration)`
    - `review`/`fix` 轉移不變。

- [ ] **Step 1: Update existing tests + write new failing tests**

在 `tests/test_statemachine.py`:把既有兩個 gate_pass 測試改為進 `qa`,並新增 qa 測試。

```python
# 改既有 test_gate_pass_enters_review_and_increments_iteration → 改名 + 改斷言:
def test_gate_pass_enters_qa_and_increments_iteration():
    assert transition("gate", 0, GATE_PASS) == ("qa", 1)

# 改既有 test_gate_pass_within_limit_enters_review:
def test_gate_pass_within_limit_enters_qa():
    assert transition("gate", 2, GATE_PASS, max_iterations=3) == ("qa", 3)

# test_gate_pass_exceeding_limit_escalates 保持(仍 escalated):
def test_gate_pass_exceeding_limit_escalates():
    assert transition("gate", 3, GATE_PASS, max_iterations=3) == ("escalated", 4)

# 新增:
from devloop.statemachine import QA_PASS, QA_FAIL  # 加到 import

def test_qa_pass_enters_review_without_incrementing():
    assert transition("qa", 2, QA_PASS) == ("review", 2)

def test_qa_fail_goes_to_fix():
    assert transition("qa", 2, QA_FAIL) == ("fix", 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_statemachine.py -v`
Expected: FAIL(`cannot import name 'QA_PASS'`;gate_pass 測試斷言 `qa` 失敗)

- [ ] **Step 3: Write minimal implementation**

`devloop/statemachine.py`:PHASES 在 `"gate"` 後插入 `"qa"`:

```python
PHASES = (
    "brainstorm", "propose", "apply", "gate", "qa", "review",
    "fix", "merge", "escalated", "done",
)
```

events 區新增:

```python
QA_PASS = "qa_pass"
QA_FAIL = "qa_fail"
```

transition:把 `gate`+`GATE_PASS` 分支由進 review 改為進 qa,並新增 qa 分支:

```python
    if phase == "gate" and event == GATE_PASS:
        new_iteration = iteration + 1
        if new_iteration > max_iterations:
            return ("escalated", new_iteration)
        return ("qa", new_iteration)
    if phase == "qa" and event == QA_PASS:
        return ("review", iteration)
    if phase == "qa" and event == QA_FAIL:
        return ("fix", iteration)
```

(更新 transition docstring:iteration 在 gate_pass 進入 qa 時 +1。)

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_statemachine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add devloop/statemachine.py tests/test_statemachine.py
git commit -m "feat(statemachine): 內圈插入 qa phase(gate→qa→review)"
```

---

### Task 4: `review.py` QA 分類

**Files:**
- Modify: `devloop/review.py`(新增 `classify_qa`)
- Test: `tests/test_review.py`(append)

**Interfaces:**
- Consumes: `QA_PASS`、`QA_FAIL`(statemachine)。
- Produces:`classify_qa(findings) -> str`:任一 `severity=="blocking"` → `QA_FAIL`;否則 `QA_PASS`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_review.py  (append)
from devloop.review import classify_qa
from devloop.statemachine import QA_PASS, QA_FAIL


def test_classify_qa_blocking_fails():
    findings = [{"severity": "blocking", "level": "behavior", "note": "crash on empty input"}]
    assert classify_qa(findings) == QA_FAIL


def test_classify_qa_no_blocking_passes():
    findings = [{"severity": "non_blocking", "level": "behavior", "note": "slow"}]
    assert classify_qa(findings) == QA_PASS


def test_classify_qa_empty_passes():
    assert classify_qa([]) == QA_PASS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_review.py -k classify_qa -v`
Expected: FAIL(`cannot import name 'classify_qa'`)

- [ ] **Step 3: Write minimal implementation**

`devloop/review.py`:import 區加入 `QA_PASS, QA_FAIL`,新增函式:

```python
from devloop.statemachine import (
    QA_FAIL,
    QA_PASS,
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
)


def classify_qa(findings):
    """QA 報告分類:任一 blocking → QA_FAIL;否則 QA_PASS。"""
    if any(f.get("severity") == "blocking" for f in findings):
        return QA_FAIL
    return QA_PASS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_review.py -k classify_qa -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/review.py tests/test_review.py
git commit -m "feat(review): classify_qa QA 報告分類"
```

---

### Task 5: CLI `qa` 子命令

**Files:**
- Modify: `devloop/cli.py`(`_cmd_qa` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `classify_qa`、`parse_review_report`、`non_blocking_notes`、`Checkpoint`、`_apply_event`。
- Produces: 子命令 `qa --file <cp> --report <json> [--max N]`。從 phase=qa 套用 `classify_qa` 的事件;累積 non_blocking;印 `phase=.. iteration=..`。pass → review,fail → fix。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_qa_pass_advances_to_review(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="qa", change_id="c", branch="b", iteration=1).save(cp_path)
    report = tmp_path / "qa.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "non_blocking", "level": "behavior", "note": "slow"}]}), encoding="utf-8")
    rc = main(["qa", "--file", str(cp_path), "--report", str(report)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.phase == "review"
    assert "slow" in cp.non_blocking


def test_qa_fail_goes_to_fix(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="qa", change_id="c", branch="b", iteration=1).save(cp_path)
    report = tmp_path / "qa.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "behavior", "note": "crash"}]}), encoding="utf-8")
    rc = main(["qa", "--file", str(cp_path), "--report", str(report)])
    assert rc == 0
    assert Checkpoint.load(cp_path).phase == "fix"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k "qa_pass or qa_fail" -v`
Expected: FAIL(`invalid choice: 'qa'`)

- [ ] **Step 3: Write minimal implementation**

`cli.py`:import 區 review 行加入 `classify_qa`:

```python
from devloop.review import classify, classify_qa, non_blocking_notes, parse_review_report
```

新增函式(放在 `_cmd_review` 之後):

```python
def _cmd_qa(args):
    cp = Checkpoint.load(args.file)
    findings = parse_review_report(args.report)
    cp.non_blocking.extend(non_blocking_notes(findings))
    event = classify_qa(findings)
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0
```

sub-parser(放在 `review` 之後):

```python
    p_qa = sub.add_parser("qa")
    p_qa.add_argument("--file", required=True)
    p_qa.add_argument("--report", required=True)
    p_qa.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_qa.set_defaults(func=_cmd_qa)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k "qa_pass or qa_fail" -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): qa 子命令(行為驗證分級)"
```

---

## Part C — Proposal Review

### Task 6: 狀態機加入 `proposal_review` phase + `start --phase`

**Files:**
- Modify: `devloop/statemachine.py`(PHASES、events、transition)
- Modify: `devloop/cli.py`(`_cmd_start` 支援 `--phase`)
- Test: `tests/test_statemachine.py`、`tests/test_cli.py`(append)

**Interfaces:**
- Consumes: 無。
- Produces:
  - PHASES 新增 `"proposal_review"`(置於 `"propose"` 後)。
  - 新 events:`PROPOSE_CLEAN = "propose_clean"`、`PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal"`、`PROPOSE_BLOCKING_DESIGN = "propose_blocking_design"`。
  - transition 新增:
    - `proposal_review` + `PROPOSE_CLEAN` → `("apply", iteration)`
    - `proposal_review` + `PROPOSE_BLOCKING_PROPOSAL` → `("propose", iteration)`
    - `proposal_review` + `PROPOSE_BLOCKING_DESIGN` → `("escalated", iteration)`
  - `start --phase <p>`(預設 `apply`):checkpoint 初始 phase 可設為 `proposal_review`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_statemachine.py  (append; 加到 import)
from devloop.statemachine import (
    PROPOSE_CLEAN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_BLOCKING_DESIGN,
)


def test_proposal_review_clean_to_apply():
    assert transition("proposal_review", 0, PROPOSE_CLEAN) == ("apply", 0)


def test_proposal_review_blocking_proposal_to_propose():
    assert transition("proposal_review", 0, PROPOSE_BLOCKING_PROPOSAL) == ("propose", 0)


def test_proposal_review_blocking_design_escalates():
    assert transition("proposal_review", 0, PROPOSE_BLOCKING_DESIGN) == ("escalated", 0)
```

```python
# tests/test_cli.py  (append)
def test_start_with_phase_proposal_review(tmp_path):
    cp_path = tmp_path / "cp.json"
    rc = main(["start", "--file", str(cp_path), "--change-id", "c",
               "--branch", "loop/x", "--phase", "proposal_review"])
    assert rc == 0
    assert Checkpoint.load(cp_path).phase == "proposal_review"


def test_start_defaults_phase_apply(tmp_path):
    cp_path = tmp_path / "cp.json"
    main(["start", "--file", str(cp_path), "--change-id", "c", "--branch", "loop/x"])
    assert Checkpoint.load(cp_path).phase == "apply"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_statemachine.py -k proposal_review tests/test_cli.py -k "start_with_phase or start_defaults" -v`
Expected: FAIL(`cannot import name 'PROPOSE_CLEAN'`;`unrecognized arguments: --phase`)

- [ ] **Step 3: Write minimal implementation**

`statemachine.py`:PHASES 在 `"propose"` 後插入 `"proposal_review"`:

```python
PHASES = (
    "brainstorm", "propose", "proposal_review", "apply", "gate", "qa",
    "review", "fix", "merge", "escalated", "done",
)
```

events 新增:

```python
PROPOSE_CLEAN = "propose_clean"
PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal"
PROPOSE_BLOCKING_DESIGN = "propose_blocking_design"
```

transition 新增(放在 apply 分支前):

```python
    if phase == "proposal_review" and event == PROPOSE_CLEAN:
        return ("apply", iteration)
    if phase == "proposal_review" and event == PROPOSE_BLOCKING_PROPOSAL:
        return ("propose", iteration)
    if phase == "proposal_review" and event == PROPOSE_BLOCKING_DESIGN:
        return ("escalated", iteration)
```

`cli.py` `_cmd_start`:加入 phase 參數;sub-parser 加 `--phase`:

```python
def _cmd_start(args):
    cp = Checkpoint(
        phase=args.phase,
        change_id=args.change_id,
        branch=args.branch,
        resume_exec=args.resume_exec,
    )
    cp.save(args.file)
    return 0
```

在 `p_start` 區塊加(其餘 add_argument 不變):

```python
    p_start.add_argument("--phase", default="apply")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_statemachine.py tests/test_cli.py -k "proposal_review or start_with_phase or start_defaults" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add devloop/statemachine.py devloop/cli.py tests/test_statemachine.py tests/test_cli.py
git commit -m "feat(statemachine): proposal_review phase + start --phase"
```

---

### Task 7: `review.py` proposal 分類

**Files:**
- Modify: `devloop/review.py`(新增 `classify_proposal`)
- Test: `tests/test_review.py`(append)

**Interfaces:**
- Consumes: `PROPOSE_CLEAN`、`PROPOSE_BLOCKING_PROPOSAL`、`PROPOSE_BLOCKING_DESIGN`(statemachine)。
- Produces:`classify_proposal(findings) -> str`:blocking 中任一 `level=="design"` → `PROPOSE_BLOCKING_DESIGN`;否則有 blocking → `PROPOSE_BLOCKING_PROPOSAL`;無 blocking → `PROPOSE_CLEAN`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_review.py  (append)
from devloop.review import classify_proposal
from devloop.statemachine import (
    PROPOSE_CLEAN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_BLOCKING_DESIGN,
)


def test_classify_proposal_clean():
    assert classify_proposal([{"severity": "non_blocking", "level": "proposal", "note": "x"}]) == PROPOSE_CLEAN


def test_classify_proposal_blocking_proposal():
    findings = [{"severity": "blocking", "level": "proposal", "note": "scope too big"}]
    assert classify_proposal(findings) == PROPOSE_BLOCKING_PROPOSAL


def test_classify_proposal_blocking_design_takes_precedence():
    findings = [
        {"severity": "blocking", "level": "proposal", "note": "x"},
        {"severity": "blocking", "level": "design", "note": "wrong approach"},
    ]
    assert classify_proposal(findings) == PROPOSE_BLOCKING_DESIGN
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_review.py -k classify_proposal -v`
Expected: FAIL(`cannot import name 'classify_proposal'`)

- [ ] **Step 3: Write minimal implementation**

`review.py`:import 區加入三個 propose 事件,新增函式:

```python
def classify_proposal(findings):
    """Proposal review 分類:design 層 blocking 優先 → 升級;
    proposal 層 blocking → 回 propose;無 blocking → clean。"""
    blocking = [f for f in findings if f.get("severity") == "blocking"]
    if not blocking:
        return PROPOSE_CLEAN
    if any(f.get("level") == "design" for f in blocking):
        return PROPOSE_BLOCKING_DESIGN
    return PROPOSE_BLOCKING_PROPOSAL
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_review.py -k classify_proposal -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/review.py tests/test_review.py
git commit -m "feat(review): classify_proposal 提案 review 分類"
```

---

### Task 8: CLI `proposal-review` 子命令

**Files:**
- Modify: `devloop/cli.py`(`_cmd_proposal_review` + sub-parser)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `classify_proposal`、`parse_review_report`、`non_blocking_notes`、`_apply_event`、`Checkpoint`。
- Produces: 子命令 `proposal-review --file <cp> --report <json> [--max N]`。從 phase=proposal_review 套用 `classify_proposal` 事件;累積 non_blocking;印 `phase=.. iteration=..`。clean → apply,blocking_proposal → propose,blocking_design → escalated。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_proposal_review_clean_advances_to_apply(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="proposal_review", change_id="c", branch="b").save(cp_path)
    report = tmp_path / "pr.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "non_blocking", "level": "proposal", "note": "minor"}]}), encoding="utf-8")
    rc = main(["proposal-review", "--file", str(cp_path), "--report", str(report)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.phase == "apply"
    assert "minor" in cp.non_blocking


def test_proposal_review_blocking_design_escalates(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="proposal_review", change_id="c", branch="b").save(cp_path)
    report = tmp_path / "pr.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "design", "note": "wrong approach"}]}), encoding="utf-8")
    main(["proposal-review", "--file", str(cp_path), "--report", str(report)])
    assert Checkpoint.load(cp_path).phase == "escalated"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k proposal_review -v`
Expected: FAIL(`invalid choice: 'proposal-review'`)

- [ ] **Step 3: Write minimal implementation**

`cli.py`:import 區 review 行加入 `classify_proposal`:

```python
from devloop.review import classify, classify_proposal, classify_qa, non_blocking_notes, parse_review_report
```

新增函式(放在 `_cmd_qa` 之後):

```python
def _cmd_proposal_review(args):
    cp = Checkpoint.load(args.file)
    findings = parse_review_report(args.report)
    cp.non_blocking.extend(non_blocking_notes(findings))
    event = classify_proposal(findings)
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0
```

sub-parser(放在 `qa` 之後):

```python
    p_pr = sub.add_parser("proposal-review")
    p_pr.add_argument("--file", required=True)
    p_pr.add_argument("--report", required=True)
    p_pr.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_pr.set_defaults(func=_cmd_proposal_review)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k proposal_review -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): proposal-review 子命令(提案自動把關)"
```

---

## Part D — Review legs(code ‖ uiux 平行彙總)

### Task 9: `review.py` 多 leg 彙總

**Files:**
- Modify: `devloop/review.py`(新增 `aggregate_findings`)
- Test: `tests/test_review.py`(append)

**Interfaces:**
- Consumes: 無。
- Produces:`aggregate_findings(report_paths) -> list`:依序讀每個報告路徑(用 `parse_review_report`),把所有 findings 串接成一個 list。空清單 → `[]`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_review.py  (append)
from devloop.review import aggregate_findings


def test_aggregate_findings_concatenates(tmp_path):
    p1 = tmp_path / "code.json"
    p1.write_text(json.dumps({"findings": [{"severity": "blocking", "level": "code", "note": "bug"}]}), encoding="utf-8")
    p2 = tmp_path / "uiux.json"
    p2.write_text(json.dumps({"findings": [{"severity": "non_blocking", "level": "code", "note": "spacing"}]}), encoding="utf-8")
    merged = aggregate_findings([str(p1), str(p2)])
    assert len(merged) == 2
    assert merged[0]["note"] == "bug"
    assert merged[1]["note"] == "spacing"


def test_aggregate_findings_empty():
    assert aggregate_findings([]) == []
```

(`tests/test_review.py` 頂部若無 `import json`,加上。)

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_review.py -k aggregate -v`
Expected: FAIL(`cannot import name 'aggregate_findings'`)

- [ ] **Step 3: Write minimal implementation**

```python
def aggregate_findings(report_paths):
    """把多個 review 報告的 findings 串接成單一 list(供 code+uiux legs 彙總)。"""
    merged = []
    for path in report_paths:
        merged.extend(parse_review_report(path))
    return merged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_review.py -k aggregate -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/review.py tests/test_review.py
git commit -m "feat(review): aggregate_findings 多 leg 彙總"
```

---

### Task 10: CLI `legs-init` / `leg-done`

**Files:**
- Modify: `devloop/cli.py`(`_cmd_legs_init`、`_cmd_leg_done` + sub-parsers)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `Checkpoint`。
- Produces:
  - `legs-init --file <cp> --kinds code,uiux`:把 `cp.review_legs` 設為 `[{"kind":k,"status":"pending","report":""} for k in kinds]`(逗號分隔)。印 `legs-init: <n>`。
  - `leg-done --file <cp> --kind code --report <path>`:把對應 kind 的 leg status 設 `collected`、report 設 path。未知 kind → stderr + 2。印 `leg-done: <kind>`。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_legs_init_and_leg_done(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b").save(cp_path)
    rc = main(["legs-init", "--file", str(cp_path), "--kinds", "code,uiux"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert [l["kind"] for l in cp.review_legs] == ["code", "uiux"]
    assert all(l["status"] == "pending" for l in cp.review_legs)

    rc = main(["leg-done", "--file", str(cp_path), "--kind", "code", "--report", "/tmp/c.json"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    code_leg = [l for l in cp.review_legs if l["kind"] == "code"][0]
    assert code_leg["status"] == "collected"
    assert code_leg["report"] == "/tmp/c.json"


def test_leg_done_unknown_kind(tmp_path):
    cp_path = tmp_path / "cp.json"
    cp = Checkpoint(phase="review", change_id="c", branch="b")
    cp.review_legs = [{"kind": "code", "status": "pending", "report": ""}]
    cp.save(cp_path)
    assert main(["leg-done", "--file", str(cp_path), "--kind", "zzz", "--report", "/tmp/z.json"]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k "legs_init or leg_done" -v`
Expected: FAIL(`invalid choice: 'legs-init'`)

- [ ] **Step 3: Write minimal implementation**

新增函式(放在 `_cmd_proposal_review` 之後):

```python
def _cmd_legs_init(args):
    cp = Checkpoint.load(args.file)
    kinds = [k for k in args.kinds.split(",") if k]
    cp.review_legs = [{"kind": k, "status": "pending", "report": ""} for k in kinds]
    cp.save(args.file)
    print("legs-init: %d" % len(cp.review_legs))
    return 0


def _cmd_leg_done(args):
    cp = Checkpoint.load(args.file)
    for leg in cp.review_legs:
        if leg["kind"] == args.kind:
            leg["status"] = "collected"
            leg["report"] = args.report
            cp.save(args.file)
            print("leg-done: %s" % args.kind)
            return 0
    print("error: no leg %r" % args.kind, file=sys.stderr)
    return 2
```

sub-parsers(放在 `proposal-review` 之後):

```python
    p_li = sub.add_parser("legs-init")
    p_li.add_argument("--file", required=True)
    p_li.add_argument("--kinds", required=True)
    p_li.set_defaults(func=_cmd_legs_init)

    p_ld = sub.add_parser("leg-done")
    p_ld.add_argument("--file", required=True)
    p_ld.add_argument("--kind", required=True)
    p_ld.add_argument("--report", required=True)
    p_ld.set_defaults(func=_cmd_leg_done)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k "legs_init or leg_done" -v`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): legs-init/leg-done 唯讀型平行報告記帳"
```

---

### Task 11: CLI `review` 擴充吃 legs 彙總

**Files:**
- Modify: `devloop/cli.py`(`_cmd_review` 支援 `--from-legs`;sub-parser `--report` 改非必填 + 加 `--from-legs`)
- Test: `tests/test_cli.py`(append)

**Interfaces:**
- Consumes: `aggregate_findings`、`classify`、`non_blocking_notes`、`Checkpoint`。
- Produces:`review --file <cp> --from-legs`:從 `cp.review_legs` 收集所有 `status=="collected"` 的 report 路徑,`aggregate_findings` 彙總,再走既有 `classify` → 事件。`--report` 與 `--from-legs` 二擇一(都沒給 → stderr + 2)。既有 `review --report` 行為不變。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_cli.py  (append)
def test_review_from_legs_aggregates(tmp_path):
    cp_path = tmp_path / "cp.json"
    code_rep = tmp_path / "code.json"
    code_rep.write_text(json.dumps({"findings": [
        {"severity": "non_blocking", "level": "code", "note": "nit"}]}), encoding="utf-8")
    uiux_rep = tmp_path / "uiux.json"
    uiux_rep.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "code", "note": "contrast too low"}]}), encoding="utf-8")
    cp = Checkpoint(phase="review", change_id="c", branch="b", iteration=1)
    cp.review_legs = [
        {"kind": "code", "status": "collected", "report": str(code_rep)},
        {"kind": "uiux", "status": "collected", "report": str(uiux_rep)},
    ]
    cp.save(cp_path)
    rc = main(["review", "--file", str(cp_path), "--from-legs"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.phase == "fix"          # uiux blocking(code 層)→ fix
    assert "nit" in cp.non_blocking   # code leg 的 non_blocking 累積


def test_review_requires_report_or_legs(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(cp_path)
    assert main(["review", "--file", str(cp_path)]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_cli.py -k "review_from_legs or review_requires" -v`
Expected: FAIL(`unrecognized arguments: --from-legs` 或 review 仍要求 --report)

- [ ] **Step 3: Write minimal implementation**

`cli.py`:import 區 review 行加入 `aggregate_findings`:

```python
from devloop.review import (
    aggregate_findings, classify, classify_proposal, classify_qa,
    non_blocking_notes, parse_review_report,
)
```

改寫 `_cmd_review`:

```python
def _cmd_review(args):
    cp = Checkpoint.load(args.file)
    if args.from_legs:
        paths = [l["report"] for l in cp.review_legs if l["status"] == "collected"]
        findings = aggregate_findings(paths)
    elif args.report:
        findings = parse_review_report(args.report)
    else:
        print("error: need --report or --from-legs", file=sys.stderr)
        return 2
    cp.non_blocking.extend(non_blocking_notes(findings))
    event = classify(findings)
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0
```

`p_review` sub-parser:`--report` 改 `required=False`(移除 required),新增 `--from-legs`:

```python
    p_review = sub.add_parser("review")
    p_review.add_argument("--file", required=True)
    p_review.add_argument("--report", default=None)
    p_review.add_argument("--from-legs", dest="from_legs", action="store_true")
    p_review.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_review.set_defaults(func=_cmd_review)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_cli.py -k "review_from_legs or review_requires" -v`
Expected: PASS(2 passed)。並跑既有 review 測試確認相容:`python3 -m pytest tests/test_cli.py -k review -v`

- [ ] **Step 5: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat(cli): review 支援 --from-legs 彙總 code+uiux"
```

---

## Part E — 編排 + 同步

### Task 12: 全套測試 + SKILL.md 編排 + README + 同步全域 skill

**Files:**
- Modify: `~/.claude/skills/dev-loop/SKILL.md`(流程加入 proposal_review / qa / legs 步驟 + 退串行 unit-resolve)
- Modify: `README.md`(引擎 CLI 表格新增列)
- Sync: `devloop/*.py` → `~/.claude/skills/dev-loop/engine/devloop/`

**Interfaces:**
- Consumes: 全部前述子命令。
- Produces: 無新程式碼;文件 + 同步。

- [ ] **Step 1: 跑全套測試確認全綠**

Run: `python3 -m pytest -q`
Expected: 全 PASS(既有 104 + 本份新增約 25+)

- [ ] **Step 2: 更新 SKILL.md 流程**

在 `~/.claude/skills/dev-loop/SKILL.md`,於流程段落做以下調整(維持既有編號風格,讀檔後對應插入):

- **Propose 之後、批准提案之前**新增「Proposal Review」步驟:
  ```markdown
  - **Proposal Review(Opus subagent,冷啟動)**:start 時 `--phase proposal_review`。subagent 審 change(輸入:proposal+spec+tasks、設計文件、.devloop/changes/<id>.json 標注),產報告 JSON(level ∈ proposal/design)。
    `python3 -m devloop.cli proposal-review --file .devloop/checkpoint.json --report <pr.json>`
    - clean → phase=apply;✋ 此時等使用者批准提案。
    - blocking(proposal)→ phase=propose,自動重新 propose 後再 proposal-review(計數,上限 N)。
    - blocking(design)→ escalated,✋ 回 brainstorm 升級。
  ```
- **Apply 退串行**補一句:衝突 unit 在短命分支重做後 `unit-resolve --id <gid>`(標 merged + 清 worktree),再續 `units-merge`。
- **Hard gate 之後**新增「QA Gate」步驟:
  ```markdown
  - **QA Gate(QA subagent;可多情境平行)**:gate 全綠後 phase=qa。subagent 依 proposal 驗收標準跑 app/CLI 驗行為,產報告(level=behavior)。
    `python3 -m devloop.cli qa --file .devloop/checkpoint.json --report <qa.json>`
    - pass → review;blocking → fix。
  ```
- **Review 改為 legs 彙總**:
  ```markdown
  - **Review(code ‖ uiux 平行 legs)**:`legs-init --kinds code[,uiux]`(uiux 僅當 .devloop/changes/<id>.json 的 needs_uiux=true)。對每個 leg dispatch subagent(code=Opus、uiux=UI/UX persona,皆冷啟動、只審碼),各產報告後 `leg-done --kind <k> --report <p>`。全部 collected → `review --from-legs`,引擎彙總分級前進(merge/fix/propose)。
  ```
- 「每個 checkpoint 後 arm」清單補:`proposal-review`、`qa`、`leg-done`、`review`(--from-legs)之後同樣 arm。

- [ ] **Step 3: 更新 README.md CLI 表格**

新增列:

```markdown
| `proposal-review --report <json>` | 提案 review 分級(clean→apply / proposal→propose / design→escalated) |
| `qa --report <json>` | QA 行為驗證分級(pass→review / blocking→fix) |
| `legs-init --kinds code,uiux` | 初始化唯讀型平行 review legs |
| `leg-done --kind <k> --report <p>` | 回收某 leg 報告 |
| `review --from-legs` | 彙總所有 collected legs 報告後分級 |
| `unit-resolve --repo <r> --id <gid>` | 衝突 unit 退串行收尾(標 merged + 清 worktree) |
| `unit-claim --id <gid>` | 標記平行單元 in_progress |
```

- [ ] **Step 4: 同步引擎到全域 skill**

Run: `cp devloop/*.py ~/.claude/skills/dev-loop/engine/devloop/`
接著驗證:`python3 -m pytest -q` 仍全綠。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README + SKILL proposal_review/qa/legs 編排;同步全域 skill"
```

(SKILL.md 在 `~/.claude/` 不在本 repo,不納入 commit。)

---

## Self-Review

**1. Spec coverage**(對照 design spec §3、§6):
- Proposal Review phase + 自動修到乾淨 + 逃生門 → Task 6/7/8 ✓
- QA Gate(review 之前;fix 後重跑)→ Task 3/4/5 ✓(fix_done→gate→qa→review 由既有 fix_done→gate + 新 gate→qa 串成)
- Review code ‖ uiux 平行 legs + 彙總 → Task 9/10/11 ✓(uiux 由 needs_uiux 在 SKILL 編排決定 legs-init kinds)
- iteration 計數涵蓋 gate→qa→review→fix 內圈 → Task 3(gate_pass→qa +1)✓
- conflict 退串行收尾(plan gap)→ Task 1 ✓
- units-init 冪等 + in_progress 可達(plan gap)→ Task 2 ✓

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 均含完整實作。

**3. Type consistency:**
- 事件常數 `QA_PASS/QA_FAIL`(T3)、`PROPOSE_CLEAN/PROPOSE_BLOCKING_PROPOSAL/PROPOSE_BLOCKING_DESIGN`(T6)在 review.py(T4/T7)與測試一致引用。
- `classify_qa`(T4)、`classify_proposal`(T7)、`aggregate_findings`(T9)簽名與 cli 消費(T5/T8/T11)一致。
- review_legs dict 鍵 `{kind,status,report}`(T10)與 `review --from-legs`(T11)讀取一致。
- cli.py review import 行歷經 T4(+classify_qa)、T8(+classify_proposal)、T11(+aggregate_findings)逐步擴充;最終形態見 T11 Step 3。

**4. 破壞性改動備註:** Task 3 把 `gate_pass` 由「進 review」改為「進 qa」,Task 3 Step 1 已同步更新既有 statemachine 測試;Task 11 把 `review --report` 由 required 改為可選,既有 `review --report` 呼叫仍相容。

> **註(後續)**:第 3 份計畫(收尾策略 config.finish = merge/pr/ask)未涵蓋於此份。

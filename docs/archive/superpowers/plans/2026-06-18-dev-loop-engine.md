> **歷史實作計畫(point-in-time)**:該輪執行完成即凍結,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 dev-loop 的確定性引擎——一個 stdlib-only 的 Python CLI,負責 checkpoint 斷點、狀態機轉移、hard-gate 執行、review 分級判定、輪數升級與本機 resume 排程決策;供之後的 SKILL.md 編排層呼叫。

**Architecture:** 純函式核心(狀態機、review 分級、resume 規劃)與 I/O 邊界(checkpoint 讀寫、gate subprocess、CLI)分離。每個模組單一職責、可獨立測試。SKILL.md 只放判斷性編排(brainstorm/review/fix 路由),把確定性機制委派給本引擎。引擎以 `.devloop/checkpoint.json` 為唯一狀態真相,讓任何冷啟動 invocation 都能 `resume`。

**Tech Stack:** Python 3.9(`from __future__ import annotations` 以相容新式型別標註)、標準函式庫(`json`/`dataclasses`/`subprocess`/`datetime`/`argparse`/`pathlib`)、pytest(僅測試用)。

---

## 對應規格

實作 [docs/superpowers/specs/2026-06-18-dev-loop-design.md](../specs/2026-06-18-dev-loop-design.md) 第 4、5、7、9、10 節的確定性部分。判斷性階段([1] Brainstorm、[2] Propose、[5] Review 的實際評閱、[6] Fix 的實際修正)由 SKILL.md 編排層 + Opus/Sonnet 執行,本引擎只提供其狀態轉移與資料契約。

## 檔案結構

```
pyproject.toml              # pytest 設定 + pythonpath
devloop/
  __init__.py
  checkpoint.py             # Checkpoint dataclass + load/save(規格 9A)
  statemachine.py           # transition() 純函式 + Phase/Event 常數(規格 4、7）
  review.py                 # review 報告解析與 blocking 分級(規格 5)
  gate.py                   # hard-gate subprocess 執行(規格 4）
  resume.py                 # 本機 resume 排程決策(規格 9B)
  cli.py                    # argparse 接線
tests/
  test_checkpoint.py
  test_statemachine.py
  test_review.py
  test_gate.py
  test_resume.py
  test_cli.py
```

每個 task 產出自足、可獨立通過測試的變更。所有指令從 repo 根目錄執行。

---

### Task 1: 專案骨架

**Files:**
- Create: `pyproject.toml`
- Create: `devloop/__init__.py`
- Create: `tests/test_smoke.py`

- [ ] **Step 1: 確認 pytest 可用**

Run: `python3 -m pytest --version`
Expected: 印出 pytest 版本。若失敗,先 `python3 -m pip install pytest`,再重跑直到印出版本。

- [ ] **Step 2: 寫 failing 的 smoke 測試**

Create `tests/test_smoke.py`:

```python
import devloop


def test_package_importable():
    assert hasattr(devloop, "__version__")
    assert devloop.__version__ == "0.1.0"
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_smoke.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop'`(或 import 錯誤)。

- [ ] **Step 4: 建立 pyproject 與套件**

Create `pyproject.toml`:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

Create `devloop/__init__.py`:

```python
__version__ = "0.1.0"
```

- [ ] **Step 5: 跑測試確認通過**

Run: `python3 -m pytest tests/test_smoke.py -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml devloop/__init__.py tests/test_smoke.py
git commit -m "chore: scaffold devloop package with pytest"
```

---

### Task 2: Checkpoint 模型(規格 9A)

**Files:**
- Create: `devloop/checkpoint.py`
- Test: `tests/test_checkpoint.py`

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_checkpoint.py`:

```python
from devloop.checkpoint import Checkpoint


def test_save_then_load_roundtrip(tmp_path):
    path = tmp_path / "checkpoint.json"
    cp = Checkpoint(
        phase="apply",
        change_id="add-foo",
        branch="loop/add-foo",
        iteration=2,
        last_artifact="docs/review-1.md",
        non_blocking=["rename x", "add docstring"],
    )
    cp.save(path)

    loaded = Checkpoint.load(path)
    assert loaded.phase == "apply"
    assert loaded.change_id == "add-foo"
    assert loaded.branch == "loop/add-foo"
    assert loaded.iteration == 2
    assert loaded.last_artifact == "docs/review-1.md"
    assert loaded.non_blocking == ["rename x", "add docstring"]


def test_save_sets_updated_at(tmp_path):
    path = tmp_path / "checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.updated_at == ""
    cp.save(path)
    assert cp.updated_at != ""
    assert Checkpoint.load(path).updated_at == cp.updated_at


def test_defaults(tmp_path):
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.iteration == 0
    assert cp.last_artifact == ""
    assert cp.non_blocking == []
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_checkpoint.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.checkpoint'`。

- [ ] **Step 3: 實作 Checkpoint**

Create `devloop/checkpoint.py`:

```python
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Checkpoint:
    """Dev-loop 斷點狀態(規格 9A)。"""

    phase: str
    change_id: str
    branch: str
    iteration: int = 0
    last_artifact: str = ""
    non_blocking: list = field(default_factory=list)
    updated_at: str = ""

    def save(self, path) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        Path(path).write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path) -> "Checkpoint":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(**data)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_checkpoint.py -v`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/checkpoint.py tests/test_checkpoint.py
git commit -m "feat: add Checkpoint model with save/load"
```

---

### Task 3: 狀態機轉移(規格 4)

**Files:**
- Create: `devloop/statemachine.py`
- Test: `tests/test_statemachine.py`

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_statemachine.py`:

```python
import pytest

from devloop.statemachine import (
    APPLY_DONE,
    FIX_DONE,
    GATE_FAIL,
    GATE_PASS,
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
    InvalidTransition,
    transition,
)


def test_apply_done_goes_to_gate():
    assert transition("apply", 0, APPLY_DONE) == ("gate", 0)


def test_gate_pass_enters_review_and_increments_iteration():
    assert transition("gate", 0, GATE_PASS) == ("review", 1)


def test_gate_fail_goes_to_fix_without_incrementing():
    assert transition("gate", 1, GATE_FAIL) == ("fix", 1)


def test_review_no_blocking_goes_to_merge():
    assert transition("review", 1, REVIEW_NO_BLOCKING) == ("merge", 1)


def test_review_blocking_code_goes_to_fix():
    assert transition("review", 1, REVIEW_BLOCKING_CODE) == ("fix", 1)


def test_review_blocking_proposal_escapes_to_propose():
    assert transition("review", 1, REVIEW_BLOCKING_PROPOSAL) == ("propose", 1)


def test_fix_done_returns_to_gate():
    assert transition("fix", 1, FIX_DONE) == ("gate", 1)


def test_invalid_transition_raises():
    with pytest.raises(InvalidTransition):
        transition("merge", 1, GATE_PASS)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_statemachine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.statemachine'`。

- [ ] **Step 3: 實作 transition(暫不含升級,Task 4 補)**

Create `devloop/statemachine.py`:

```python
from __future__ import annotations

# Phases(規格 4)
PHASES = (
    "brainstorm",
    "propose",
    "apply",
    "gate",
    "review",
    "fix",
    "merge",
    "escalated",
    "done",
)

# Events
APPLY_DONE = "apply_done"
GATE_PASS = "gate_pass"
GATE_FAIL = "gate_fail"
REVIEW_NO_BLOCKING = "review_no_blocking"
REVIEW_BLOCKING_CODE = "review_blocking_code"
REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal"
FIX_DONE = "fix_done"

DEFAULT_MAX_ITERATIONS = 3


class InvalidTransition(Exception):
    """目前階段不接受該事件。"""


def transition(phase, iteration, event, max_iterations=DEFAULT_MAX_ITERATIONS):
    """純函式狀態轉移。回傳 (new_phase, new_iteration)。

    iteration 在 gate_pass 進入 review 時 +1(代表第幾輪 review)。
    升級邏輯於 Task 4 加入。
    """
    if phase == "apply" and event == APPLY_DONE:
        return ("gate", iteration)
    if phase == "gate" and event == GATE_PASS:
        return ("review", iteration + 1)
    if phase == "gate" and event == GATE_FAIL:
        return ("fix", iteration)
    if phase == "review" and event == REVIEW_NO_BLOCKING:
        return ("merge", iteration)
    if phase == "review" and event == REVIEW_BLOCKING_CODE:
        return ("fix", iteration)
    if phase == "review" and event == REVIEW_BLOCKING_PROPOSAL:
        return ("propose", iteration)
    if phase == "fix" and event == FIX_DONE:
        return ("gate", iteration)
    raise InvalidTransition("no transition from %r on %r" % (phase, event))
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_statemachine.py -v`
Expected: PASS(8 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/statemachine.py tests/test_statemachine.py
git commit -m "feat: add dev-loop state machine transitions"
```

---

### Task 4: 輪數上限與升級(規格 7)

**Files:**
- Modify: `devloop/statemachine.py`
- Test: `tests/test_statemachine.py`

- [ ] **Step 1: 加上 failing 的升級測試**

在 `tests/test_statemachine.py` 末尾新增:

```python
def test_gate_pass_within_limit_enters_review():
    # max=3:iteration 0->1, 1->2, 2->3 都還在範圍內
    assert transition("gate", 2, GATE_PASS, max_iterations=3) == ("review", 3)


def test_gate_pass_exceeding_limit_escalates():
    # 第 4 次 gate_pass(3->4)超過上限 → escalated
    assert transition("gate", 3, GATE_PASS, max_iterations=3) == ("escalated", 4)
```

- [ ] **Step 2: 跑測試確認新測試失敗**

Run: `python3 -m pytest tests/test_statemachine.py -v -k escalat or test_gate_pass_exceeding_limit_escalates`
Expected: `test_gate_pass_exceeding_limit_escalates` FAIL — 回傳 `("review", 4)` 而非 `("escalated", 4)`。

- [ ] **Step 3: 在 transition 的 GATE_PASS 分支加入升級判定**

在 `devloop/statemachine.py` 中,將:

```python
    if phase == "gate" and event == GATE_PASS:
        return ("review", iteration + 1)
```

改為:

```python
    if phase == "gate" and event == GATE_PASS:
        new_iteration = iteration + 1
        if new_iteration > max_iterations:
            return ("escalated", new_iteration)
        return ("review", new_iteration)
```

- [ ] **Step 4: 跑全部狀態機測試確認通過**

Run: `python3 -m pytest tests/test_statemachine.py -v`
Expected: PASS(10 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/statemachine.py tests/test_statemachine.py
git commit -m "feat: escalate when review rounds exceed max_iterations"
```

---

### Task 5: Review 報告解析與分級(規格 5)

**Files:**
- Create: `devloop/review.py`
- Test: `tests/test_review.py`

review 報告為 JSON,結構:`{"findings": [{"severity": "blocking"|"non_blocking", "level": "code"|"proposal", "note": "..."}]}`。`classify` 將 findings 映射成 Task 3 的 review 事件;`non_blocking_notes` 抽出 non-blocking 文字供 follow-up。

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_review.py`:

```python
import json

from devloop.review import classify, non_blocking_notes, parse_review_report
from devloop.statemachine import (
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
)


def test_classify_no_blocking():
    findings = [{"severity": "non_blocking", "level": "code", "note": "rename"}]
    assert classify(findings) == REVIEW_NO_BLOCKING


def test_classify_empty_is_no_blocking():
    assert classify([]) == REVIEW_NO_BLOCKING


def test_classify_blocking_code():
    findings = [{"severity": "blocking", "level": "code", "note": "off-by-one"}]
    assert classify(findings) == REVIEW_BLOCKING_CODE


def test_classify_proposal_takes_precedence():
    findings = [
        {"severity": "blocking", "level": "code", "note": "bug"},
        {"severity": "blocking", "level": "proposal", "note": "spec wrong"},
    ]
    assert classify(findings) == REVIEW_BLOCKING_PROPOSAL


def test_non_blocking_notes_extracts_only_non_blocking():
    findings = [
        {"severity": "blocking", "level": "code", "note": "bug"},
        {"severity": "non_blocking", "level": "code", "note": "rename x"},
        {"severity": "non_blocking", "level": "code", "note": "add docstring"},
    ]
    assert non_blocking_notes(findings) == ["rename x", "add docstring"]


def test_parse_review_report(tmp_path):
    path = tmp_path / "review.json"
    path.write_text(
        json.dumps({"findings": [{"severity": "blocking", "level": "code", "note": "x"}]}),
        encoding="utf-8",
    )
    findings = parse_review_report(path)
    assert findings == [{"severity": "blocking", "level": "code", "note": "x"}]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_review.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.review'`。

- [ ] **Step 3: 實作 review 模組**

Create `devloop/review.py`:

```python
from __future__ import annotations

import json
from pathlib import Path

from devloop.statemachine import (
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
)


def classify(findings):
    """將 review findings 映射成狀態機事件(規格 5)。

    任一 proposal 層級 blocking → 逃生門(回 propose);
    否則有 code blocking → fix;全無 blocking → merge。
    """
    blocking = [f for f in findings if f.get("severity") == "blocking"]
    if not blocking:
        return REVIEW_NO_BLOCKING
    if any(f.get("level") == "proposal" for f in blocking):
        return REVIEW_BLOCKING_PROPOSAL
    return REVIEW_BLOCKING_CODE


def non_blocking_notes(findings):
    """抽出 non-blocking 項的 note 文字供 follow-up。"""
    return [f.get("note", "") for f in findings if f.get("severity") == "non_blocking"]


def parse_review_report(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["findings"]
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_review.py -v`
Expected: PASS(6 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/review.py tests/test_review.py
git commit -m "feat: parse and classify review report findings"
```

---

### Task 6: Hard-gate 執行(規格 4)

**Files:**
- Create: `devloop/gate.py`
- Test: `tests/test_gate.py`

依序執行設定好的命令(tests / lint / build);任一非零結束碼即 fail 並回報失敗命令與輸出。

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_gate.py`:

```python
from devloop.gate import GateResult, run_gate


def test_all_commands_pass():
    result = run_gate([["true"], ["true"]])
    assert isinstance(result, GateResult)
    assert result.passed is True
    assert result.failed_command is None


def test_first_failing_command_short_circuits():
    result = run_gate([["true"], ["false"], ["true"]])
    assert result.passed is False
    assert result.failed_command == ["false"]


def test_captures_output_on_failure():
    result = run_gate([["sh", "-c", "echo boom >&2; exit 1"]])
    assert result.passed is False
    assert "boom" in result.output


def test_empty_commands_pass():
    assert run_gate([]).passed is True
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_gate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.gate'`。

- [ ] **Step 3: 實作 gate 模組**

Create `devloop/gate.py`:

```python
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class GateResult:
    passed: bool
    failed_command: Optional[list] = None
    output: str = ""


def run_gate(commands, cwd=None) -> GateResult:
    """依序執行 commands;任一失敗即短路回報(規格 4)。"""
    for cmd in commands:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True
        )
        if proc.returncode != 0:
            return GateResult(
                passed=False,
                failed_command=cmd,
                output=(proc.stdout or "") + (proc.stderr or ""),
            )
    return GateResult(passed=True)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_gate.py -v`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/gate.py tests/test_gate.py
git commit -m "feat: add hard-gate command runner"
```

---

### Task 7: 本機 resume 排程決策(規格 9B)

**Files:**
- Create: `devloop/resume.py`
- Test: `tests/test_resume.py`

純函式:給定 checkpoint 階段、現在時間、reset 時間,回傳「現在就 resume」或「再睡多久重檢」。因 harness 單次 wakeup 上限約 3600 秒,未到 reset 時 sleep 取「剩餘時間」與 3600 的較小值,形成週期性重排。

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_resume.py`:

```python
from datetime import datetime, timedelta, timezone

from devloop.resume import MAX_SLEEP_SECONDS, ResumeAction, plan_resume


def _now():
    return datetime(2026, 6, 18, 12, 0, 0, tzinfo=timezone.utc)


def test_ready_when_reset_reached():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now)
    assert isinstance(action, ResumeAction)
    assert action.ready is True
    assert action.sleep_seconds == 0
    assert action.phase == "review"


def test_ready_when_past_reset():
    now = _now()
    action = plan_resume("fix", now=now, reset_at=now - timedelta(minutes=1))
    assert action.ready is True
    assert action.sleep_seconds == 0


def test_sleep_clamped_to_max_when_far():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now + timedelta(hours=5))
    assert action.ready is False
    assert action.sleep_seconds == MAX_SLEEP_SECONDS


def test_sleep_is_remaining_when_within_window():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now + timedelta(minutes=10))
    assert action.ready is False
    assert action.sleep_seconds == 600
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_resume.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.resume'`。

- [ ] **Step 3: 實作 resume 模組**

Create `devloop/resume.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

MAX_SLEEP_SECONDS = 3600  # harness 單次 wakeup 上限


@dataclass
class ResumeAction:
    ready: bool          # 已達 reset → 立即跑 --resume
    sleep_seconds: int   # 未達時,睡多久後重檢
    phase: str           # 要 resume 回的階段(取自 checkpoint)


def plan_resume(checkpoint_phase, now, reset_at) -> ResumeAction:
    """本機 adapter 的排程決策(規格 9B)。"""
    if now >= reset_at:
        return ResumeAction(ready=True, sleep_seconds=0, phase=checkpoint_phase)
    remaining = (reset_at - now).total_seconds()
    return ResumeAction(
        ready=False,
        sleep_seconds=int(min(remaining, MAX_SLEEP_SECONDS)),
        phase=checkpoint_phase,
    )
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_resume.py -v`
Expected: PASS(4 passed)。

- [ ] **Step 5: Commit**

```bash
git add devloop/resume.py tests/test_resume.py
git commit -m "feat: add local resume scheduling decision"
```

---

### Task 8: CLI 接線

**Files:**
- Create: `devloop/cli.py`
- Test: `tests/test_cli.py`

CLI 提供 `start` / `status` / `event` / `gate` 子命令,皆以 `--file` 指定 checkpoint 路徑。`main(argv)` 回傳 exit code,方便測試。

- [ ] **Step 1: 寫 failing 測試**

Create `tests/test_cli.py`:

```python
from devloop.checkpoint import Checkpoint
from devloop.cli import main


def test_start_creates_checkpoint(tmp_path, capsys):
    f = tmp_path / "cp.json"
    code = main(["start", "--file", str(f), "--change-id", "add-foo", "--branch", "loop/add-foo"])
    assert code == 0
    cp = Checkpoint.load(f)
    assert cp.phase == "apply"
    assert cp.change_id == "add-foo"
    assert cp.branch == "loop/add-foo"
    assert cp.iteration == 0


def test_status_prints_phase_and_iteration(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=2).save(f)
    code = main(["status", "--file", str(f)])
    assert code == 0
    out = capsys.readouterr().out
    assert "review" in out
    assert "2" in out


def test_event_advances_and_persists(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "apply_done"])
    assert code == 0
    assert Checkpoint.load(f).phase == "gate"


def test_event_gate_pass_increments_iteration(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", iteration=0).save(f)
    main(["event", "--file", str(f), "--event", "gate_pass"])
    cp = Checkpoint.load(f)
    assert cp.phase == "review"
    assert cp.iteration == 1


def test_event_escalates_when_over_limit(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", iteration=3).save(f)
    main(["event", "--file", str(f), "--event", "gate_pass", "--max", "3"])
    assert Checkpoint.load(f).phase == "escalated"


def test_gate_subcommand_exit_code(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    # 全綠 gate → exit 0 且階段前進到 review
    code = main(["gate", "--file", str(f), "--cmd", "true"])
    assert code == 0
    assert Checkpoint.load(f).phase == "review"


def test_gate_subcommand_failure_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    code = main(["gate", "--file", str(f), "--cmd", "false"])
    assert code == 1
    assert Checkpoint.load(f).phase == "fix"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'devloop.cli'`。

- [ ] **Step 3: 實作 CLI**

Create `devloop/cli.py`:

```python
from __future__ import annotations

import argparse

from devloop.checkpoint import Checkpoint
from devloop.gate import run_gate
from devloop.statemachine import (
    APPLY_DONE,
    GATE_FAIL,
    GATE_PASS,
    DEFAULT_MAX_ITERATIONS,
    transition,
)


def _cmd_start(args):
    cp = Checkpoint(phase="apply", change_id=args.change_id, branch=args.branch)
    cp.save(args.file)
    return 0


def _cmd_status(args):
    cp = Checkpoint.load(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _apply_event(cp, event, max_iterations):
    new_phase, new_iteration = transition(cp.phase, cp.iteration, event, max_iterations)
    cp.phase = new_phase
    cp.iteration = new_iteration
    return cp


def _cmd_event(args):
    cp = Checkpoint.load(args.file)
    cp = _apply_event(cp, args.event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_gate(args):
    cp = Checkpoint.load(args.file)
    result = run_gate([[c] for c in args.cmd])
    event = GATE_PASS if result.passed else GATE_FAIL
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    if not result.passed:
        print("gate FAILED: %s" % result.failed_command)
        print(result.output)
        return 1
    print("gate PASSED -> phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="devloop")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--file", required=True)
    p_start.add_argument("--change-id", required=True, dest="change_id")
    p_start.add_argument("--branch", required=True)
    p_start.set_defaults(func=_cmd_start)

    p_status = sub.add_parser("status")
    p_status.add_argument("--file", required=True)
    p_status.set_defaults(func=_cmd_status)

    p_event = sub.add_parser("event")
    p_event.add_argument("--file", required=True)
    p_event.add_argument("--event", required=True)
    p_event.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_event.set_defaults(func=_cmd_event)

    p_gate = sub.add_parser("gate")
    p_gate.add_argument("--file", required=True)
    p_gate.add_argument("--cmd", action="append", default=[])
    p_gate.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_gate.set_defaults(func=_cmd_gate)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
```

> 註:`event` 子命令的 `apply_done` 等事件字串直接對應 `devloop.statemachine` 常數值(`APPLY_DONE == "apply_done"` 等),故 CLI 直接傳遞 `args.event` 給 `transition`。上方 import 的 `APPLY_DONE` 用於確保常數存在;若 linter 警告未使用,可改為在 `_cmd_event` 加一行 `assert args.event` 的驗證或移除該 import。

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_cli.py -v`
Expected: PASS(7 passed)。

- [ ] **Step 5: 跑全測試套件**

Run: `python3 -m pytest -v`
Expected: 全部 PASS(smoke 1 + checkpoint 3 + statemachine 10 + review 6 + gate 4 + resume 4 + cli 7 = 35 passed)。

- [ ] **Step 6: Commit**

```bash
git add devloop/cli.py tests/test_cli.py
git commit -m "feat: add devloop CLI (start/status/event/gate)"
```

---

### Task 9: SKILL.md 編排層組裝

**Files:**
- Create: `skills/dev-loop/SKILL.md`

把判斷性編排寫成 skill,委派確定性機制給引擎 CLI。此 task 為文件組裝,無單元測試;以「人工走查 + 引擎指令可跑」驗證。

- [ ] **Step 1: 撰寫 SKILL.md**

Create `skills/dev-loop/SKILL.md`:

```markdown
---
name: dev-loop
description: 依固定流程用 agent 開發 — brainstorming(Opus)→ OpenSpec propose → apply+TDD(Sonnet)→ Opus subagent review/re-review → 自動 merge 回 trunk。只在批准設計、批准提案、超過輪數升級三處需人工。
---

# Dev-Loop

形式化的 agent 開發 loop。判斷性步驟由本 skill 編排;確定性狀態交給 `devloop` 引擎 CLI(見 docs/superpowers/specs/2026-06-18-dev-loop-design.md)。

## 流程

1. **Brainstorm(Opus)**:用 `/brainstorming` 產出設計文件。✋ 等使用者批准。
2. **Propose(Opus · OpenSpec)**:建立切小的 OpenSpec change。✋ 等使用者批准。
3. **啟動引擎**:`python3 -m devloop.cli start --file .devloop/checkpoint.json --change-id <id> --branch <branch>`
4. **Apply(Sonnet · TDD)**:逐 task red→green→refactor。完成後 `event --event apply_done`。
5. **Hard gate**:`python3 -m devloop.cli gate --file .devloop/checkpoint.json --cmd <test-cmd> --cmd <lint-cmd> --cmd <build-cmd>`。
   - exit 0 → 階段已進到 review。
   - exit 1 → 階段已進到 fix,回步驟 7。
6. **Review(Opus subagent,冷啟動)**:輸入 diff + OpenSpec proposal(真相來源)+ 測試報告 + 前次 review 報告;產出 review 報告 JSON(`findings[]`,severity ∈ blocking/non_blocking,level ∈ code/proposal)。
   - 用 `devloop.review.classify` 取得事件,再 `event --event <該事件>`:
     - `review_no_blocking` → merge(步驟 8)
     - `review_blocking_code` → fix(步驟 7)
     - `review_blocking_proposal` → 逃生門回步驟 2(必要時步驟 1)
   - 若 `status` 顯示 `escalated`:停止自動段,Opus 產未解決問題摘要,✋ 升級給使用者。
7. **Fix**:機械性 → Sonnet;架構性 → Opus。只處理 blocking 項;完成後 `event --event fix_done`,回步驟 5。
8. **Merge & Archive(自動)**:短命分支 merge 回 trunk →`openspec archive`→ 將 review 報告的 non-blocking 項落成 follow-up。

## Token 用罄續跑

每階段轉移後 checkpoint 已更新。預設本機 resume:用 `devloop.resume.plan_resume(phase, now, reset_at)` 決定立即續跑或睡 `sleep_seconds` 後重檢(週期性重排,因 wakeup 上限 3600 秒)。到 reset 後從 checkpoint 的 phase 續跑。
```

- [ ] **Step 2: 驗證引擎指令可跑(走查)**

Run:
```bash
python3 -m devloop.cli start --file /tmp/devloop-smoke.json --change-id demo --branch loop/demo
python3 -m devloop.cli event --file /tmp/devloop-smoke.json --event apply_done
python3 -m devloop.cli gate --file /tmp/devloop-smoke.json --cmd true
python3 -m devloop.cli status --file /tmp/devloop-smoke.json
rm -f /tmp/devloop-smoke.json
```
Expected: 最後 `status` 印出 `phase=review iteration=1`。

- [ ] **Step 3: Commit**

```bash
git add skills/dev-loop/SKILL.md
git commit -m "docs: add dev-loop orchestration skill"
```

---

## Self-Review

- **規格覆蓋**:狀態機(§4)→ Task 3/4;階段契約(§5)→ Task 3–6 + Task 9 文件;迴圈升級(§7)→ Task 4;checkpoint(§9A)→ Task 2;resume(§9B)→ Task 7;錯誤處理(§10)→ hard-gate 短路(Task 6)、逃生門事件(Task 5)、升級(Task 4)。判斷性階段([1][2][5][6] 的實際執行)→ Task 9 SKILL.md 委派,符合規格「本份不含工具指令封裝」的邊界。
- **Placeholder 掃描**:無 TBD/TODO;每個程式步驟都附完整程式碼與預期輸出。
- **型別一致性**:事件常數字串(`apply_done` 等)在 statemachine 定義,review、cli 一致引用;`Checkpoint` 欄位(phase/change_id/branch/iteration/last_artifact/non_blocking/updated_at)跨 Task 2/8 一致;`transition(phase, iteration, event, max_iterations)` 簽章於 Task 3 定義,Task 4/8 沿用;`GateResult(passed, failed_command, output)` 於 Task 6 定義,Task 8 使用 `.passed`/`.failed_command`/`.output`。

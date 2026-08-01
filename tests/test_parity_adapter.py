import json

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.adapter import run_watcher

SECTIONS = ["runWatcher", "noLogPath"]

TS_PREFIX_LEN = len("2026-08-01T00:00:00")


def _outcome(o):
    """fixture 的 outcome 是 [code, tail] 或裸 code。"""
    return tuple(o) if isinstance(o, list) else o


def _drive(case, log_path):
    """依 fixture 的 outcomes 驅動 run_watcher,回 (returned, slept, log_entries)。"""
    pending = [_outcome(o) for o in case["outcomes"]]
    slept = []

    def run_fn(cmd):
        assert cmd == case["exec_command"], "exec_command 沒有原樣傳給 run_fn"
        assert pending, "run_fn 被呼叫的次數超過 fixture 提供的 outcomes"
        return pending.pop(0)

    returned = run_watcher(
        case["exec_command"], heartbeat=case["heartbeat"],
        sleep_fn=slept.append, run_fn=run_fn, log_path=log_path,
    )
    entries = []
    if log_path is not None:
        from pathlib import Path
        p = Path(log_path)
        if p.exists():
            entries = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return returned, slept, entries


@pytest.mark.parametrize("case", parity_cases("adapter", "runWatcher", SECTIONS))
def test_run_watcher_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "runWatcher cases do not raise"
    log_path = tmp_path / "w.jsonl"
    returned, slept, entries = _drive(case, str(log_path))
    # ts 的文法兩引擎不同(既有延後項),不列入 expect;只斷言共通的秒級前綴存在
    for e in entries:
        assert len(e.pop("ts", "")) >= TS_PREFIX_LEN, case["name"]
    assert_subset({"returned": returned, "slept": slept, "log": entries}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("adapter", "noLogPath", SECTIONS))
def test_run_watcher_without_log_parity(case, tmp_path):
    expect, _ = resolve_expectation(case, "py")
    returned, slept, _ = _drive(case, None)
    assert_subset({"returned": returned, "slept": slept}, expect, case["name"])
    assert not list(tmp_path.iterdir()), "log_path 為空時不該寫任何檔案"

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
    """這一段本來只做「開一個 tmp_path、**不**把它交給 run_watcher、然後斷言
    它是空的」——那對任何實作都成立,包括一個把 log 寫死到別處的實作,也包括
    一個 _append_log 什麼都不做的實作。改成先跑一次「有 log_path」的,釘住檔案
    確實出現在**指定的那個路徑**且行數等於嘗試次數,再跑一次「無 log_path」的,
    釘住同一個檔案 byte 不變、目錄裡也沒多出別的檔案。"""
    expect, _ = resolve_expectation(case, "py")
    log_path = tmp_path / "w.jsonl"

    logged_returned, logged_slept, logged_entries = _drive(case, str(log_path))
    bytes_after_logged = log_path.read_bytes()

    returned, slept, _ = _drive(case, None)
    assert returned == logged_returned, "有無 log_path 不該改變回傳值"
    assert slept == logged_slept, "有無 log_path 不該改變睡眠序列"
    lines_after_unlogged = len(
        [ln for ln in log_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    )
    assert log_path.read_bytes() == bytes_after_logged, "無 log_path 的那次不得動到檔案"

    assert_subset({
        "returned": returned,
        "slept": slept,
        "lines_after_logged_run": len(logged_entries),
        "lines_after_unlogged_run": lines_after_unlogged,
        "files_in_dir_after": sorted(p.name for p in tmp_path.iterdir()),
    }, expect, case["name"])

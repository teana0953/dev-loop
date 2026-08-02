import os
import subprocess

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop import watcher

SECTIONS = ["watcherState", "lastWatcherAttempt"]


def _reaped_pid():
    """真的產生一個已被收屍的 pid——比猜一個大數字可靠。"""
    p = subprocess.Popen(["/usr/bin/true"])
    p.wait()
    return p.pid


def _subst(value, self_pid, dead_pid):
    """pid 值無法寫死在 fixture 裡,兩側各自把 <SELF>/<DEAD> 換成實際值。"""
    if value == "<SELF>":
        return self_pid
    if value == "<DEAD>":
        return dead_pid
    if isinstance(value, str):
        return value.replace("<SELF>", str(self_pid)).replace("<DEAD>", str(dead_pid))
    return value


@pytest.mark.parametrize("case", parity_cases("watcher", "watcherState", SECTIONS))
def test_watcher_state_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "watcherState never raises for these inputs"
    self_pid, dead_pid = os.getpid(), _reaped_pid()
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    pid_file = case["input"]["pid_file"]
    if pid_file is not None:
        # 檔案內容一律轉字串:整個值就是 "<SELF>" 時 _subst 回的是 int。
        (tmp_path / "watcher.pid").write_text(str(_subst(pid_file, self_pid, dead_pid)))
    state, pid = watcher._watcher_state(str(cp))
    want = {k: _subst(v, self_pid, dead_pid) for k, v in expect.items()}
    assert_subset({"state": state, "pid": pid}, want, case["name"])


@pytest.mark.parametrize("case", parity_cases("watcher", "lastWatcherAttempt", SECTIONS))
def test_last_watcher_attempt_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "lastWatcherAttempt never raises for these inputs"
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    log = case["input"]["log"]
    if log is not None:
        (tmp_path / "watcher-log.jsonl").write_text(log, encoding="utf-8")
    assert_subset(
        {"value": watcher._last_watcher_attempt(str(cp))}, expect, case["name"])

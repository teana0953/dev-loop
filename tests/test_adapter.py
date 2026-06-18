from datetime import datetime, timedelta, timezone

from devloop.adapter import run_adapter
from devloop.checkpoint import Checkpoint


def _utc(h):
    return datetime(2026, 6, 18, h, 0, 0, tzinfo=timezone.utc)


def _cp(tmp_path, phase="review"):
    f = tmp_path / "cp.json"
    Checkpoint(phase=phase, change_id="c", branch="b").save(f)
    return f


def test_runs_immediately_when_reset_reached(tmp_path):
    f = _cp(tmp_path, phase="fix")
    slept = []
    runs = []
    code = run_adapter(
        f,
        reset_at=_utc(12),
        exec_command=["echo", "hi"],
        now_fn=lambda: _utc(12),
        sleep_fn=slept.append,
        run_fn=lambda cmd: runs.append(cmd) or 0,
    )
    assert code == 0
    assert runs == [["echo", "hi"]]
    assert slept == []


def test_sleeps_clamped_then_runs_when_reset_in_future(tmp_path):
    f = _cp(tmp_path, phase="review")
    # 第一次檢查在 07:00(距 reset 12:00 有 5 小時)→ 睡 3600;
    # 第二次檢查在 12:00 → ready → 執行
    times = iter([_utc(7), _utc(12)])
    slept = []
    runs = []
    code = run_adapter(
        f,
        reset_at=_utc(12),
        exec_command=["python3", "-m", "devloop.cli", "status", "--file", str(f)],
        now_fn=lambda: next(times),
        sleep_fn=slept.append,
        run_fn=lambda cmd: runs.append(cmd) or 0,
    )
    assert code == 0
    assert slept == [3600]
    assert len(runs) == 1


def test_returns_exec_exit_code(tmp_path):
    f = _cp(tmp_path)
    code = run_adapter(
        f,
        reset_at=_utc(12),
        exec_command=["false"],
        now_fn=lambda: _utc(12),
        sleep_fn=lambda s: None,
        run_fn=lambda cmd: 1,
    )
    assert code == 1

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


# --- watcher log ---

import json


def _entries(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()]


def test_run_watcher_logs_each_attempt(tmp_path):
    log = tmp_path / "watcher-log.jsonl"
    codes = iter([(1, "rate limited"), (0, "resumed")])
    slept = []
    run_watcher(["x"], heartbeat=5, sleep_fn=slept.append,
                run_fn=lambda cmd: next(codes), log_path=str(log))
    entries = _entries(log)
    assert [e["exit_code"] for e in entries] == [1, 0]
    assert entries[0]["action"] == "retry"
    assert entries[0]["output_tail"] == "rate limited"
    assert entries[0]["heartbeat"] == 5
    assert entries[1]["action"] == "stop"
    assert all(e["ts"] for e in entries)


def test_run_watcher_int_run_fn_still_supported(tmp_path):
    # 舊式 run_fn 只回 int(非 tuple)也要能跑並記 log
    log = tmp_path / "w.jsonl"
    code = run_watcher(["x"], run_fn=lambda cmd: 0, log_path=str(log))
    assert code == 0
    assert _entries(log)[0]["output_tail"] == ""


def test_run_watcher_without_log_path_writes_nothing(tmp_path):
    run_watcher(["x"], run_fn=lambda cmd: 0)
    assert list(tmp_path.iterdir()) == []


def test_run_watcher_log_failure_does_not_crash(tmp_path):
    # log 路徑不可寫(指向目錄)→ 靜默,watcher 照常收斂
    bad = tmp_path / "adir"
    bad.mkdir()
    assert run_watcher(["x"], run_fn=lambda cmd: 0, log_path=str(bad)) == 0

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

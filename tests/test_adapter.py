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


# --- _default_run:輸出量與輸出尾巴的單位 ---

import sys

import pytest

from devloop.adapter import OUTPUT_TAIL_CHARS, _default_run


def test_default_run_captures_more_than_one_mib():
    # subprocess.run 沒有輸出上限;TS 那側的 spawnSync 預設 maxBuffer 1 MiB,
    # 超過就 ENOBUFS,而那個例外會一路丟出 run_watcher。兩邊都得釘。
    code, tail = _default_run([
        sys.executable, "-c",
        "import sys; sys.stdout.write('x' * %d)" % (2 * 1024 * 1024),
    ])
    assert code == 0
    assert tail == "x" * OUTPUT_TAIL_CHARS


def test_default_run_tail_counts_code_points():
    # [-500:] 數的是 code point,不是 UTF-16 unit,也不是 grapheme cluster。
    # "A"*100 + "🎉"*300 共 400 個 code point → 整串保留(含 "A" 前綴)。
    code, tail = _default_run([
        sys.executable, "-c",
        "import sys; sys.stdout.write('A' * 100 + '\\U0001F389' * 300)",
    ])
    assert code == 0
    assert len(tail) == 400
    assert tail == "A" * 100 + "\U0001F389" * 300


def test_default_run_tail_of_astral_only_output():
    code, tail = _default_run([
        sys.executable, "-c",
        "import sys; sys.stdout.write('\\U0001F389' * 600)",
    ])
    assert code == 0
    assert len(tail) == OUTPUT_TAIL_CHARS
    assert tail == "\U0001F389" * OUTPUT_TAIL_CHARS


# --- 負的 heartbeat ---


def test_negative_heartbeat_raises_after_one_attempt(tmp_path):
    """time.sleep(-1) 拋 ValueError;run_watcher 不接,watcher 在寫完第一行 log
    之後就死。TS 那側 setTimeout(-1000) 約 1 ms 就觸發,會變成全速空轉把
    watcher-log.jsonl 寫爆——所以兩邊都得釘住「拋出來」這件事。"""
    log = tmp_path / "w.jsonl"
    calls = []
    with pytest.raises(ValueError, match="sleep length must be non-negative"):
        run_watcher(["x"], heartbeat=-1,
                    run_fn=lambda cmd: calls.append(cmd) or 1,
                    log_path=str(log))
    assert len(calls) == 1, "只該嘗試一次"
    entries = _entries(log)
    assert len(entries) == 1
    assert entries[0]["exit_code"] == 1
    assert entries[0]["action"] == "retry"
    assert entries[0]["heartbeat"] == -1


def test_negative_heartbeat_does_not_raise_when_the_run_succeeds():
    assert run_watcher(["x"], heartbeat=-1, run_fn=lambda cmd: 0) == 0


def test_negative_heartbeat_with_an_injected_sleep_fn_keeps_control():
    # 例外來自 time.sleep,不是 run_watcher —— 注入 sleep_fn 時正常收斂。
    codes = iter([1, 1, 0])
    slept = []
    assert run_watcher(["x"], heartbeat=-5,
                       run_fn=lambda cmd: next(codes),
                       sleep_fn=slept.append) == 0
    assert slept == [-5, -5]


def test_zero_heartbeat_is_allowed():
    codes = iter([1, 0])
    assert run_watcher(["x"], heartbeat=0, run_fn=lambda cmd: next(codes)) == 0

import json
import os

import devloop.cli as cli
from devloop.checkpoint import Checkpoint
from devloop.cli import main


def test_watcher_status_not_armed_without_pidfile(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    code = main(["watcher-status", "--file", str(f)])
    out = capsys.readouterr().out
    assert "watcher: not armed" in out
    assert "resume_exec: (none)" in out
    assert "last attempt: (none)" in out
    # 無 resume_exec → watcher 本來就不需要 → exit 0
    assert code == 0


def test_watcher_status_running(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    (tmp_path / "watcher.pid").write_text(str(os.getpid()))  # 測試自身行程必活
    code = main(["watcher-status", "--file", str(f)])
    assert code == 0
    assert "watcher: running (pid=%d)" % os.getpid() in capsys.readouterr().out


def test_watcher_status_dead_needing_rearm_exits_1(tmp_path, monkeypatch, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    (tmp_path / "watcher.pid").write_text("12345")
    monkeypatch.setattr(cli, "_pid_alive", lambda pid: False)
    code = main(["watcher-status", "--file", str(f)])
    out = capsys.readouterr().out
    assert code == 1
    assert "watcher: dead (stale pid=12345)" in out
    assert "hint:" in out and "arm-local" in out


def test_watcher_status_done_phase_needs_no_watcher(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="done", change_id="c", branch="b", resume_exec="true").save(f)
    code = main(["watcher-status", "--file", str(f)])
    assert code == 0
    assert "watcher: not armed" in capsys.readouterr().out


def test_watcher_status_shows_last_attempt_from_log(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    (tmp_path / "watcher.pid").write_text(str(os.getpid()))
    log = tmp_path / "watcher-log.jsonl"
    log.write_text(
        json.dumps({"ts": "2026-07-09T00:00:00+00:00", "exit_code": 1,
                    "output_tail": "usage limit", "action": "retry", "heartbeat": 1800})
        + "\n", encoding="utf-8")
    main(["watcher-status", "--file", str(f)])
    out = capsys.readouterr().out
    assert "last attempt: 2026-07-09T00:00:00+00:00 exit=1 retry" in out
    assert "output tail: usage limit" in out


def test_watcher_status_tolerates_corrupt_log_lines(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    (tmp_path / "watcher.pid").write_text(str(os.getpid()))
    (tmp_path / "watcher-log.jsonl").write_text(
        'not json\n{"ts": "t", "exit_code": 0, "action": "stop"}\n', encoding="utf-8")
    code = main(["watcher-status", "--file", str(f)])
    assert code == 0
    assert "exit=0" in capsys.readouterr().out


# --- status 的 watcher 缺席警告(stderr,stdout 契約不變)---


def test_status_warns_when_watcher_missing(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    code = main(["status", "--file", str(f)])
    assert code == 0
    captured = capsys.readouterr()
    assert "warning: watcher not running" in captured.err
    assert "arm-local" in captured.err
    assert "warning" not in captured.out  # stdout 契約不變


def test_status_no_warning_when_watcher_alive(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    (tmp_path / "watcher.pid").write_text(str(os.getpid()))
    main(["status", "--file", str(f)])
    assert "warning" not in capsys.readouterr().err


def test_status_no_warning_without_resume_exec(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    main(["status", "--file", str(f)])
    assert "warning" not in capsys.readouterr().err


def test_status_no_warning_when_done(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="done", change_id="c", branch="b", resume_exec="true").save(f)
    main(["status", "--file", str(f)])
    assert "warning" not in capsys.readouterr().err


def test_ensure_armed_passes_log_path_to_spawn(tmp_path, monkeypatch):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", resume_exec="true").save(f)
    captured = {}

    def fake_spawn(cmd, hb, log_path=None):
        captured["log_path"] = log_path
        return 4242

    monkeypatch.setattr(cli, "_spawn_watcher", fake_spawn)
    status, _ = cli.ensure_armed(str(f))
    assert status == "armed"
    assert str(captured["log_path"]) == str(tmp_path / "watcher-log.jsonl")

import json

from devloop.checkpoint import Checkpoint
from devloop.cli import main
from devloop.history import append_history, history_path


def _read_history(cp_path):
    p = history_path(cp_path)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines()]


def test_append_history_writes_jsonl(tmp_path):
    cp_path = tmp_path / "cp.json"
    append_history(cp_path, "apply_done", "apply", "gate", 0)
    entries = _read_history(cp_path)
    assert len(entries) == 1
    e = entries[0]
    assert e["event"] == "apply_done"
    assert e["from"] == "apply"
    assert e["to"] == "gate"
    assert e["iteration"] == 0
    assert e["ts"]  # ISO 時間戳


def test_start_appends_history_entry(tmp_path):
    f = tmp_path / "cp.json"
    main(["start", "--file", str(f), "--change-id", "c", "--branch", "b"])
    entries = _read_history(f)
    assert len(entries) == 1
    assert entries[0]["event"] == "start"
    assert entries[0]["from"] is None
    assert entries[0]["to"] == "apply"


def test_event_appends_transition(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)
    main(["event", "--file", str(f), "--event", "apply_done"])
    entries = _read_history(f)
    assert entries[-1] == {**entries[-1], "event": "apply_done", "from": "apply", "to": "gate"}


def test_gate_appends_transition_and_history_accumulates(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    main(["gate", "--file", str(f), "--cmd", "false"])  # gate → fix
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    main(["gate", "--file", str(f), "--cmd", "true"])  # gate → qa
    entries = _read_history(f)
    assert [e["event"] for e in entries] == ["gate_fail", "gate_pass"]
    assert entries[0]["to"] == "fix"
    assert entries[1]["to"] == "qa"


def test_invalid_transition_appends_nothing(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "gate_pass"])
    assert code == 2
    assert _read_history(f) == []


def test_history_failure_warns_but_command_succeeds(tmp_path, monkeypatch, capsys):
    import devloop.cli as cli

    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(cli, "append_history", boom)
    code = main(["event", "--file", str(f), "--event", "apply_done"])
    assert code == 0
    captured = capsys.readouterr()
    assert "phase=gate" in captured.out
    assert "warning: history append failed" in captured.err

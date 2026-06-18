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


def test_gate_supports_multiword_commands(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    # 多字詞命令(如真實的 `pytest tests/`)須被正確切分為 argv,而非當成單一執行檔
    code = main(["gate", "--file", str(f), "--cmd", "sh -c 'exit 0'"])
    assert code == 0
    assert Checkpoint.load(f).phase == "review"


from datetime import timezone, datetime, timedelta
import json


def test_resume_ready_when_no_reset_at(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    code = main(["resume", "--file", str(f)])
    assert code == 0
    out = capsys.readouterr().out
    assert "ready=True" in out
    assert "sleep_seconds=0" in out
    assert "phase=review" in out


def test_resume_not_ready_when_reset_in_future(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="fix", change_id="c", branch="b").save(f)
    future = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    code = main(["resume", "--file", str(f), "--reset-at", future])
    assert code == 0
    out = capsys.readouterr().out
    assert "ready=False" in out
    assert "sleep_seconds=3600" in out


def test_review_no_blocking_advances_to_merge(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "non_blocking", "level": "code", "note": "rename x"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    cp = Checkpoint.load(f)
    assert cp.phase == "merge"
    assert cp.non_blocking == ["rename x"]


def test_review_blocking_code_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "code", "note": "bug"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    assert Checkpoint.load(f).phase == "fix"


def test_review_blocking_proposal_routes_to_propose(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "proposal", "note": "spec wrong"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    assert Checkpoint.load(f).phase == "propose"


def test_invalid_event_returns_clean_error(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "gate_pass"])
    assert code == 2
    err = capsys.readouterr().err
    assert "error" in err.lower()
    # checkpoint 不應被改動
    assert Checkpoint.load(f).phase == "merge"


def test_gate_timeout_flag_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    code = main(["gate", "--file", str(f), "--cmd", "sh -c 'sleep 5'", "--timeout", "1"])
    assert code == 1
    assert Checkpoint.load(f).phase == "fix"


def test_validate_change_subcommand(tmp_path, monkeypatch, capsys):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="propose", change_id="add-foo", branch="b").save(f)
    seen = {}

    def fake_validate(change_id, runner=None):
        seen["id"] = change_id
        return OpenSpecResult(ok=True, command=["openspec", "validate", change_id], output="ok")

    monkeypatch.setattr(cli, "validate_change", fake_validate)
    code = cli.main(["validate-change", "--file", str(f)])
    assert code == 0
    assert seen["id"] == "add-foo"


def test_validate_change_failure_returns_1(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="propose", change_id="bad", branch="b").save(f)
    monkeypatch.setattr(
        cli, "validate_change",
        lambda change_id, runner=None: OpenSpecResult(ok=False, command=["openspec", "validate", change_id], output="invalid"),
    )
    assert cli.main(["validate-change", "--file", str(f)]) == 1


def test_archive_subcommand(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="add-foo", branch="b").save(f)
    seen = {}

    def fake_archive(change_id, runner=None):
        seen["id"] = change_id
        return OpenSpecResult(ok=True, command=["openspec", "archive", change_id], output="archived")

    monkeypatch.setattr(cli, "archive_change", fake_archive)
    code = cli.main(["archive", "--file", str(f)])
    assert code == 0
    assert seen["id"] == "add-foo"


def test_archive_failure_returns_1(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="x", branch="b").save(f)
    monkeypatch.setattr(
        cli, "archive_change",
        lambda change_id, runner=None: OpenSpecResult(ok=False, command=["openspec", "archive", change_id], output="nope"),
    )
    assert cli.main(["archive", "--file", str(f)]) == 1

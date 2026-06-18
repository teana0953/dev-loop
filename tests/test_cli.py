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

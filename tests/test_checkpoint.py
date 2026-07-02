from devloop.checkpoint import Checkpoint


def test_save_then_load_roundtrip(tmp_path):
    path = tmp_path / "checkpoint.json"
    cp = Checkpoint(
        phase="apply",
        change_id="add-foo",
        branch="loop/add-foo",
        iteration=2,
        last_artifact="docs/review-1.md",
        non_blocking=["rename x", "add docstring"],
    )
    cp.save(path)

    loaded = Checkpoint.load(path)
    assert loaded.phase == "apply"
    assert loaded.change_id == "add-foo"
    assert loaded.branch == "loop/add-foo"
    assert loaded.iteration == 2
    assert loaded.last_artifact == "docs/review-1.md"
    assert loaded.non_blocking == ["rename x", "add docstring"]


def test_save_sets_updated_at(tmp_path):
    path = tmp_path / "checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.updated_at == ""
    cp.save(path)
    assert cp.updated_at != ""
    assert Checkpoint.load(path).updated_at == cp.updated_at


def test_defaults(tmp_path):
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.iteration == 0
    assert cp.last_artifact == ""
    assert cp.non_blocking == []


def test_resume_exec_defaults_none(tmp_path):
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.resume_exec is None


def test_resume_exec_roundtrip(tmp_path):
    path = tmp_path / "checkpoint.json"
    cp = Checkpoint(
        phase="apply",
        change_id="c",
        branch="b",
        resume_exec="claude -p '/dev-loop resume'",
    )
    cp.save(path)
    assert Checkpoint.load(path).resume_exec == "claude -p '/dev-loop resume'"


def test_save_creates_missing_parent_dirs(tmp_path):
    # checkpoint 路徑的父目錄(如 .devloop/)不存在時,save 應自動建立
    path = tmp_path / ".devloop" / "checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    cp.save(path)
    assert Checkpoint.load(path).phase == "apply"


import json
from devloop.checkpoint import Checkpoint


def test_units_and_legs_default_empty():
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.units == []
    assert cp.review_legs == []


def test_units_roundtrip(tmp_path):
    path = tmp_path / "cp.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="b",
                    units=[{"id": "g1", "status": "pending"}],
                    review_legs=[{"kind": "code", "status": "pending"}])
    cp.save(path)
    loaded = Checkpoint.load(path)
    assert loaded.units == [{"id": "g1", "status": "pending"}]
    assert loaded.review_legs == [{"kind": "code", "status": "pending"}]


def test_load_legacy_checkpoint_without_units(tmp_path):
    path = tmp_path / "legacy.json"
    path.write_text(json.dumps({
        "phase": "apply", "change_id": "c", "branch": "b",
        "iteration": 0, "last_artifact": "", "non_blocking": [],
        "updated_at": "", "resume_exec": None,
    }), encoding="utf-8")
    loaded = Checkpoint.load(path)
    assert loaded.units == []
    assert loaded.review_legs == []


def test_propose_attempts_and_gate_failures_default_zero():
    cp = Checkpoint(phase="apply", change_id="c", branch="b")
    assert cp.propose_attempts == 0
    assert cp.gate_failures == 0


def test_propose_attempts_and_gate_failures_roundtrip(tmp_path):
    path = tmp_path / "cp.json"
    cp = Checkpoint(phase="proposal_review", change_id="c", branch="b",
                    propose_attempts=2, gate_failures=1)
    cp.save(path)
    loaded = Checkpoint.load(path)
    assert loaded.propose_attempts == 2
    assert loaded.gate_failures == 1


def test_load_legacy_checkpoint_without_propose_attempts_or_gate_failures(tmp_path):
    path = tmp_path / "legacy_v2.json"
    path.write_text(json.dumps({
        "phase": "apply", "change_id": "c", "branch": "b",
        "iteration": 0, "last_artifact": "", "non_blocking": [],
        "updated_at": "", "resume_exec": None,
        "units": [], "review_legs": [],
    }), encoding="utf-8")
    loaded = Checkpoint.load(path)
    assert loaded.propose_attempts == 0
    assert loaded.gate_failures == 0

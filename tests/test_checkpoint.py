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

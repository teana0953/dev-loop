
import devloop.cli as cli
from devloop.checkpoint import Checkpoint
from devloop.cli import main
from devloop.housekeeping import archive_workfiles
from devloop.openspec import OpenSpecResult


def _setup_workdir(tmp_path):
    """典型跑完一輪的 .devloop:報告、followup、history、watcher 檔、meta。"""
    root = tmp_path / ".devloop"
    root.mkdir()
    cp = root / "checkpoint.json"
    Checkpoint(phase="merge", change_id="add-foo", branch="loop/add-foo").save(cp)
    (root / "config.json").write_text('{"finish": "merge"}', encoding="utf-8")
    (root / "watcher.pid").write_text("123", encoding="utf-8")
    for name in ("review-1.json", "qa-report-1.json", "pr-report-1.json",
                 "followup-add-foo.md", "history.jsonl", "watcher-log.jsonl"):
        (root / name).write_text("x", encoding="utf-8")
    (root / "changes").mkdir()
    (root / "changes" / "add-foo.json").write_text("{}", encoding="utf-8")
    (root / "wt").mkdir()
    (root / "wt" / "keep-me").write_text("worktree file", encoding="utf-8")
    return root, cp


def test_archive_workfiles_moves_reports_keeps_residents(tmp_path):
    root, cp = _setup_workdir(tmp_path)
    archived = archive_workfiles(cp, "add-foo")
    dest = root / "archive" / "add-foo"
    # 報告類全部搬走
    for name in ("review-1.json", "qa-report-1.json", "pr-report-1.json",
                 "followup-add-foo.md", "history.jsonl", "watcher-log.jsonl"):
        assert not (root / name).exists()
        assert (dest / name).exists()
    # 常駐檔不動
    assert (root / "checkpoint.json").exists()
    assert (root / "config.json").exists()
    assert (root / "watcher.pid").exists()
    assert not (dest / "config.json").exists()
    assert "review-1.json" in archived


def test_archive_workfiles_moves_change_meta_and_snapshots_checkpoint(tmp_path):
    root, cp = _setup_workdir(tmp_path)
    archived = archive_workfiles(cp, "add-foo")
    dest = root / "archive" / "add-foo"
    assert not (root / "changes" / "add-foo.json").exists()
    assert (dest / "add-foo.json").exists()
    # checkpoint:原檔保留 + 歸檔快照
    assert (root / "checkpoint.json").exists()
    assert (dest / "checkpoint.json").exists()
    assert "changes/add-foo.json" in archived
    assert "checkpoint.json (snapshot)" in archived


def test_archive_workfiles_ignores_subdirectories(tmp_path):
    root, cp = _setup_workdir(tmp_path)
    archive_workfiles(cp, "add-foo")
    assert (root / "wt" / "keep-me").exists()


def test_archive_workfiles_rerun_is_idempotent(tmp_path):
    root, cp = _setup_workdir(tmp_path)
    archive_workfiles(cp, "add-foo")
    # 再跑一次:已無工作檔,只剩 checkpoint 快照,不炸
    archived = archive_workfiles(cp, "add-foo")
    assert archived == ["checkpoint.json (snapshot)"]


def test_archive_workfiles_other_change_untouched(tmp_path):
    root, cp = _setup_workdir(tmp_path)
    (root / "changes" / "other-change.json").write_text("{}", encoding="utf-8")
    archive_workfiles(cp, "add-foo")
    assert (root / "changes" / "other-change.json").exists()


def test_archive_workfiles_empty_dir_returns_snapshot_only(tmp_path):
    root = tmp_path / ".devloop"
    root.mkdir()
    cp = root / "checkpoint.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(cp)
    assert archive_workfiles(cp, "c") == ["checkpoint.json (snapshot)"]


# --- cli archive 整合 ---


def test_cli_archive_success_archives_workfiles(tmp_path, monkeypatch, capsys):
    root, cp = _setup_workdir(tmp_path)
    monkeypatch.setattr(cli, "archive_change", lambda cid, runner=None: OpenSpecResult(
        ok=True, command=["openspec", "archive", cid], output="archived"))
    code = main(["archive", "--file", str(cp)])
    assert code == 0
    out = capsys.readouterr().out
    assert "archived workfiles:" in out
    assert not (root / "review-1.json").exists()
    assert (root / "archive" / "add-foo" / "review-1.json").exists()


def test_cli_archive_failure_leaves_workfiles_alone(tmp_path, monkeypatch):
    root, cp = _setup_workdir(tmp_path)
    monkeypatch.setattr(cli, "archive_change", lambda cid, runner=None: OpenSpecResult(
        ok=False, command=["openspec", "archive", cid], output="boom"))
    code = main(["archive", "--file", str(cp)])
    assert code == 1
    assert (root / "review-1.json").exists()
    assert not (root / "archive").exists()


def test_cli_archive_housekeeping_failure_warns_but_exit_0(tmp_path, monkeypatch, capsys):
    root, cp = _setup_workdir(tmp_path)
    monkeypatch.setattr(cli, "archive_change", lambda cid, runner=None: OpenSpecResult(
        ok=True, command=["openspec", "archive", cid], output="archived"))

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(cli, "archive_workfiles", boom)
    code = main(["archive", "--file", str(cp)])
    assert code == 0
    assert "warning: workfile archive failed" in capsys.readouterr().err

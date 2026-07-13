import subprocess
from pathlib import Path

import pytest

from devloop.teardown import (
    disarm_watcher, prune_orphan_worktrees, sweep_change_meta, delete_merged_branch,
)
from devloop.worktree import add_worktree


def _run(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True,
                   capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    _run(r, "init", "-b", "main")
    _run(r, "config", "user.email", "t@t")
    _run(r, "config", "user.name", "t")
    (r / "base.txt").write_text("base\n")
    _run(r, "add", "."); _run(r, "commit", "-m", "init")
    return r


def test_disarm_watcher_absent_when_no_pidfile(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    assert disarm_watcher(cp) == "absent"


def test_disarm_watcher_kills_live_process_and_removes_pidfile(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    proc = subprocess.Popen(["sleep", "30"])
    (tmp_path / "watcher.pid").write_text(str(proc.pid))
    assert disarm_watcher(cp) == "killed"
    assert not (tmp_path / "watcher.pid").exists()
    proc.wait(timeout=5)
    assert proc.returncode is not None


def test_disarm_watcher_dead_pid_removes_file(tmp_path):
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    # spawn+reap 取得一個必死的 pid
    proc = subprocess.Popen(["true"]); proc.wait()
    (tmp_path / "watcher.pid").write_text(str(proc.pid))
    assert disarm_watcher(cp) == "absent"
    assert not (tmp_path / "watcher.pid").exists()


def test_prune_orphan_worktrees_removes_under_root(repo, tmp_path):
    wt_root = repo / ".devloop" / "wt"
    add_worktree(repo, wt_root / "g1", "loop-g1", "main")
    removed = prune_orphan_worktrees(repo, wt_root)
    assert removed == 1
    assert not (wt_root / "g1").exists()


def test_prune_orphan_worktrees_noop_when_root_absent(repo, tmp_path):
    assert prune_orphan_worktrees(repo, repo / ".devloop" / "wt") == 0


def test_sweep_change_meta_moves_then_idempotent(tmp_path):
    cp = tmp_path / "checkpoint.json"; cp.write_text("{}")
    meta = tmp_path / "changes" / "c1.json"
    meta.parent.mkdir(parents=True); meta.write_text("{}")
    assert sweep_change_meta(cp, "c1") is True
    assert (tmp_path / "archive" / "c1" / "c1.json").exists()
    assert not meta.exists()
    assert sweep_change_meta(cp, "c1") is False


def test_delete_merged_branch_true_for_merged(repo):
    _run(repo, "checkout", "-b", "feat")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main"); _run(repo, "merge", "--no-ff", "-m", "m", "feat")
    assert delete_merged_branch(repo, "feat") is True


def test_delete_merged_branch_false_for_unmerged(repo):
    _run(repo, "checkout", "-b", "feat")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main")
    assert delete_merged_branch(repo, "feat") is False  # 未 merged,-d 拒刪

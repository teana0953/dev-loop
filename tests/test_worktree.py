# tests/test_worktree.py
import subprocess

import pytest

from devloop.worktree import (
    add_worktree, merge_branch, remove_worktree, list_worktree_paths,
)


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
    _run(r, "add", ".")
    _run(r, "commit", "-m", "init")
    return r


def test_add_and_list_worktree(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    assert wt.exists()
    paths = list_worktree_paths(repo)
    assert str(wt.resolve()) in paths
    assert str(repo.resolve()) not in paths  # 主工作區排除


def test_merge_no_conflict(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    (wt / "g1.txt").write_text("g1\n")
    _run(wt, "add", "."); _run(wt, "commit", "-m", "g1")
    res = merge_branch(repo, "loop-g1")
    assert res.ok is True and res.conflict is False
    assert (repo / "g1.txt").exists()


def test_merge_conflict_aborts(repo, tmp_path):
    # 兩個分支都改同一檔 base.txt → 衝突
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    (wt / "base.txt").write_text("from-g1\n")
    _run(wt, "add", "."); _run(wt, "commit", "-m", "g1 edits base")
    (repo / "base.txt").write_text("from-main\n")
    _run(repo, "add", "."); _run(repo, "commit", "-m", "main edits base")
    res = merge_branch(repo, "loop-g1")
    assert res.ok is False and res.conflict is True
    # abort 後工作區乾淨(無 merge 進行中)
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"],
                            capture_output=True, text=True)
    assert status.stdout.strip() == ""


def test_remove_worktree(repo, tmp_path):
    wt = tmp_path / "wt-g1"
    add_worktree(repo, wt, "loop-g1", "main")
    remove_worktree(repo, wt, "loop-g1")
    assert not wt.exists()
    assert str(wt.resolve()) not in list_worktree_paths(repo)


def test_worktree_exists(repo, tmp_path):
    from devloop.worktree import add_worktree, worktree_exists
    wt = tmp_path / "wt-g1"
    assert worktree_exists(repo, wt) is False
    add_worktree(repo, wt, "loop-g1", "main")
    assert worktree_exists(repo, wt) is True

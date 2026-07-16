import subprocess

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


from devloop.checkpoint import Checkpoint
from devloop.cli import main


def _teardown_repo_with_checkpoint(repo, mode):
    _run(repo, "checkout", "-b", "loop-x")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main"); _run(repo, "merge", "--no-ff", "-m", "m", "loop-x")
    cp = repo / ".devloop" / "checkpoint.json"
    Checkpoint(phase="teardown", change_id="x", branch="loop-x",
               finish_mode=mode).save(cp)
    return cp


def test_teardown_merge_deletes_branch_and_reaches_done(repo):
    cp = _teardown_repo_with_checkpoint(repo, "merge")
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    assert code == 0
    assert Checkpoint.load(cp).phase == "done"
    branches = subprocess.run(["git", "-C", str(repo), "branch"],
                              capture_output=True, text=True).stdout
    assert "loop-x" not in branches


def test_teardown_pr_keeps_branch(repo):
    cp = _teardown_repo_with_checkpoint(repo, "pr")
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "pr"])
    assert code == 0
    assert Checkpoint.load(cp).phase == "done"
    branches = subprocess.run(["git", "-C", str(repo), "branch"],
                              capture_output=True, text=True).stdout
    assert "loop-x" in branches


def test_teardown_idempotent_on_done(repo):
    cp = _teardown_repo_with_checkpoint(repo, "merge")
    main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    # 已 done;重跑會嘗試 transition(done, teardown_done) → InvalidTransition,回非 0 但不炸
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    assert code != 0
    assert Checkpoint.load(cp).phase == "done"


def test_teardown_done_does_not_rearm_watcher(repo):
    """teardown 先 disarm_watcher,結尾 _save_with_history 走 auto-arm 路徑;
    done 終態不該被重新 arm(否則永遠對 done 的 checkpoint 續跑,抵消 disarm)。"""
    _run(repo, "checkout", "-b", "loop-x")
    (repo / "f.txt").write_text("x\n"); _run(repo, "add", "."); _run(repo, "commit", "-m", "f")
    _run(repo, "checkout", "main"); _run(repo, "merge", "--no-ff", "-m", "m", "loop-x")
    devloop_dir = repo / ".devloop"
    devloop_dir.mkdir(parents=True, exist_ok=True)
    (devloop_dir / "config.json").write_text('{"auto_arm": true}')
    cp = devloop_dir / "checkpoint.json"
    Checkpoint(phase="teardown", change_id="x", branch="loop-x",
               finish_mode="merge", resume_exec="sleep 999").save(cp)
    code = main(["teardown", "--file", str(cp), "--repo", str(repo), "--mode", "merge"])
    assert code == 0
    assert Checkpoint.load(cp).phase == "done"
    assert not (devloop_dir / "watcher.pid").exists()  # 終態不得重新 arm

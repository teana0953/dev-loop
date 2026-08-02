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


# --- symlink 解析(fixtures/parity/worktree.json 釘不到的那一半)---
#
# 那份 fixture 的每個 case 都用不存在的假路徑,resolve() 對它們原樣回傳,
# 所以把 list_worktree_paths / worktree_exists 裡的 .resolve() 拿掉,
# 兩側 parity 測試依然全綠。symlink 沒辦法用 JSON 表達,只能由測試自己造。
#
# 刻意不依賴 macOS 的 /tmp -> /private/tmp:CI 是 ubuntu-latest,那裡 /tmp
# 是真目錄。對稱測試:plugins/dev-loop/src/worktree.test.ts。


def test_list_worktree_paths_resolves_a_symlinked_parent(repo, tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    wt = link / "w"
    add_worktree(repo, wt, "loop-sym", "main")
    paths = list_worktree_paths(repo)
    assert paths == [str((real / "w").resolve())]
    # 沒解 symlink 的形狀不該出現——確認上面那條真的在區分兩者
    assert str(wt) not in paths


def test_list_worktree_paths_excludes_main_when_the_repo_is_addressed_via_symlink(tmp_path):
    # 主工作區的排除比對是 `str(Path(repo).resolve())` vs git 印出的實體路徑。
    # repo 從 symlink 進來時,不 resolve 就比不到,主工作區會混進回傳清單,
    # 於是 prune_orphan_worktrees 可能把主 repo 當孤兒處理。
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    r = real / "repo"
    r.mkdir()
    _run(r, "init", "-b", "main")
    _run(r, "config", "user.email", "t@t")
    _run(r, "config", "user.name", "t")
    (r / "base.txt").write_text("base\n")
    _run(r, "add", "."); _run(r, "commit", "-m", "init")
    assert list_worktree_paths(link / "repo") == []


def test_worktree_exists_through_a_symlinked_parent(repo, tmp_path):
    from devloop.worktree import worktree_exists
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    wt = link / "w"
    add_worktree(repo, wt, "loop-sym", "main")
    # git porcelain 印實體路徑,呼叫端給的是穿過 symlink 的路徑
    assert worktree_exists(repo, wt) is True

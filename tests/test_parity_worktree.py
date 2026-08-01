import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.worktree import list_worktree_paths  # noqa: F401  (確認模組可 import)

SECTIONS = ["parseWorktreePaths"]


def _parse_py(porcelain, repo_resolved):
    """Python 沒有把解析抽成函式,這裡照 list_worktree_paths 的迴圈重現。
    兩邊釘的是同一個演算法,不是同一個函式簽名。"""
    from pathlib import Path
    paths = []
    for line in porcelain.splitlines():
        if line.startswith("worktree "):
            p = str(Path(line[len("worktree "):]).resolve())
            if p != repo_resolved:
                paths.append(p)
    return paths


@pytest.mark.parametrize("case", parity_cases("worktree", "parseWorktreePaths", SECTIONS))
def test_parse_worktree_paths_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "parseWorktreePaths never raises"
    got = _parse_py(case["porcelain"], case["repo_resolved"])
    assert_subset({"value": got}, expect, case["name"])

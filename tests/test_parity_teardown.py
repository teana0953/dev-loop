import pytest

from conftest import assert_subset, parity_cases, resolve_expectation

SECTIONS = ["classifyBranchDeleteError"]


def _classify_py(code, stderr):
    """Python 沒有把分類抽成函式,這裡照 delete_merged_branch 的判斷重現。
    兩邊釘的是同一個演算法,不是同一個函式簽名(同 worktree 的處理)。"""
    if code == 0:
        return "deleted"
    err = stderr.lower()
    if "checked out" in err or "used by worktree" in err:
        return "checked_out"
    if "not found" in err:
        return "absent"
    return "unmerged"


@pytest.mark.parametrize("case", parity_cases("teardown", "classifyBranchDeleteError", SECTIONS))
def test_classify_branch_delete_error_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "classification never raises"
    got = _classify_py(case["code"], case["stderr"])
    assert_subset({"value": got}, expect, case["name"])

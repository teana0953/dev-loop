from devloop.units import build_units, pending_units, mark, all_done, all_merged


GROUPS = [
    {"id": "g1", "tasks": ["1", "2"], "files_hint": ["a/"]},
    {"id": "g2", "tasks": ["3"], "files_hint": ["b/"]},
]


def test_build_units_paths_and_branches():
    units = build_units(GROUPS, branch="loop/x", wt_root=".devloop/wt")
    assert units[0] == {
        "id": "g1", "tasks": ["1", "2"],
        "worktree": ".devloop/wt/g1", "branch": "loop/x-g1", "status": "pending",
    }
    assert units[1]["branch"] == "loop/x-g2"


def test_pending_units_includes_in_progress():
    units = build_units(GROUPS, "b", ".w")
    mark(units, "g1", "in_progress")
    mark(units, "g2", "done")
    pend = pending_units(units)
    assert [u["id"] for u in pend] == ["g1"]


def test_all_done_and_all_merged():
    units = build_units(GROUPS, "b", ".w")
    assert all_done(units) is False
    mark(units, "g1", "done")
    mark(units, "g2", "merged")
    assert all_done(units) is True
    assert all_merged(units) is False
    mark(units, "g1", "merged")
    assert all_merged(units) is True

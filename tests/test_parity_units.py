import copy

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.units import all_done, all_merged, build_units, mark, pending_units

SECTIONS = ["buildUnits", "pendingUnits", "mark", "allDone", "allMerged"]


@pytest.mark.parametrize("case", parity_cases("units", "buildUnits", SECTIONS))
def test_build_units_parity(case):
    expect, throws = resolve_expectation(case, "py")
    args = (case["parallel_groups"], case["branch"], case["wt_root"])
    if throws:
        with pytest.raises(Exception):
            build_units(*args)
        return
    assert_subset({"value": build_units(*args)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "pendingUnits", SECTIONS))
def test_pending_units_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            pending_units(case["units"])
        return
    assert_subset({"value": pending_units(case["units"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "mark", SECTIONS))
def test_mark_parity(case):
    # mark 就地改動,所以複製一份再餵,避免 fixture 讀到的物件被跨 case 汙染
    units = copy.deepcopy(case["units"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            mark(units, case["unit_id"], case["status"])
        return
    mark(units, case["unit_id"], case["status"])
    assert_subset({"value": units}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "allDone", SECTIONS))
def test_all_done_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            all_done(case["units"])
        return
    assert_subset({"value": all_done(case["units"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "allMerged", SECTIONS))
def test_all_merged_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            all_merged(case["units"])
        return
    assert_subset({"value": all_merged(case["units"])}, expect, case["name"])

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.finish import render_followup

SECTIONS = ["renderFollowup"]


@pytest.mark.parametrize("case", parity_cases("followup", "renderFollowup", SECTIONS))
def test_render_followup_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            render_followup(case["notes"])
        return
    assert_subset({"value": render_followup(case["notes"])}, expect, case["name"])

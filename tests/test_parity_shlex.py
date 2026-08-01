import shlex

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation

SECTIONS = ["split", "quote", "join", "roundTrip"]


@pytest.mark.parametrize("case", parity_cases("shlex", "split", SECTIONS))
def test_shlex_split_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            shlex.split(case["input"])
        return
    assert_subset({"value": shlex.split(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "quote", SECTIONS))
def test_shlex_quote_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "quote never raises"
    assert_subset({"value": shlex.quote(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "join", SECTIONS))
def test_shlex_join_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "join never raises"
    assert_subset({"value": shlex.join(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "roundTrip", SECTIONS))
def test_shlex_round_trip_parity(case):
    # split(join(split(x))) == split(x) —— 對兩引擎都成立的不變量。
    # 這裡不用 resolve_expectation:roundTrip 的 case 刻意沒有 expect。
    parts = shlex.split(case["input"])
    assert shlex.split(shlex.join(parts)) == parts, case["name"]

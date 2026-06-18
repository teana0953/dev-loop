import pytest

from devloop.statemachine import (
    APPLY_DONE,
    FIX_DONE,
    GATE_FAIL,
    GATE_PASS,
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
    InvalidTransition,
    transition,
)


def test_apply_done_goes_to_gate():
    assert transition("apply", 0, APPLY_DONE) == ("gate", 0)


def test_gate_pass_enters_review_and_increments_iteration():
    assert transition("gate", 0, GATE_PASS) == ("review", 1)


def test_gate_fail_goes_to_fix_without_incrementing():
    assert transition("gate", 1, GATE_FAIL) == ("fix", 1)


def test_review_no_blocking_goes_to_merge():
    assert transition("review", 1, REVIEW_NO_BLOCKING) == ("merge", 1)


def test_review_blocking_code_goes_to_fix():
    assert transition("review", 1, REVIEW_BLOCKING_CODE) == ("fix", 1)


def test_review_blocking_proposal_escapes_to_propose():
    assert transition("review", 1, REVIEW_BLOCKING_PROPOSAL) == ("propose", 1)


def test_fix_done_returns_to_gate():
    assert transition("fix", 1, FIX_DONE) == ("gate", 1)


def test_invalid_transition_raises():
    with pytest.raises(InvalidTransition):
        transition("merge", 1, GATE_PASS)

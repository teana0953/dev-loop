import pytest

from devloop.statemachine import (
    APPLY_DONE,
    FIX_DONE,
    GATE_FAIL,
    GATE_PASS,
    PROPOSE_BLOCKING_DESIGN,
    PROPOSE_BLOCKING_PROPOSAL,
    PROPOSE_CLEAN,
    QA_FAIL,
    QA_PASS,
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
    InvalidTransition,
    transition,
)


def test_apply_done_goes_to_gate():
    assert transition("apply", 0, APPLY_DONE) == ("gate", 0)


def test_gate_pass_enters_qa_and_increments_iteration():
    assert transition("gate", 0, GATE_PASS) == ("qa", 1)


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


def test_gate_pass_within_limit_enters_qa():
    # max=3:iteration 0->1, 1->2, 2->3 都還在範圍內
    assert transition("gate", 2, GATE_PASS, max_iterations=3) == ("qa", 3)


def test_gate_pass_exceeding_limit_escalates():
    # 第 4 次 gate_pass(3->4)超過上限 → escalated
    assert transition("gate", 3, GATE_PASS, max_iterations=3) == ("escalated", 4)


def test_qa_pass_enters_review_without_incrementing():
    assert transition("qa", 2, QA_PASS) == ("review", 2)


def test_qa_fail_goes_to_fix():
    assert transition("qa", 2, QA_FAIL) == ("fix", 2)


def test_proposal_review_clean_to_apply():
    assert transition("proposal_review", 0, PROPOSE_CLEAN) == ("apply", 0)


def test_proposal_review_blocking_proposal_to_propose():
    assert transition("proposal_review", 0, PROPOSE_BLOCKING_PROPOSAL) == ("propose", 0)


def test_proposal_review_blocking_design_escalates():
    assert transition("proposal_review", 0, PROPOSE_BLOCKING_DESIGN) == ("escalated", 0)

import pytest

from devloop.statemachine import (
    APPLY_DONE,
    FINISH_DONE,
    FIX_DONE,
    GATE_FAIL,
    GATE_PASS,
    GATE_RETRY_EXCEEDED,
    HUMAN_RESUME_FIX,
    HUMAN_RESUME_PROPOSE,
    PHASES,
    PROPOSE_BLOCKING_DESIGN,
    PROPOSE_BLOCKING_PROPOSAL,
    PROPOSE_CLEAN,
    PROPOSE_DONE,
    PROPOSE_RETRY_EXCEEDED,
    QA_FAIL,
    QA_PASS,
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
    InvalidTransition,
    next_hint,
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


def test_qa_invalid_event_raises():
    with pytest.raises(InvalidTransition):
        transition("qa", 1, GATE_PASS)


def test_merge_finish_done_to_done():
    assert transition("merge", 2, FINISH_DONE) == ("done", 2)


def test_merge_only_accepts_finish_done():
    with pytest.raises(InvalidTransition):
        transition("merge", 2, GATE_PASS)


def test_done_is_terminal():
    with pytest.raises(InvalidTransition):
        transition("done", 2, FINISH_DONE)


def test_propose_done_returns_to_proposal_review():
    assert transition("propose", 1, PROPOSE_DONE) == ("proposal_review", 1)


def test_propose_done_rejected_outside_propose():
    with pytest.raises(InvalidTransition):
        transition("apply", 1, PROPOSE_DONE)


def test_propose_retry_exceeded_escalates():
    assert transition("proposal_review", 1, PROPOSE_RETRY_EXCEEDED) == ("escalated", 1)


def test_propose_retry_exceeded_rejected_outside_proposal_review():
    with pytest.raises(InvalidTransition):
        transition("propose", 1, PROPOSE_RETRY_EXCEEDED)


def test_gate_retry_exceeded_escalates():
    assert transition("gate", 3, GATE_RETRY_EXCEEDED) == ("escalated", 3)


def test_gate_retry_exceeded_rejected_outside_gate():
    with pytest.raises(InvalidTransition):
        transition("fix", 1, GATE_RETRY_EXCEEDED)


def test_human_resume_propose_from_escalated():
    assert transition("escalated", 4, HUMAN_RESUME_PROPOSE) == ("propose", 4)


def test_human_resume_fix_from_escalated():
    assert transition("escalated", 4, HUMAN_RESUME_FIX) == ("fix", 4)


def test_human_resume_fix_rejected_outside_escalated():
    with pytest.raises(InvalidTransition):
        transition("review", 1, HUMAN_RESUME_FIX)


def test_human_resume_propose_rejected_outside_escalated():
    with pytest.raises(InvalidTransition):
        transition("qa", 1, HUMAN_RESUME_PROPOSE)


# ---------------------------------------------------------------------------
# next_hint(task 2.1/2.2)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phase", PHASES)
def test_next_hint_covers_every_phase(phase):
    hint = next_hint(phase, "/x/.devloop/checkpoint.json")
    assert hint.startswith("next: ")
    assert hint != "next: "


def test_next_hint_gate_gives_command_skeleton():
    hint = next_hint("gate", "/x/.devloop/checkpoint.json")
    assert hint.startswith("next: ")
    assert "devloop.cli gate" in hint
    assert "/x/.devloop/checkpoint.json" in hint


def test_next_hint_qa_gives_command_skeleton():
    hint = next_hint("qa", "/x/cp.json")
    assert "devloop.cli qa" in hint


def test_next_hint_review_gives_command_skeleton():
    hint = next_hint("review", "/x/cp.json")
    assert "devloop.cli review" in hint


def test_next_hint_merge_gives_finish_skeleton():
    hint = next_hint("merge", "/x/cp.json")
    assert "devloop.cli finish" in hint


def test_next_hint_judgment_phases_use_dispatch():
    for phase in ("brainstorm", "propose", "apply", "fix"):
        hint = next_hint(phase, "/x/cp.json")
        assert "dispatch" in hint


def test_next_hint_done_is_explicit_terminal():
    assert next_hint("done", "/x/cp.json") == "next: (done)"


def test_next_hint_escalated_is_explicit_terminal():
    hint = next_hint("escalated", "/x/cp.json")
    assert "escalated" in hint
    assert "human_resume" in hint


def test_next_hint_apply_with_pending_units_prioritized():
    units = [
        {"id": "g1", "status": "done"},
        {"id": "g2", "status": "pending"},
    ]
    hint = next_hint("apply", "/x/cp.json", units=units)
    assert "g2" in hint or "units-status" in hint


def test_next_hint_apply_without_pending_units_falls_back_to_dispatch():
    units = [{"id": "g1", "status": "merged"}]
    hint = next_hint("apply", "/x/cp.json", units=units)
    assert "dispatch" in hint


def test_next_hint_review_with_pending_legs_prioritized():
    legs = [
        {"kind": "code", "status": "collected", "report": "c.json"},
        {"kind": "uiux", "status": "pending", "report": ""},
    ]
    hint = next_hint("review", "/x/cp.json", review_legs=legs)
    assert "uiux" in hint
    assert "leg-done" in hint


def test_next_hint_review_with_all_legs_collected_gives_review_command():
    legs = [{"kind": "code", "status": "collected", "report": "c.json"}]
    hint = next_hint("review", "/x/cp.json", review_legs=legs)
    assert "devloop.cli review" in hint

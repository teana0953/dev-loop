from __future__ import annotations

# Phases(規格 4)
PHASES = (
    "brainstorm",
    "propose",
    "apply",
    "gate",
    "qa",
    "review",
    "fix",
    "merge",
    "escalated",
    "done",
)

# Events
APPLY_DONE = "apply_done"
GATE_PASS = "gate_pass"
GATE_FAIL = "gate_fail"
QA_PASS = "qa_pass"
QA_FAIL = "qa_fail"
REVIEW_NO_BLOCKING = "review_no_blocking"
REVIEW_BLOCKING_CODE = "review_blocking_code"
REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal"
FIX_DONE = "fix_done"

DEFAULT_MAX_ITERATIONS = 3


class InvalidTransition(Exception):
    """目前階段不接受該事件。"""


def transition(phase, iteration, event, max_iterations=DEFAULT_MAX_ITERATIONS):
    """純函式狀態轉移。回傳 (new_phase, new_iteration)。

    iteration 在 gate_pass 進入 qa 時 +1(代表第幾輪 qa/review);
    超過 max_iterations 則轉為 escalated。
    """
    if phase == "apply" and event == APPLY_DONE:
        return ("gate", iteration)
    if phase == "gate" and event == GATE_PASS:
        new_iteration = iteration + 1
        if new_iteration > max_iterations:
            return ("escalated", new_iteration)
        return ("qa", new_iteration)
    if phase == "qa" and event == QA_PASS:
        return ("review", iteration)
    if phase == "qa" and event == QA_FAIL:
        return ("fix", iteration)
    if phase == "gate" and event == GATE_FAIL:
        return ("fix", iteration)
    if phase == "review" and event == REVIEW_NO_BLOCKING:
        return ("merge", iteration)
    if phase == "review" and event == REVIEW_BLOCKING_CODE:
        return ("fix", iteration)
    if phase == "review" and event == REVIEW_BLOCKING_PROPOSAL:
        return ("propose", iteration)
    if phase == "fix" and event == FIX_DONE:
        return ("gate", iteration)
    raise InvalidTransition("no transition from %r on %r" % (phase, event))

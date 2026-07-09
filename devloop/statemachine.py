from __future__ import annotations

# Phases(規格 4)
PHASES = (
    "brainstorm",
    "propose",
    "proposal_review",
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
PROPOSE_CLEAN = "propose_clean"
PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal"
PROPOSE_BLOCKING_DESIGN = "propose_blocking_design"
GATE_PASS = "gate_pass"
GATE_FAIL = "gate_fail"
QA_PASS = "qa_pass"
QA_FAIL = "qa_fail"
REVIEW_NO_BLOCKING = "review_no_blocking"
REVIEW_BLOCKING_CODE = "review_blocking_code"
REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal"
FIX_DONE = "fix_done"
FINISH_DONE = "finish_done"
PROPOSE_DONE = "propose_done"
PROPOSE_RETRY_EXCEEDED = "propose_retry_exceeded"
GATE_RETRY_EXCEEDED = "gate_retry_exceeded"
HUMAN_RESUME_PROPOSE = "human_resume_propose"
HUMAN_RESUME_FIX = "human_resume_fix"

DEFAULT_MAX_ITERATIONS = 3


class InvalidTransition(Exception):
    """目前階段不接受該事件。"""


# phase → next hint 產生器(規格 cli-status)。確定性步驟給命令骨架、
# 判斷型步驟給 dispatch 說明、終態明確收束。
_DETERMINISTIC_HINTS = {
    "proposal_review":
        lambda f: "next: python3 -m devloop.cli proposal-review --file %s --report <pr.json>" % f,
    "gate":
        lambda f: 'next: python3 -m devloop.cli gate --file %s --cmd "<test-cmd>" [--cmd "<lint-cmd>"]' % f,
    "qa":
        lambda f: "next: python3 -m devloop.cli qa --file %s --report <qa.json>" % f,
    "review":
        lambda f: "next: python3 -m devloop.cli review --file %s --from-legs" % f,
    "merge":
        lambda f: ("next: python3 -m devloop.cli finish --file %s "
                    "--config <config.json> --meta <meta.json> --followup <followup.md>") % f,
}

_JUDGMENT_HINTS = {
    "brainstorm": "next: dispatch brainstorming(產出設計文件,批准後 propose)",
    "propose": "next: dispatch propose(建立 OpenSpec change,完成後 event --event propose_done)",
    "apply": "next: dispatch apply(TDD 實作 tasks,完成後 event --event apply_done)",
    "fix": "next: dispatch fix(處理 blocking 項,完成後 event --event fix_done)",
}

_TERMINAL_HINTS = {
    "done": "next: (done)",
    "escalated": ("next: (escalated)人工升級後續跑:event --event human_resume_propose "
                  "或 human_resume_fix"),
}


def next_hint(phase, checkpoint_path, units=None, review_legs=None, gate_cmds=None):
    """依 phase(與 units/review_legs pending 狀態)給下一步 hint,恆以 `next: ` 開頭。

    gate_cmds 非空(config 已存 gate 命令)時,gate hint 給完整可執行命令
    (引擎會 fallback 到 config),而非 `<test-cmd>` 骨架。"""
    if phase == "gate" and gate_cmds:
        return "next: python3 -m devloop.cli gate --file %s" % checkpoint_path
    if phase in ("apply", "fix") and units:
        pending = [u["id"] for u in units if u.get("status") in ("pending", "in_progress")]
        if pending:
            return ("next: units pending: %s -> python3 -m devloop.cli units-status --file %s"
                    % (",".join(pending), checkpoint_path))
    if phase == "review" and review_legs:
        pending_legs = [l["kind"] for l in review_legs if l.get("status") != "collected"]
        if pending_legs:
            return ("next: legs pending: %s -> python3 -m devloop.cli leg-done --file %s "
                     "--kind <kind> --report <report.json>"
                     % (",".join(pending_legs), checkpoint_path))
    if phase in _TERMINAL_HINTS:
        return _TERMINAL_HINTS[phase]
    if phase in _DETERMINISTIC_HINTS:
        return _DETERMINISTIC_HINTS[phase](checkpoint_path)
    if phase in _JUDGMENT_HINTS:
        return _JUDGMENT_HINTS[phase]
    raise KeyError("no next hint for phase %r" % phase)


def transition(phase, iteration, event, max_iterations=DEFAULT_MAX_ITERATIONS):
    """純函式狀態轉移。回傳 (new_phase, new_iteration)。

    iteration 在 gate_pass 進入 qa 時 +1(代表第幾輪 qa/review);
    超過 max_iterations 則轉為 escalated。
    """
    if phase == "proposal_review" and event == PROPOSE_CLEAN:
        return ("apply", iteration)
    if phase == "proposal_review" and event == PROPOSE_BLOCKING_PROPOSAL:
        return ("propose", iteration)
    if phase == "proposal_review" and event == PROPOSE_BLOCKING_DESIGN:
        return ("escalated", iteration)
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
    if phase == "merge" and event == FINISH_DONE:
        return ("done", iteration)
    if phase == "propose" and event == PROPOSE_DONE:
        return ("proposal_review", iteration)
    if phase == "proposal_review" and event == PROPOSE_RETRY_EXCEEDED:
        return ("escalated", iteration)
    if phase == "gate" and event == GATE_RETRY_EXCEEDED:
        return ("escalated", iteration)
    if phase == "escalated" and event == HUMAN_RESUME_PROPOSE:
        return ("propose", iteration)
    if phase == "escalated" and event == HUMAN_RESUME_FIX:
        return ("fix", iteration)
    raise InvalidTransition("no transition from %r on %r" % (phase, event))

from __future__ import annotations

import argparse
import shlex
import sys
from datetime import datetime, timezone

from devloop.checkpoint import Checkpoint
from devloop.gate import run_gate
from devloop.openspec import archive_change, validate_change
from devloop.resume import plan_resume
from devloop.review import classify, non_blocking_notes, parse_review_report
from devloop.statemachine import (
    GATE_FAIL,
    GATE_PASS,
    DEFAULT_MAX_ITERATIONS,
    InvalidTransition,
    transition,
)


def _cmd_start(args):
    cp = Checkpoint(phase="apply", change_id=args.change_id, branch=args.branch)
    cp.save(args.file)
    return 0


def _cmd_status(args):
    cp = Checkpoint.load(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _apply_event(cp, event, max_iterations):
    new_phase, new_iteration = transition(cp.phase, cp.iteration, event, max_iterations)
    cp.phase = new_phase
    cp.iteration = new_iteration
    return cp


def _cmd_event(args):
    cp = Checkpoint.load(args.file)
    cp = _apply_event(cp, args.event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_gate(args):
    cp = Checkpoint.load(args.file)
    result = run_gate([shlex.split(c) for c in args.cmd], timeout=args.timeout)
    event = GATE_PASS if result.passed else GATE_FAIL
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    if not result.passed:
        print("gate FAILED: %s" % result.failed_command)
        print(result.output)
        return 1
    print("gate PASSED -> phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_resume(args):
    cp = Checkpoint.load(args.file)
    now = datetime.now(timezone.utc)
    reset_at = datetime.fromisoformat(args.reset_at) if args.reset_at else now
    action = plan_resume(cp.phase, now, reset_at)
    print(
        "ready=%s sleep_seconds=%d phase=%s"
        % (action.ready, action.sleep_seconds, action.phase)
    )
    return 0


def _cmd_review(args):
    cp = Checkpoint.load(args.file)
    findings = parse_review_report(args.report)
    cp.non_blocking.extend(non_blocking_notes(findings))
    event = classify(findings)
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_validate_change(args):
    cp = Checkpoint.load(args.file)
    result = validate_change(cp.change_id)
    print(result.output)
    return 0 if result.ok else 1


def _cmd_archive(args):
    cp = Checkpoint.load(args.file)
    result = archive_change(cp.change_id)
    print(result.output)
    return 0 if result.ok else 1


def build_parser():
    parser = argparse.ArgumentParser(prog="devloop")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--file", required=True)
    p_start.add_argument("--change-id", required=True, dest="change_id")
    p_start.add_argument("--branch", required=True)
    p_start.set_defaults(func=_cmd_start)

    p_status = sub.add_parser("status")
    p_status.add_argument("--file", required=True)
    p_status.set_defaults(func=_cmd_status)

    p_event = sub.add_parser("event")
    p_event.add_argument("--file", required=True)
    p_event.add_argument("--event", required=True)
    p_event.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_event.set_defaults(func=_cmd_event)

    p_gate = sub.add_parser("gate")
    p_gate.add_argument("--file", required=True)
    p_gate.add_argument("--cmd", action="append", default=[])
    p_gate.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_gate.add_argument("--timeout", type=int, default=600)
    p_gate.set_defaults(func=_cmd_gate)

    p_resume = sub.add_parser("resume")
    p_resume.add_argument("--file", required=True)
    p_resume.add_argument("--reset-at", dest="reset_at", default=None)
    p_resume.set_defaults(func=_cmd_resume)

    p_review = sub.add_parser("review")
    p_review.add_argument("--file", required=True)
    p_review.add_argument("--report", required=True)
    p_review.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_review.set_defaults(func=_cmd_review)

    p_validate = sub.add_parser("validate-change")
    p_validate.add_argument("--file", required=True)
    p_validate.set_defaults(func=_cmd_validate_change)

    p_archive = sub.add_parser("archive")
    p_archive.add_argument("--file", required=True)
    p_archive.set_defaults(func=_cmd_archive)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except InvalidTransition as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

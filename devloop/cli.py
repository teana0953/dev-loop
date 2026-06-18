from __future__ import annotations

import argparse

from devloop.checkpoint import Checkpoint
from devloop.gate import run_gate
from devloop.statemachine import (
    GATE_FAIL,
    GATE_PASS,
    DEFAULT_MAX_ITERATIONS,
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
    result = run_gate([[c] for c in args.cmd])
    event = GATE_PASS if result.passed else GATE_FAIL
    cp = _apply_event(cp, event, args.max)
    cp.save(args.file)
    if not result.passed:
        print("gate FAILED: %s" % result.failed_command)
        print(result.output)
        return 1
    print("gate PASSED -> phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


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
    p_gate.set_defaults(func=_cmd_gate)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

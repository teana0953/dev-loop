from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from devloop.adapter import DEFAULT_HEARTBEAT, run_adapter, run_watcher
from devloop.changemeta import load_change_meta
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
from devloop.units import build_units, mark
from devloop.worktree import add_worktree, merge_branch, remove_worktree, list_worktree_paths


def _cmd_start(args):
    cp = Checkpoint(
        phase="apply",
        change_id=args.change_id,
        branch=args.branch,
        resume_exec=args.resume_exec,
    )
    cp.save(args.file)
    return 0


def _cmd_status(args):
    cp = Checkpoint.load(args.file)
    print(
        "phase=%s iteration=%d change_id=%s branch=%s"
        % (cp.phase, cp.iteration, cp.change_id, cp.branch)
    )
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


def _cmd_auto_resume(args):
    reset_at = datetime.fromisoformat(args.reset_at)
    return run_adapter(args.file, reset_at, shlex.split(args.exec))


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False  # ESRCH:無此行程 → 死
    except PermissionError:
        return True  # EPERM:行程存在但屬他人 → 存活
    except OSError:
        return False
    return True


def _spawn_watcher(exec_command, heartbeat):
    """spawn 一個 detached 行程跑 watch 子命令,回傳其 PID。"""
    proc = subprocess.Popen(
        [
            sys.executable, "-m", "devloop.cli", "watch",
            "--exec", shlex.join(exec_command),
            "--heartbeat", str(heartbeat),
        ],
        start_new_session=True,
    )
    return proc.pid


def _cmd_arm_local(args):
    cp = Checkpoint.load(args.file)
    exec_str = args.exec or cp.resume_exec
    if not exec_str:
        print(
            "error: no resume command (checkpoint.resume_exec empty and no --exec)",
            file=sys.stderr,
        )
        return 2
    pid_path = Path(args.file).parent / "watcher.pid"
    if pid_path.exists():
        try:
            pid = int(pid_path.read_text().strip())
        except ValueError:
            pid = None
        if pid is not None and _pid_alive(pid):
            print("watcher already running (pid=%d)" % pid)
            return 0
    pid = _spawn_watcher(shlex.split(exec_str), args.heartbeat)
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(pid))
    print("watcher armed (pid=%d)" % pid)
    return 0


def _cmd_watch(args):
    return run_watcher(shlex.split(args.exec), heartbeat=args.heartbeat)


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


def _cmd_units_init(args):
    cp = Checkpoint.load(args.file)
    meta = load_change_meta(args.meta)
    units = build_units(meta.parallel_groups, cp.branch, args.wt_root)
    if not units:
        cp.units = []
        cp.save(args.file)
        print("units-init: serial")
        return 0
    for u in units:
        base = cp.branch if _branch_exists(args.repo, cp.branch) else "HEAD"
        add_worktree(args.repo, u["worktree"], u["branch"], base)
    cp.units = units
    cp.save(args.file)
    print("units-init: %d units" % len(units))
    return 0


def _branch_exists(repo, branch):
    r = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", branch],
        capture_output=True, text=True,
    )
    return r.returncode == 0


def _cmd_unit_done(args):
    cp = Checkpoint.load(args.file)
    try:
        mark(cp.units, args.id, "done")
    except KeyError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    cp.save(args.file)
    print("unit-done: %s" % args.id)
    return 0


def _cmd_units_merge(args):
    cp = Checkpoint.load(args.file)
    subprocess.run(["git", "-C", str(args.repo), "checkout", cp.branch],
                   capture_output=True, text=True)
    conflicts = []
    for u in cp.units:
        if u["status"] != "done":
            continue
        res = merge_branch(args.repo, u["branch"])
        u["status"] = "merged" if res.ok else "conflict"
        if not res.ok:
            conflicts.append(u["id"])
    cp.save(args.file)
    if conflicts:
        print("units-merge: conflict in %s" % ", ".join(conflicts))
        return 1
    print("units-merge: all merged")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="devloop")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--file", required=True)
    p_start.add_argument("--change-id", required=True, dest="change_id")
    p_start.add_argument("--branch", required=True)
    p_start.add_argument("--resume-exec", dest="resume_exec", default=None)
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

    p_auto = sub.add_parser("auto-resume")
    p_auto.add_argument("--file", required=True)
    p_auto.add_argument("--reset-at", dest="reset_at", required=True)
    p_auto.add_argument("--exec", dest="exec", required=True)
    p_auto.set_defaults(func=_cmd_auto_resume)

    p_arm = sub.add_parser("arm-local")
    p_arm.add_argument("--file", required=True)
    p_arm.add_argument("--exec", dest="exec", default=None)
    p_arm.add_argument("--heartbeat", type=int, default=DEFAULT_HEARTBEAT)
    p_arm.set_defaults(func=_cmd_arm_local)

    p_watch = sub.add_parser("watch")
    p_watch.add_argument("--exec", dest="exec", required=True)
    p_watch.add_argument("--heartbeat", type=int, default=DEFAULT_HEARTBEAT)
    p_watch.set_defaults(func=_cmd_watch)

    p_validate = sub.add_parser("validate-change")
    p_validate.add_argument("--file", required=True)
    p_validate.set_defaults(func=_cmd_validate_change)

    p_archive = sub.add_parser("archive")
    p_archive.add_argument("--file", required=True)
    p_archive.set_defaults(func=_cmd_archive)

    p_ui = sub.add_parser("units-init")
    p_ui.add_argument("--file", required=True)
    p_ui.add_argument("--repo", required=True)
    p_ui.add_argument("--meta", required=True)
    p_ui.add_argument("--wt-root", dest="wt_root", required=True)
    p_ui.set_defaults(func=_cmd_units_init)

    p_ud = sub.add_parser("unit-done")
    p_ud.add_argument("--file", required=True)
    p_ud.add_argument("--id", required=True)
    p_ud.set_defaults(func=_cmd_unit_done)

    p_um = sub.add_parser("units-merge")
    p_um.add_argument("--file", required=True)
    p_um.add_argument("--repo", required=True)
    p_um.set_defaults(func=_cmd_units_merge)

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

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

from devloop.adapter import DEFAULT_HEARTBEAT, run_watcher
from devloop.changemeta import is_serial, load_change_meta
from devloop.checkpoint import Checkpoint
from devloop.config import load_config, resolve_finish, validate_gate_cmds
from devloop.finish import render_followup, write_followup
from devloop.gate import run_gate
from devloop.history import append_history
from devloop.housekeeping import archive_workfiles
from devloop.openspec import archive_change, validate_change
from devloop.review import (
    ReportError, aggregate_findings, classify, classify_proposal, classify_qa,
    non_blocking_notes, parse_review_report,
)
from devloop.statemachine import (
    DEFAULT_MAX_ITERATIONS,
    GATE_FAIL,
    GATE_PASS,
    GATE_RETRY_EXCEEDED,
    HUMAN_RESUME_FIX,
    HUMAN_RESUME_PROPOSE,
    PROPOSE_BLOCKING_PROPOSAL,
    PROPOSE_RETRY_EXCEEDED,
    TEARDOWN_DONE,
    InvalidTransition,
    PHASES,
    next_hint,
    transition,
)
from devloop.teardown import (
    delete_merged_branch, disarm_watcher, prune_orphan_worktrees, sweep_change_meta,
)
from devloop.units import build_units, mark, pending_units
from devloop.worktree import add_worktree, merge_branch, remove_worktree, list_worktree_paths, worktree_exists


def _ensure_armed_after_save(cp, args):
    """checkpoint save 後自動確保 watcher 在位。靜默,失敗僅 stderr 警告。"""
    if not cp.resume_exec:
        return
    if cp.phase == "done":
        return  # 終態不再需要 watcher(teardown 已 disarm,勿重新拉起)
    config = load_config(Path(args.file).parent / "config.json")
    if not config.auto_arm:
        return
    try:
        ensure_armed(args.file)
    except Exception as exc:
        print("warning: auto-arm failed: %s" % exc, file=sys.stderr)


def _save_with_history(cp, args, event, from_phase):
    """checkpoint save + transition 追加到 history.jsonl + auto-arm。
    history 為 best-effort 觀測資料,失敗僅 stderr 警告,不影響主命令。"""
    cp.save(args.file)
    try:
        append_history(args.file, event, from_phase, cp.phase, cp.iteration)
    except Exception as exc:
        print("warning: history append failed: %s" % exc, file=sys.stderr)
    _ensure_armed_after_save(cp, args)


def _cmd_start(args):
    # 覆蓋保護:非 done 的既有 checkpoint 是進行中(或停等人工)的 loop,
    # 靜默覆蓋等於丟狀態;done 才自然讓路給下一輪。
    path = Path(args.file)
    if path.exists() and not args.force:
        try:
            existing_phase = Checkpoint.load(args.file).phase
        except Exception:
            existing_phase = None  # 壞檔讀不出 phase,同樣保守擋下
        if existing_phase != "done":
            print(
                "error: checkpoint exists (phase=%s); resume it (see `status`) "
                "or pass --force to overwrite" % (existing_phase or "unreadable"),
                file=sys.stderr,
            )
            return 2
    cp = Checkpoint(
        phase=args.phase,
        change_id=args.change_id,
        branch=args.branch,
        resume_exec=args.resume_exec,
    )
    _save_with_history(cp, args, "start", None)
    return 0


def _cmd_status(args):
    cp = Checkpoint.load(args.file)
    config = load_config(Path(args.file).parent / "config.json")
    hint = next_hint(cp.phase, args.file, units=cp.units, review_legs=cp.review_legs,
                     gate_cmds=config.gate_cmds, finish_mode=cp.finish_mode)
    _warn_if_watcher_missing(cp, args.file)
    if args.json:
        payload = asdict(cp)
        payload["next"] = hint
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    print(
        "phase=%s iteration=%d change_id=%s branch=%s"
        % (cp.phase, cp.iteration, cp.change_id, cp.branch)
    )
    print(hint)
    if cp.updated_at:
        print("updated_at=%s" % cp.updated_at)
    return 0


def _warn_if_watcher_missing(cp, checkpoint_path):
    """非終態且有續跑命令時,watcher 該在而不在 → stderr 警告(stdout 契約不變)。"""
    if cp.phase == "done" or not cp.resume_exec:
        return
    state, _pid = _watcher_state(checkpoint_path)
    if state != "running":
        print(
            "warning: watcher not running; re-arm: "
            "devloop arm-local --file %s" % checkpoint_path,
            file=sys.stderr,
        )


def _apply_event(cp, event, max_iterations):
    new_phase, new_iteration = transition(cp.phase, cp.iteration, event, max_iterations)
    cp.phase = new_phase
    cp.iteration = new_iteration
    return cp


def _cmd_event(args):
    cp = Checkpoint.load(args.file)
    from_phase = cp.phase
    cp = _apply_event(cp, args.event, args.max)
    if args.event in (HUMAN_RESUME_PROPOSE, HUMAN_RESUME_FIX):
        cp.iteration = 0
        cp.propose_attempts = 0
        cp.gate_failures = 0
    # 若提供 --finish-mode 則寫入 checkpoint
    if getattr(args, "finish_mode", None):
        cp.finish_mode = args.finish_mode
    _save_with_history(cp, args, args.event, from_phase)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _resolve_gate_cmds(args):
    """gate 命令來源:CLI --cmd 優先,否則 config 的 gate_cmds;皆無或非法 → ValueError。
    空命令清單絕不能進 run_gate(空 list 恆 pass,會假綠)。"""
    if args.cmd:
        return args.cmd
    config = load_config(Path(args.file).parent / "config.json")
    cmds = validate_gate_cmds(config.gate_cmds)
    if not cmds:
        raise ValueError(
            "no gate commands: pass --cmd or set gate_cmds in .devloop/config.json")
    return cmds


def _cmd_gate(args):
    cp = Checkpoint.load(args.file)
    try:
        cmds = _resolve_gate_cmds(args)
    except ValueError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    result = run_gate([shlex.split(c) for c in cmds], timeout=args.timeout)
    from_phase = cp.phase
    if result.passed:
        event = GATE_PASS
    else:
        cp.gate_failures += 1
        event = GATE_RETRY_EXCEEDED if cp.gate_failures > args.max_gate else GATE_FAIL
    cp = _apply_event(cp, event, args.max)
    _save_with_history(cp, args, event, from_phase)
    if not result.passed:
        print("gate FAILED: %s" % result.failed_command)
        print(result.output)
        print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
        # escalated 與一般 fail 必須可區分:exit 3 專屬升級,1 為轉 fix
        return 3 if cp.phase == "escalated" else 1
    print("gate PASSED -> phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_review(args):
    cp = Checkpoint.load(args.file)
    if args.from_legs:
        if not cp.review_legs or any(l["status"] != "collected" for l in cp.review_legs):
            print("error: review legs not all collected", file=sys.stderr)
            return 2
        paths = [l["report"] for l in cp.review_legs if l["status"] == "collected"]
        findings = aggregate_findings(paths)
    elif args.report:
        findings = parse_review_report(args.report)
    else:
        print("error: need --report or --from-legs", file=sys.stderr)
        return 2
    cp.non_blocking.extend(non_blocking_notes(findings))
    from_phase = cp.phase
    event = classify(findings)
    cp = _apply_event(cp, event, args.max)
    _save_with_history(cp, args, event, from_phase)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_qa(args):
    cp = Checkpoint.load(args.file)
    findings = parse_review_report(args.report)
    cp.non_blocking.extend(non_blocking_notes(findings))
    from_phase = cp.phase
    event = classify_qa(findings)
    cp = _apply_event(cp, event, args.max)
    _save_with_history(cp, args, event, from_phase)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_proposal_review(args):
    cp = Checkpoint.load(args.file)
    findings = parse_review_report(args.report)
    cp.non_blocking.extend(non_blocking_notes(findings))
    from_phase = cp.phase
    event = classify_proposal(findings)
    if event == PROPOSE_BLOCKING_PROPOSAL:
        cp.propose_attempts += 1
        if cp.propose_attempts > args.max_propose:
            event = PROPOSE_RETRY_EXCEEDED
    cp = _apply_event(cp, event, args.max)
    _save_with_history(cp, args, event, from_phase)
    print("phase=%s iteration=%d" % (cp.phase, cp.iteration))
    return 0


def _cmd_legs_init(args):
    cp = Checkpoint.load(args.file)
    kinds = [k for k in args.kinds.split(",") if k]
    cp.review_legs = [{"kind": k, "status": "pending", "report": ""} for k in kinds]
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
    print("legs-init: %d" % len(cp.review_legs))
    return 0


def _cmd_leg_done(args):
    cp = Checkpoint.load(args.file)
    for leg in cp.review_legs:
        if leg["kind"] == args.kind:
            leg["status"] = "collected"
            leg["report"] = args.report
            cp.save(args.file)
            _ensure_armed_after_save(cp, args)
            print("leg-done: %s" % args.kind)
            return 0
    print("error: no leg %r" % args.kind, file=sys.stderr)
    return 2


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


def _spawn_watcher(exec_command, heartbeat, log_path=None):
    """spawn 一個 detached 行程跑 watch 子命令,回傳其 PID。"""
    argv = [
        sys.executable, "-m", "devloop.cli", "watch",
        "--exec", shlex.join(exec_command),
        "--heartbeat", str(heartbeat),
    ]
    if log_path:
        argv += ["--log", str(log_path)]
    env = os.environ.copy()
    pythonpath = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = pythonpath + (os.pathsep + existing if existing else "")
    proc = subprocess.Popen(argv, start_new_session=True, env=env)
    return proc.pid


def _watcher_state(checkpoint_path):
    """讀 watcher.pid 判斷 watcher 狀態。回傳 (state, pid):
    "running"(活著)/ "dead"(pid 檔在但行程死)/ "absent"(無 pid 檔或內容非法)。"""
    pid_path = Path(checkpoint_path).parent / "watcher.pid"
    if not pid_path.exists():
        return ("absent", None)
    try:
        pid = int(pid_path.read_text().strip())
    except ValueError:
        return ("absent", None)
    return ("running", pid) if _pid_alive(pid) else ("dead", pid)


def _watcher_log_path(checkpoint_path) -> Path:
    return Path(checkpoint_path).parent / "watcher-log.jsonl"


def ensure_armed(checkpoint_path, heartbeat=DEFAULT_HEARTBEAT, exec_override=None):
    """idempotent 確保 watcher 在位。回傳 (status, info),不印字。

    status ∈ "armed"(剛 spawn,info=pid)/ "already"(既存活,info=pid)/
    "skipped"(無 resume 命令,info=None)。
    """
    cp = Checkpoint.load(checkpoint_path)
    exec_str = exec_override or cp.resume_exec
    if not exec_str:
        return ("skipped", None)
    state, pid = _watcher_state(checkpoint_path)
    if state == "running":
        return ("already", pid)
    pid = _spawn_watcher(
        shlex.split(exec_str), heartbeat, log_path=_watcher_log_path(checkpoint_path))
    pid_path = Path(checkpoint_path).parent / "watcher.pid"
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(pid))
    return ("armed", pid)


def _cmd_arm_local(args):
    status, info = ensure_armed(args.file, heartbeat=args.heartbeat, exec_override=args.exec)
    if status == "skipped":
        print(
            "error: no resume command (checkpoint.resume_exec empty and no --exec)",
            file=sys.stderr,
        )
        return 2
    if status == "already":
        print("watcher already running (pid=%d)" % info)
        return 0
    print("watcher armed (pid=%d)" % info)
    return 0


def _cmd_watch(args):
    return run_watcher(shlex.split(args.exec), heartbeat=args.heartbeat, log_path=args.log)


def _cmd_watcher_status(args):
    """watcher 排障一眼看:行程狀態、續跑命令、最近一次嘗試。
    exit 0 = 在位或不需要;exit 1 = 該在而不在(建議 arm-local)。"""
    cp = Checkpoint.load(args.file)
    state, pid = _watcher_state(args.file)
    if state == "running":
        print("watcher: running (pid=%d)" % pid)
    elif state == "dead":
        print("watcher: dead (stale pid=%d)" % pid)
    else:
        print("watcher: not armed")
    print("resume_exec: %s" % (cp.resume_exec or "(none)"))
    last = _last_watcher_attempt(args.file)
    if last is None:
        print("last attempt: (none)")
    else:
        line = "last attempt: %s exit=%s %s" % (
            last.get("ts", "?"), last.get("exit_code", "?"), last.get("action", ""))
        print(line.rstrip())
        tail = (last.get("output_tail") or "").strip()
        if tail:
            print("output tail: %s" % tail)
    needed = cp.phase != "done" and bool(cp.resume_exec)
    if needed and state != "running":
        print("hint: devloop arm-local --file %s" % args.file)
        return 1
    return 0


def _last_watcher_attempt(checkpoint_path):
    """讀 watcher log 最後一筆;無檔/空檔/壞行回 None(排障工具自身不炸)。"""
    log = _watcher_log_path(checkpoint_path)
    if not log.exists():
        return None
    last = None
    for line in log.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            last = json.loads(line)
        except ValueError:
            continue
    return last


def _cmd_validate_change(args):
    cp = Checkpoint.load(args.file)
    result = validate_change(cp.change_id)
    print(result.output)
    return 0 if result.ok else 1


def _cmd_archive(args):
    cp = Checkpoint.load(args.file)
    result = archive_change(cp.change_id)
    print(result.output)
    if not result.ok:
        return 1
    # openspec archive 成功後收工作檔;housekeeping 失敗不反噬 archive 結果
    try:
        archived = archive_workfiles(args.file, cp.change_id)
        print("archived workfiles: %d -> %s" % (
            len(archived), Path(args.file).parent / "archive" / cp.change_id))
    except Exception as exc:
        print("warning: workfile archive failed: %s" % exc, file=sys.stderr)
    return 0


def _cmd_teardown(args):
    """teardown phase 收尾:清殘留(watcher/orphan worktree/change meta)後,
    依 mode 決定是否刪短命分支,再 apply TEARDOWN_DONE 推進 phase → done。
    清理各步驟 idempotent、非致命失敗僅印字不阻斷;真正會擋住的只有 phase 不對時
    transition 拋出的 InvalidTransition。"""
    cp = Checkpoint.load(args.file)
    wt_root = args.wt_root or (Path(args.file).parent / "wt")
    print("watcher: %s" % disarm_watcher(args.file))
    print("worktrees pruned: %d" % prune_orphan_worktrees(args.repo, wt_root))
    if sweep_change_meta(args.file, cp.change_id):
        print("swept change meta: %s" % cp.change_id)
    if args.mode == "merge":
        ok = delete_merged_branch(args.repo, cp.branch)
        print("branch %s: %s" % (cp.branch, "deleted" if ok else "kept (unmerged/absent)"))
    else:
        print("branch %s: kept (pr)" % cp.branch)
    from_phase = cp.phase
    try:
        cp = _apply_event(cp, TEARDOWN_DONE, args.max)
    except InvalidTransition as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    _save_with_history(cp, args, TEARDOWN_DONE, from_phase)
    print("phase=%s" % cp.phase)
    return 0


def _cmd_finish(args):
    cp = Checkpoint.load(args.file)
    config = load_config(args.config)
    meta = load_change_meta(args.meta)
    try:
        decision = resolve_finish(config, meta)
    except ValueError as exc:
        print("error: invalid finish value %s" % exc, file=sys.stderr)
        return 2
    print("finish: %s" % decision)
    if decision == "merge":
        if cp.non_blocking:
            write_followup(args.followup, cp.non_blocking)
            print("followup: %s" % args.followup)
    elif decision == "pr":
        body = render_followup(cp.non_blocking)
        if body:
            print("--- PR body follow-up ---")
            print(body)
    return 0


def _cmd_units_init(args):
    cp = Checkpoint.load(args.file)
    meta = load_change_meta(args.meta)
    if is_serial(meta):
        cp.units = []
        cp.save(args.file)
        _ensure_armed_after_save(cp, args)
        print("units-init: serial")
        return 0
    units = build_units(meta.parallel_groups, cp.branch, args.wt_root)
    base = cp.branch if _branch_exists(args.repo, cp.branch) else "HEAD"
    for u in units:
        if not worktree_exists(args.repo, u["worktree"]):
            add_worktree(args.repo, u["worktree"], u["branch"], base)
    cp.units = units
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
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
    _ensure_armed_after_save(cp, args)
    print("unit-done: %s" % args.id)
    return 0


def _cmd_unit_claim(args):
    cp = Checkpoint.load(args.file)
    try:
        mark(cp.units, args.id, "in_progress")
    except KeyError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
    print("unit-claim: %s" % args.id)
    return 0


def _cmd_units_merge(args):
    cp = Checkpoint.load(args.file)
    co = subprocess.run(["git", "-C", str(args.repo), "checkout", cp.branch],
                        capture_output=True, text=True)
    if co.returncode != 0:
        print("error: git checkout %s failed: %s" % (cp.branch, co.stderr.strip()),
              file=sys.stderr)
        return 2
    conflicts = []
    for u in cp.units:
        if u["status"] != "done":
            continue
        res = merge_branch(args.repo, u["branch"])
        u["status"] = "merged" if res.ok else "conflict"
        if not res.ok:
            conflicts.append(u["id"])
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
    if conflicts:
        print("units-merge: conflict in %s" % ", ".join(conflicts))
        return 1
    print("units-merge: all merged")
    return 0


def _cmd_units_cleanup(args):
    cp = Checkpoint.load(args.file)
    wt_root = str(Path(args.wt_root).resolve()) + os.sep
    removed = 0
    known = set()
    for u in cp.units:
        known.add(str(Path(u["worktree"]).resolve()))
        if u["status"] == "merged":
            remove_worktree(args.repo, u["worktree"], u["branch"])
            removed += 1
    for p in list_worktree_paths(args.repo):
        if p not in known and p.startswith(wt_root):
            subprocess.run(["git", "-C", str(args.repo), "worktree", "remove", "--force", p],
                           capture_output=True, text=True)
            removed += 1
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
    print("units-cleanup: removed %d" % removed)
    return 0


def _cmd_unit_resolve(args):
    cp = Checkpoint.load(args.file)
    target = None
    for u in cp.units:
        if u["id"] == args.id:
            target = u
            break
    if target is None:
        print("error: no unit %r" % args.id, file=sys.stderr)
        return 2
    remove_worktree(args.repo, target["worktree"], target["branch"])
    target["status"] = "merged"
    cp.save(args.file)
    _ensure_armed_after_save(cp, args)
    print("unit-resolve: %s merged" % args.id)
    return 0


def _cmd_units_status(args):
    cp = Checkpoint.load(args.file)
    for u in cp.units:
        print("%s %s" % (u["id"], u["status"]))
    pend = [u["id"] for u in pending_units(cp.units)]
    print("pending: %s" % (",".join(pend) if pend else "-"))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="devloop")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--file", required=True)
    p_start.add_argument("--change-id", required=True, dest="change_id")
    p_start.add_argument("--branch", required=True)
    p_start.add_argument("--resume-exec", dest="resume_exec", default=None)
    p_start.add_argument("--phase", default="apply", choices=PHASES)
    p_start.add_argument("--force", action="store_true",
                         help="覆蓋非 done 的既有 checkpoint(預設拒絕,防丟進行中的 loop)")
    p_start.set_defaults(func=_cmd_start)

    p_status = sub.add_parser("status")
    p_status.add_argument("--file", required=True)
    p_status.add_argument("--json", action="store_true",
                          help="以單行 JSON 輸出完整 checkpoint(含 next hint),供程式化消費")
    p_status.set_defaults(func=_cmd_status)

    p_event = sub.add_parser("event")
    p_event.add_argument("--file", required=True)
    p_event.add_argument("--event", required=True)
    p_event.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_event.add_argument("--finish-mode", dest="finish_mode",
                         choices=("merge", "pr"), default=None)
    p_event.set_defaults(func=_cmd_event)

    p_gate = sub.add_parser("gate")
    p_gate.add_argument("--file", required=True)
    p_gate.add_argument("--cmd", action="append", default=[])
    p_gate.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS,
                        help="qa/review 正常輪次上限(gate 通過進 qa 時 iteration +1,超過升級 escalated)")
    p_gate.add_argument("--max-gate", dest="max_gate", type=int, default=DEFAULT_MAX_ITERATIONS,
                        help="容許的連續 gate 失敗次數(第 N+1 次失敗升級 escalated,exit 3)")
    p_gate.add_argument("--timeout", type=int, default=600)
    p_gate.set_defaults(func=_cmd_gate)

    p_review = sub.add_parser("review")
    p_review.add_argument("--file", required=True)
    p_review.add_argument("--report", default=None)
    p_review.add_argument("--from-legs", dest="from_legs", action="store_true")
    p_review.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_review.set_defaults(func=_cmd_review)

    p_qa = sub.add_parser("qa")
    p_qa.add_argument("--file", required=True)
    p_qa.add_argument("--report", required=True)
    p_qa.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_qa.set_defaults(func=_cmd_qa)

    p_pr = sub.add_parser("proposal-review")
    p_pr.add_argument("--file", required=True)
    p_pr.add_argument("--report", required=True)
    p_pr.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_pr.add_argument("--max-propose", dest="max_propose", type=int, default=DEFAULT_MAX_ITERATIONS,
                      help="容許的 re-propose 次數(第 N+1 次 blocking(proposal) 升級 escalated)")
    p_pr.set_defaults(func=_cmd_proposal_review)

    p_li = sub.add_parser("legs-init")
    p_li.add_argument("--file", required=True)
    p_li.add_argument("--kinds", required=True)
    p_li.set_defaults(func=_cmd_legs_init)

    p_ld = sub.add_parser("leg-done")
    p_ld.add_argument("--file", required=True)
    p_ld.add_argument("--kind", required=True)
    p_ld.add_argument("--report", required=True)
    p_ld.set_defaults(func=_cmd_leg_done)

    p_arm = sub.add_parser("arm-local")
    p_arm.add_argument("--file", required=True)
    p_arm.add_argument("--exec", dest="exec", default=None)
    p_arm.add_argument("--heartbeat", type=int, default=DEFAULT_HEARTBEAT)
    p_arm.set_defaults(func=_cmd_arm_local)

    p_watch = sub.add_parser("watch")
    p_watch.add_argument("--exec", dest="exec", required=True)
    p_watch.add_argument("--heartbeat", type=int, default=DEFAULT_HEARTBEAT)
    p_watch.add_argument("--log", default=None,
                         help="每次嘗試追加一行 JSON 的 log 檔路徑(watcher-status 讀取)")
    p_watch.set_defaults(func=_cmd_watch)

    p_ws = sub.add_parser("watcher-status")
    p_ws.add_argument("--file", required=True)
    p_ws.set_defaults(func=_cmd_watcher_status)

    p_validate = sub.add_parser("validate-change")
    p_validate.add_argument("--file", required=True)
    p_validate.set_defaults(func=_cmd_validate_change)

    p_archive = sub.add_parser("archive")
    p_archive.add_argument("--file", required=True)
    p_archive.set_defaults(func=_cmd_archive)

    p_teardown = sub.add_parser("teardown")
    p_teardown.add_argument("--file", required=True)
    p_teardown.add_argument("--repo", default=".")
    p_teardown.add_argument("--mode", required=True, choices=("merge", "pr"))
    p_teardown.add_argument("--wt-root", dest="wt_root", default=None)
    p_teardown.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_teardown.set_defaults(func=_cmd_teardown)

    p_finish = sub.add_parser("finish")
    p_finish.add_argument("--file", required=True)
    p_finish.add_argument("--config", required=True)
    p_finish.add_argument("--meta", required=True)
    p_finish.add_argument("--followup", required=True)
    p_finish.set_defaults(func=_cmd_finish)

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

    p_ucl = sub.add_parser("unit-claim")
    p_ucl.add_argument("--file", required=True)
    p_ucl.add_argument("--id", required=True)
    p_ucl.set_defaults(func=_cmd_unit_claim)

    p_um = sub.add_parser("units-merge")
    p_um.add_argument("--file", required=True)
    p_um.add_argument("--repo", required=True)
    p_um.set_defaults(func=_cmd_units_merge)

    p_uc = sub.add_parser("units-cleanup")
    p_uc.add_argument("--file", required=True)
    p_uc.add_argument("--repo", required=True)
    p_uc.add_argument("--wt-root", dest="wt_root", required=True)
    p_uc.set_defaults(func=_cmd_units_cleanup)

    p_ur = sub.add_parser("unit-resolve")
    p_ur.add_argument("--file", required=True)
    p_ur.add_argument("--repo", required=True)
    p_ur.add_argument("--id", required=True)
    p_ur.set_defaults(func=_cmd_unit_resolve)

    p_us = sub.add_parser("units-status")
    p_us.add_argument("--file", required=True)
    p_us.set_defaults(func=_cmd_units_status)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except InvalidTransition as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    except ReportError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

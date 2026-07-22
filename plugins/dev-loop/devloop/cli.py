from __future__ import annotations

import argparse
import json
import shlex
import sys
from dataclasses import asdict
from pathlib import Path

from devloop import units_cli, watcher
from devloop.adapter import DEFAULT_HEARTBEAT, run_watcher
from devloop.changemeta import load_change_meta
from devloop.checkpoint import Checkpoint
from devloop.config import load_config, resolve_finish, resolve_model, validate_gate_cmds
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
    QA_SKIP,
    TEARDOWN_DONE,
    InvalidTransition,
    PHASES,
    next_hint,
    transition,
)
from devloop.teardown import (
    delete_merged_branch, disarm_watcher, prune_orphan_worktrees, sweep_change_meta,
)


def _save_with_history(cp, args, event, from_phase):
    """checkpoint save + transition 追加到 history.jsonl + auto-arm。
    history 為 best-effort 觀測資料,失敗僅 stderr 警告,不影響主命令。"""
    cp.save(args.file)
    try:
        append_history(args.file, event, from_phase, cp.phase, cp.iteration)
    except Exception as exc:
        print("warning: history append failed: %s" % exc, file=sys.stderr)
    watcher._ensure_armed_after_save(cp, args)


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
    # 流程軸凍結:--meta 給了就從 change meta 複製 flow_profile/needs_uiux;
    # meta 檔缺失走預設(propose 可能尚未寫);非法值 fail loudly 且不建 checkpoint。
    flow_profile, needs_uiux = "full", False
    if getattr(args, "meta", None):
        try:
            meta = load_change_meta(args.meta)
        except ValueError as exc:
            print("error: %s" % exc, file=sys.stderr)
            return 2
        flow_profile = meta.flow_profile or "full"
        needs_uiux = meta.needs_uiux is True
    cp = Checkpoint(
        phase=args.phase,
        change_id=args.change_id,
        branch=args.branch,
        resume_exec=args.resume_exec,
        flow_profile=flow_profile,
        needs_uiux=needs_uiux,
    )
    _save_with_history(cp, args, "start", None)
    return 0


def _cmd_status(args):
    cp = Checkpoint.load(args.file)
    config = load_config(Path(args.file).parent / "config.json")
    hint = next_hint(cp.phase, args.file, units=cp.units, review_legs=cp.review_legs,
                     gate_cmds=config.gate_cmds, finish_mode=cp.finish_mode,
                     flow_profile=cp.flow_profile, needs_uiux=cp.needs_uiux)
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
    state, _pid = watcher._watcher_state(checkpoint_path)
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
    # qa_skip 只在 light 且非 uiux 放行:裁剪必須有檔位授權,且 UX 線不可裁
    # (light+uiux 的 QA 保留以驗 UX 驗收)。guard 讀 checkpoint(start 時凍結)。
    if args.event == QA_SKIP and not (
        cp.flow_profile == "light" and not cp.needs_uiux
    ):
        print(
            "error: qa_skip requires flow_profile=light and needs_uiux=false "
            "(got %s/%s)" % (cp.flow_profile, cp.needs_uiux),
            file=sys.stderr,
        )
        return 2
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
    watcher._ensure_armed_after_save(cp, args)
    print("legs-init: %d" % len(cp.review_legs))
    return 0


def _cmd_leg_done(args):
    cp = Checkpoint.load(args.file)
    for leg in cp.review_legs:
        if leg["kind"] == args.kind:
            leg["status"] = "collected"
            leg["report"] = args.report
            cp.save(args.file)
            watcher._ensure_armed_after_save(cp, args)
            print("leg-done: %s" % args.kind)
            return 0
    print("error: no leg %r" % args.kind, file=sys.stderr)
    return 2


def _cmd_arm_local(args):
    status, info = watcher.ensure_armed(
        args.file, heartbeat=args.heartbeat, exec_override=args.exec)
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
    state, pid = watcher._watcher_state(args.file)
    if state == "running":
        print("watcher: running (pid=%d)" % pid)
    elif state == "dead":
        print("watcher: dead (stale pid=%d)" % pid)
    else:
        print("watcher: not armed")
    print("resume_exec: %s" % (cp.resume_exec or "(none)"))
    last = watcher._last_watcher_attempt(args.file)
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
    # mode 真理來源是 checkpoint 的 finish_mode;--mode 僅為人工 override。
    # 皆無不猜(刪分支不可逆),exit 2 且 checkpoint 不動。
    mode = args.mode or cp.finish_mode
    if mode not in ("merge", "pr"):
        print("error: no mode: pass --mode or run `event --finish-mode` first",
              file=sys.stderr)
        return 2
    wt_root = args.wt_root or (Path(args.file).parent / "wt")
    print("watcher: %s" % disarm_watcher(args.file))
    print("worktrees pruned: %d" % prune_orphan_worktrees(args.repo, wt_root))
    if sweep_change_meta(args.file, cp.change_id):
        print("swept change meta: %s" % cp.change_id)
    if mode == "merge":
        reason = delete_merged_branch(args.repo, cp.branch)
        msg = {"deleted": "deleted", "checked_out": "kept (checked out)",
               "unmerged": "kept (unmerged)", "absent": "kept (absent)"}[reason]
        print("branch %s: %s" % (cp.branch, msg))
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


def _cmd_model(args):
    """階段 model 決議(dispatch subagent 前查詢):印 alias 或 inherit。
    決策真理來源在引擎(resolve_model),SKILL 只照做;config 非法 exit 2。"""
    try:
        config = load_config(args.config)
        alias = resolve_model(args.stage, config)
    except ValueError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    print(alias if alias is not None else "inherit")
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


def build_parser():
    parser = argparse.ArgumentParser(prog="devloop")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--file", required=True)
    p_start.add_argument("--change-id", required=True, dest="change_id")
    p_start.add_argument("--branch", required=True)
    p_start.add_argument("--resume-exec", dest="resume_exec", default=None)
    p_start.add_argument("--phase", default="apply", choices=PHASES)
    p_start.add_argument("--meta", default=None,
                         help="change meta 路徑;凍結 flow_profile/needs_uiux 進 checkpoint")
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
    p_teardown.add_argument("--mode", default=None, choices=("merge", "pr"),
                            help="override;未給時讀 checkpoint 的 finish_mode")
    p_teardown.add_argument("--wt-root", dest="wt_root", default=None)
    p_teardown.add_argument("--max", type=int, default=DEFAULT_MAX_ITERATIONS)
    p_teardown.set_defaults(func=_cmd_teardown)

    p_finish = sub.add_parser("finish")
    p_finish.add_argument("--file", required=True)
    p_finish.add_argument("--config", required=True)
    p_finish.add_argument("--meta", required=True)
    p_finish.add_argument("--followup", required=True)
    p_finish.set_defaults(func=_cmd_finish)

    p_model = sub.add_parser("model")
    p_model.add_argument("--stage", required=True,
                         choices=("brainstorm", "apply", "review", "fix"))
    p_model.add_argument("--config", default=".devloop/config.json")
    p_model.set_defaults(func=_cmd_model)

    p_ui = sub.add_parser("units-init")
    p_ui.add_argument("--file", required=True)
    p_ui.add_argument("--repo", required=True)
    p_ui.add_argument("--meta", required=True)
    p_ui.add_argument("--wt-root", dest="wt_root", required=True)
    p_ui.set_defaults(func=units_cli._cmd_units_init)

    p_ud = sub.add_parser("unit-done")
    p_ud.add_argument("--file", required=True)
    p_ud.add_argument("--id", required=True)
    p_ud.set_defaults(func=units_cli._cmd_unit_done)

    p_ucl = sub.add_parser("unit-claim")
    p_ucl.add_argument("--file", required=True)
    p_ucl.add_argument("--id", required=True)
    p_ucl.set_defaults(func=units_cli._cmd_unit_claim)

    p_um = sub.add_parser("units-merge")
    p_um.add_argument("--file", required=True)
    p_um.add_argument("--repo", required=True)
    p_um.set_defaults(func=units_cli._cmd_units_merge)

    p_uc = sub.add_parser("units-cleanup")
    p_uc.add_argument("--file", required=True)
    p_uc.add_argument("--repo", required=True)
    p_uc.add_argument("--wt-root", dest="wt_root", required=True)
    p_uc.set_defaults(func=units_cli._cmd_units_cleanup)

    p_ur = sub.add_parser("unit-resolve")
    p_ur.add_argument("--file", required=True)
    p_ur.add_argument("--repo", required=True)
    p_ur.add_argument("--id", required=True)
    p_ur.set_defaults(func=units_cli._cmd_unit_resolve)

    p_us = sub.add_parser("units-status")
    p_us.add_argument("--file", required=True)
    p_us.set_defaults(func=units_cli._cmd_units_status)

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

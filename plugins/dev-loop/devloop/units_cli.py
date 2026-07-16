"""units 子命令(平行 worktree 單元的 init/claim/done/merge/cleanup/resolve/status)。

parser 掛載在 cli.py;這裡只有各命令的實作。checkpoint save 後的 auto-arm
一律走 watcher 模組(經模組屬性呼叫,保留測試的單一 patch 點)。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from devloop import watcher
from devloop.changemeta import is_serial, load_change_meta
from devloop.checkpoint import Checkpoint
from devloop.units import build_units, mark, pending_units
from devloop.worktree import (
    add_worktree, list_worktree_paths, merge_branch, remove_worktree, worktree_exists,
)


def _cmd_units_init(args):
    cp = Checkpoint.load(args.file)
    meta = load_change_meta(args.meta)
    if is_serial(meta):
        cp.units = []
        cp.save(args.file)
        watcher._ensure_armed_after_save(cp, args)
        print("units-init: serial")
        return 0
    units = build_units(meta.parallel_groups, cp.branch, args.wt_root)
    base = cp.branch if _branch_exists(args.repo, cp.branch) else "HEAD"
    for u in units:
        if not worktree_exists(args.repo, u["worktree"]):
            add_worktree(args.repo, u["worktree"], u["branch"], base)
    cp.units = units
    cp.save(args.file)
    watcher._ensure_armed_after_save(cp, args)
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
    watcher._ensure_armed_after_save(cp, args)
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
    watcher._ensure_armed_after_save(cp, args)
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
    watcher._ensure_armed_after_save(cp, args)
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
    watcher._ensure_armed_after_save(cp, args)
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
    watcher._ensure_armed_after_save(cp, args)
    print("unit-resolve: %s merged" % args.id)
    return 0


def _cmd_units_status(args):
    cp = Checkpoint.load(args.file)
    for u in cp.units:
        print("%s %s" % (u["id"], u["status"]))
    pend = [u["id"] for u in pending_units(cp.units)]
    print("pending: %s" % (",".join(pend) if pend else "-"))
    return 0

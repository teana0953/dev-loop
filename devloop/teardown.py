from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path

from devloop.worktree import list_worktree_paths


def disarm_watcher(checkpoint_path) -> str:
    """終態不再需要 watcher:程序活著就 SIGTERM,再刪 watcher.pid。
    回傳 "killed"(有活程序被送訊號)/ "absent"(無 pid 檔、內容非法或已死)。
    idempotent:無檔即 "absent",刪檔用 missing_ok。"""
    pid_path = Path(checkpoint_path).parent / "watcher.pid"
    if not pid_path.exists():
        return "absent"
    result = "absent"
    try:
        pid = int(pid_path.read_text().strip())
    except (OSError, ValueError):
        pid = None
    if pid is not None:
        try:
            os.kill(pid, signal.SIGTERM)
            result = "killed"
        except (ProcessLookupError, PermissionError, OSError):
            result = "absent"
    pid_path.unlink(missing_ok=True)
    return result


def prune_orphan_worktrees(repo, wt_root) -> int:
    """git worktree prune + 移除 wt_root 底下殘留的 worktree(crash 兜底)。
    回傳實際移除數;wt_root 不存在則僅 prune 回 0。目錄清空後收掉。idempotent。"""
    subprocess.run(["git", "-C", str(repo), "worktree", "prune"],
                   capture_output=True, text=True)
    root = Path(wt_root)
    if not root.exists():
        return 0
    prefix = str(root.resolve()) + os.sep
    removed = 0
    for p in list_worktree_paths(repo):
        if p.startswith(prefix):
            r = subprocess.run(["git", "-C", str(repo), "worktree", "remove", "--force", p],
                               capture_output=True, text=True)
            if r.returncode == 0:
                removed += 1
    try:
        if root.exists() and not any(root.iterdir()):
            root.rmdir()
    except OSError:
        pass
    return removed


def sweep_change_meta(checkpoint_path, change_id) -> bool:
    """補收 archive_workfiles 漏網的 changes/<id>.json → archive/<id>/。
    回傳是否有搬動;不存在回 False。idempotent。"""
    root = Path(checkpoint_path).parent
    meta = root / "changes" / ("%s.json" % change_id)
    if not meta.exists():
        return False
    dest = root / "archive" / str(change_id)
    dest.mkdir(parents=True, exist_ok=True)
    try:
        meta.replace(dest / meta.name)
    except FileNotFoundError:
        return False
    return True


def delete_merged_branch(repo, branch) -> bool:
    """git branch -d(safe delete:僅已 merged 才刪)。
    回傳是否刪成功;未 merged / 不存在時 git 回非 0 → False(非致命)。"""
    r = subprocess.run(["git", "-C", str(repo), "branch", "-d", branch],
                       capture_output=True, text=True)
    return r.returncode == 0

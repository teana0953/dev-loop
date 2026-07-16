"""watcher 生命週期:spawn/偵測/idempotent 確保在位,與 checkpoint save 後的 auto-arm。

CLI 殼(arm-local / watcher-status / watch)留在 cli.py;這裡是可被
各子命令重用的核心邏輯,全部不印 stdout(auto-arm 失敗僅 stderr 警告),
維持各主命令的 stdout 契約不變。
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

from devloop.adapter import DEFAULT_HEARTBEAT
from devloop.checkpoint import Checkpoint
from devloop.config import load_config


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

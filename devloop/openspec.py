from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class OpenSpecResult:
    ok: bool
    command: list
    output: str = ""


def _default_runner(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def _run(cmd, runner=None) -> OpenSpecResult:
    runner = runner or _default_runner
    code, output = runner(cmd)
    return OpenSpecResult(ok=(code == 0), command=cmd, output=output)


def validate_change(change_id, runner=None) -> OpenSpecResult:
    """propose 後、人工關卡前用,確認 OpenSpec change 結構合法(規格 §2、§11)。"""
    return _run(
        ["openspec", "validate", change_id, "--strict", "--no-interactive"],
        runner,
    )


def archive_change(change_id, runner=None) -> OpenSpecResult:
    """merge 階段歸檔已完成的 change,同步 main specs(規格 §4 階段 8)。"""
    return _run(["openspec", "archive", change_id, "--yes"], runner)

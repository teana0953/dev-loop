from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class GateResult:
    passed: bool
    failed_command: Optional[list] = None
    output: str = ""


def run_gate(commands, cwd=None) -> GateResult:
    """依序執行 commands;任一失敗即短路回報(規格 4)。"""
    for cmd in commands:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True
        )
        if proc.returncode != 0:
            return GateResult(
                passed=False,
                failed_command=cmd,
                output=(proc.stdout or "") + (proc.stderr or ""),
            )
    return GateResult(passed=True)

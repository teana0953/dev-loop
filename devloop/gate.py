from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class GateResult:
    passed: bool
    failed_command: Optional[list] = None
    output: str = ""


def run_gate(commands, cwd=None, timeout=600) -> GateResult:
    """依序執行 commands;任一失敗即短路回報(規格 4)。

    每個命令最多執行 timeout 秒;逾時視為該命令失敗,避免 hang 住的
    gate 命令永久阻塞 loop。
    """
    for cmd in commands:
        try:
            proc = subprocess.run(
                cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            return GateResult(
                passed=False,
                failed_command=cmd,
                output="timeout after %ss" % timeout,
            )
        if proc.returncode != 0:
            return GateResult(
                passed=False,
                failed_command=cmd,
                output=(proc.stdout or "") + (proc.stderr or ""),
            )
    return GateResult(passed=True)

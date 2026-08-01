import subprocess

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
import devloop.gate as gate

SECTIONS = ["runGate"]


@pytest.mark.parametrize("case", parity_cases("gate", "runGate", SECTIONS))
def test_run_gate_parity(case, monkeypatch):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "runGate never raises"

    outcomes = list(case["outcomes"])
    state = {"i": 0}

    def fake_run(cmd, cwd=None, capture_output=True, text=True, timeout=None):
        i = state["i"]
        if i >= len(outcomes):
            pytest.fail(
                "%s: subprocess.run called %d times but fixture only provides %d "
                "outcomes (short-circuit violated)" % (case["name"], i + 1, len(outcomes))
            )
        state["i"] += 1
        outcome = outcomes[i]
        if outcome.get("timed_out"):
            raise subprocess.TimeoutExpired(cmd, timeout)
        return subprocess.CompletedProcess(
            cmd,
            outcome.get("code", 0),
            outcome.get("stdout", ""),
            outcome.get("stderr", ""),
        )

    monkeypatch.setattr(gate.subprocess, "run", fake_run)

    result = gate.run_gate(case["commands"], timeout=case.get("timeout", 600))
    assert_subset(
        {
            "passed": result.passed,
            "failed_command": result.failed_command,
            "output": result.output,
        },
        expect,
        case["name"],
    )

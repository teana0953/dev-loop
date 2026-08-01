import json

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.checkpoint import Checkpoint
from devloop.cli import main

SECTIONS = ["unitsStatus", "model"]


def _argv(case, tmp_path):
    """把 fixture 的佔位符換成本次的臨時檔路徑,順便把檔案建出來。"""
    subs = {}
    if "checkpoint" in case:
        p = tmp_path / "cp.json"
        Checkpoint(**case["checkpoint"]).save(p)
        subs["<CHECKPOINT>"] = str(p)
    if "config" in case:
        p = tmp_path / "config.json"
        p.write_text(json.dumps(case["config"]), encoding="utf-8")
        subs["<CONFIG>"] = str(p)
    if case.get("config_absent"):
        subs["<CONFIG>"] = str(tmp_path / "absent.json")
    return [subs.get(a, a) for a in case["argv"]]


def _run(case, tmp_path, capsys):
    code = main(_argv(case, tmp_path))
    return {"stdout": capsys.readouterr().out, "exit_code": code}


@pytest.mark.parametrize("case", parity_cases("cli", "unitsStatus", SECTIONS))
def test_units_status_cli_parity(case, tmp_path, capsys):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "cli cases assert on exit codes, not exceptions"
    assert_subset(_run(case, tmp_path, capsys), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("cli", "model", SECTIONS))
def test_model_cli_parity(case, tmp_path, capsys):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "cli cases assert on exit codes, not exceptions"
    assert_subset(_run(case, tmp_path, capsys), expect, case["name"])

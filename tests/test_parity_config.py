import json
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.changemeta import ChangeMeta
from devloop.config import (
    Config, load_config, resolve_finish, resolve_model, validate_gate_cmds,
)

SECTIONS = ["loadConfig", "resolveModel", "resolveFinish", "validateGateCmds"]


def _write(tmp_path, payload):
    p = tmp_path / "config.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("config", "loadConfig", SECTIONS))
def test_load_config_parity(case, tmp_path):
    if case.get("file_absent"):
        path = tmp_path / "absent.json"
    else:
        path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            load_config(path)
        return
    assert_subset(asdict(load_config(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "resolveModel", SECTIONS))
def test_resolve_model_parity(case, tmp_path):
    cfg = load_config(_write(tmp_path, case["config"]))
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            resolve_model(case["stage"], cfg)
        return
    assert_subset({"value": resolve_model(case["stage"], cfg)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "resolveFinish", SECTIONS))
def test_resolve_finish_parity(case):
    cfg = Config(finish=case["config_finish"])
    meta = ChangeMeta(finish=case["meta_finish"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            resolve_finish(cfg, meta)
        return
    assert_subset({"value": resolve_finish(cfg, meta)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "validateGateCmds", SECTIONS))
def test_validate_gate_cmds_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            validate_gate_cmds(case["input"])
        return
    assert_subset({"value": validate_gate_cmds(case["input"])}, expect, case["name"])

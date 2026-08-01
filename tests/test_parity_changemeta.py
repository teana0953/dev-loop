import json
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.changemeta import is_serial, load_change_meta

SECTIONS = ["loadChangeMeta", "isSerial"]


def _write(tmp_path, payload):
    p = tmp_path / "change-meta.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("changemeta", "loadChangeMeta", SECTIONS))
def test_load_change_meta_parity(case, tmp_path):
    if case.get("file_absent"):
        path = tmp_path / "absent.json"
    else:
        path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            load_change_meta(path)
        return
    assert_subset(asdict(load_change_meta(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("changemeta", "isSerial", SECTIONS))
def test_is_serial_parity(case, tmp_path):
    path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        # load 或 is_serial 任一步拋錯都算——兩引擎驗證時機不同,
        # 但「這份設定不能安靜地選一條分支」的保證相同。
        with pytest.raises(Exception):
            is_serial(load_change_meta(path))
        return
    assert_subset({"value": is_serial(load_change_meta(path))}, expect, case["name"])

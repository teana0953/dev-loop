import json
import re
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.checkpoint import Checkpoint

SECTIONS = ["loadCheckpoint", "roundTrip"]

# 兩引擎共通的時間戳保證(小數位與時區後綴的文法差異是已知延後項,不在此斷言)
TS_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("checkpoint", "loadCheckpoint", SECTIONS))
def test_load_checkpoint_parity(case, tmp_path):
    path = _write(tmp_path, "checkpoint.json", case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            Checkpoint.load(path)
        return
    assert_subset(asdict(Checkpoint.load(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("checkpoint", "roundTrip", SECTIONS))
def test_checkpoint_round_trip_parity(case, tmp_path):
    src = _write(tmp_path, "checkpoint.json", case["input"])
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "roundTrip cases must not expect a throw"
    cp = Checkpoint.load(src)
    dst = tmp_path / "nested" / "reloaded.json"
    cp.save(dst)
    reloaded = Checkpoint.load(dst)
    assert_subset(asdict(reloaded), expect, case["name"])
    # save 一定重寫 updated_at;文法差異是延後項,只斷言兩邊共通的部分
    assert TS_PREFIX.match(reloaded.updated_at), (
        "%s: updated_at = %r" % (case["name"], reloaded.updated_at)
    )

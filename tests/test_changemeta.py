import json

from devloop.changemeta import ChangeMeta, load_change_meta, is_serial


def test_missing_file_returns_defaults(tmp_path):
    meta = load_change_meta(tmp_path / "nope.json")
    assert meta.parallel_groups == []
    assert meta.needs_uiux is False
    assert meta.finish is None


def test_loads_fields(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({
        "parallel_groups": [{"id": "g1", "tasks": ["1"], "files_hint": ["src/"]}],
        "needs_uiux": True,
        "finish": "pr",
    }), encoding="utf-8")
    meta = load_change_meta(p)
    assert meta.parallel_groups[0]["id"] == "g1"
    assert meta.needs_uiux is True
    assert meta.finish == "pr"


def test_partial_file_fills_defaults(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"needs_uiux": True}), encoding="utf-8")
    meta = load_change_meta(p)
    assert meta.parallel_groups == []
    assert meta.needs_uiux is True
    assert meta.finish is None


def test_is_serial():
    assert is_serial(ChangeMeta(parallel_groups=[])) is True
    assert is_serial(ChangeMeta(parallel_groups=[{"id": "g1"}])) is True
    assert is_serial(ChangeMeta(parallel_groups=[{"id": "g1"}, {"id": "g2"}])) is False


# --- flow_profile(流程檔位,start 時凍結進 checkpoint)---

import pytest
from devloop.changemeta import load_change_meta as _lcm


def test_flow_profile_loads_values(tmp_path):
    p = tmp_path / "m.json"
    p.write_text('{"flow_profile": "light"}')
    assert _lcm(p).flow_profile == "light"
    p.write_text('{"flow_profile": "full"}')
    assert _lcm(p).flow_profile == "full"


def test_flow_profile_missing_defaults_none(tmp_path):
    p = tmp_path / "m.json"
    p.write_text('{}')
    assert _lcm(p).flow_profile is None
    assert _lcm(tmp_path / "nope.json").flow_profile is None


def test_flow_profile_typo_raises(tmp_path):
    p = tmp_path / "m.json"
    p.write_text('{"flow_profile": "lite"}')
    with pytest.raises(ValueError) as e:
        _lcm(p)
    assert "flow_profile" in str(e.value) and "lite" in str(e.value)

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

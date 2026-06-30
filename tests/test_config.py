import json

from devloop.config import Config, load_config


def test_missing_file_returns_defaults(tmp_path):
    cfg = load_config(tmp_path / "nope.json")
    assert cfg.trigger == "local"
    assert cfg.finish is None


def test_loads_fields(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"trigger": "harness", "finish": "pr"}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.trigger == "harness"
    assert cfg.finish == "pr"


def test_partial_file_fills_defaults(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"finish": "merge"}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.trigger == "local"
    assert cfg.finish == "merge"

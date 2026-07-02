import json

import pytest

from devloop.config import Config, load_config, resolve_finish
from devloop.changemeta import ChangeMeta


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


def test_missing_file_defaults_auto_arm_true(tmp_path):
    cfg = load_config(tmp_path / "nope.json")
    assert cfg.auto_arm is True


def test_missing_key_defaults_auto_arm_true(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"finish": "merge"}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.auto_arm is True


def test_loads_auto_arm_false(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"auto_arm": False}), encoding="utf-8")
    cfg = load_config(p)
    assert cfg.auto_arm is False


def test_resolve_meta_overrides_config():
    cfg = Config(finish="merge")
    meta = ChangeMeta(finish="pr")
    assert resolve_finish(cfg, meta) == "pr"


def test_resolve_falls_back_to_config():
    cfg = Config(finish="merge")
    meta = ChangeMeta(finish=None)
    assert resolve_finish(cfg, meta) == "merge"


def test_resolve_defaults_to_ask():
    assert resolve_finish(Config(), ChangeMeta()) == "ask"


def test_resolve_accepts_merge_pr_ask():
    assert resolve_finish(Config(finish="merge"), ChangeMeta()) == "merge"
    assert resolve_finish(Config(finish="pr"), ChangeMeta()) == "pr"
    assert resolve_finish(Config(finish="ask"), ChangeMeta()) == "ask"


def test_resolve_invalid_config_value_raises():
    with pytest.raises(ValueError):
        resolve_finish(Config(finish="merg"), ChangeMeta())


def test_resolve_invalid_meta_value_raises():
    with pytest.raises(ValueError):
        resolve_finish(Config(finish="merge"), ChangeMeta(finish="pull-request"))

import json
from pathlib import Path

import devloop

ROOT = Path(__file__).resolve().parent.parent  # repo 根


def test_plugin_version_matches_dunder():
    manifest = json.loads(
        (ROOT / "plugins/dev-loop/.claude-plugin/plugin.json").read_text(encoding="utf-8"))
    assert manifest["version"] == devloop.__version__


def test_marketplace_lists_plugin_with_source():
    mkt = json.loads(
        (ROOT / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    entry = next(p for p in mkt["plugins"] if p["name"] == "dev-loop")
    assert entry["source"] == "./plugins/dev-loop"

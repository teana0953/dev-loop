from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins/dev-loop/skills/dev-loop/SKILL.md"


def _text():
    return SKILL.read_text(encoding="utf-8")


def test_skill_documents_graph_build_on_first_start():
    t = _text()
    assert "code-review-graph build -q" in t
    assert ".code-review-graph/" in t


def test_skill_documents_graph_update_after_apply():
    assert "code-review-graph update -q --base" in _text()


def test_skill_documents_graph_impact_for_review():
    t = _text()
    assert "code-review-graph impact --files" in t
    assert "impacted_files" in t


def test_skill_documents_graceful_degradation():
    """缺工具/缺圖時必須明講降級,不能只寫 happy path。"""
    t = _text()
    assert "退回" in t and "整包 diff" in t

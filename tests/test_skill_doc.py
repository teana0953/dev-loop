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
    # Lock the flag values, not just the flag names — a future edit that
    # changes or drops these should fail this test.
    assert "--depth 2" in t
    assert "--max-results 50" in t


def test_skill_documents_impact_files_source_is_explicit():
    """"本次改動檔" 必須有明確、可執行的來源命令,而不是留給 agent 自己猜。"""
    t = _text()
    assert "git diff <trunk>...HEAD --name-only" in t


def _slice(text, start_marker, end_marker):
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[start:end]


def test_skill_documents_graceful_degradation_anchor_a_build():
    """核心迴圈第 1 點的 code-review-graph build 段必須自帶降級敘述。"""
    seg = _slice(_text(), "順手備妥 code-review-graph", "2. **推進到卡點**")
    assert "跳過" in seg
    assert "忽略" in seg


def test_skill_documents_graceful_degradation_anchor_b_update():
    """流程步驟 5 的 code-review-graph update 段必須自帶降級敘述。"""
    seg = _slice(_text(), "同步 code-review-graph", "完成後 `event --event apply_done`")
    assert "跳過" in seg
    assert "忽略" in seg


def test_skill_documents_graceful_degradation_anchor_c_review():
    """流程步驟 8 的 code-review-graph impact 段必須自帶降級敘述(退回讀整包 diff)。"""
    seg = _slice(_text(), "先決定 reviewer 的閱讀範圍", "接著 `legs-init")
    assert "退回" in seg
    assert "整包 diff" in seg

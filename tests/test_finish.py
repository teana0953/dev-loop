# tests/test_finish.py
from devloop.finish import render_followup, write_followup


def test_render_followup_lists_notes():
    out = render_followup(["rename x", "add docstring"])
    assert "## Follow-up(non-blocking)" in out
    assert "- rename x" in out
    assert "- add docstring" in out
    assert out.endswith("\n")


def test_render_followup_empty():
    assert render_followup([]) == ""


def test_write_followup_creates_file(tmp_path):
    p = tmp_path / "followup.md"
    write_followup(p, ["fix typo"])
    content = p.read_text(encoding="utf-8")
    assert "- fix typo" in content

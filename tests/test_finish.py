# tests/test_finish.py
import pytest

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


def test_render_followup_rejects_a_non_string_note():
    # note 一路從 review 報告經 checkpoint 流到這裡,兩段都不驗元素型別;
    # 放行的話 Python 會炸在字串串接、TS 會把數字直接印進 markdown。
    with pytest.raises(TypeError):
        render_followup([1])


def test_render_followup_rejects_a_non_string_among_valid_notes():
    with pytest.raises(TypeError):
        render_followup(["ok", 2])


def test_render_followup_rejects_a_bare_string():
    # 放行的話會逐字元拆成 bullet,而 TS 那側直接拋錯。
    with pytest.raises(TypeError):
        render_followup("ab")


def test_render_followup_rejects_none():
    with pytest.raises(TypeError):
        render_followup(None)

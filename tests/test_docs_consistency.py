from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
CMD = ROOT / "plugins/dev-loop/commands/dev-loop.md"


def test_readme_lists_optional_tools_with_install_commands():
    t = README.read_text(encoding="utf-8")
    assert "npm i -g @alibaba-group/open-code-review" in t
    assert "caveman" in t
    assert "JuliusBrussee/caveman" in t


def test_readme_says_ocr_is_not_used_for_file_selection():
    """OCR 的 delegate preview 會排除測試檔與 .md。README 必須講明我們不用它選檔,
    否則使用者照官方文件「補上 preview」會靜默縮小審查範圍。"""
    assert "不用" in README.read_text(encoding="utf-8")
    assert "delegate preview" in README.read_text(encoding="utf-8")


def test_command_doc_mentions_optional_tools():
    t = CMD.read_text(encoding="utf-8")
    assert "caveman" in t
    assert "open-code-review" in t

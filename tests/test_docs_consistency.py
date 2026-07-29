from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
CMD = ROOT / "plugins/dev-loop/commands/dev-loop.md"


def test_readme_lists_optional_tools_with_install_commands():
    t = README.read_text(encoding="utf-8")
    assert "pip install code-review-graph" in t
    assert "caveman" in t
    assert "JuliusBrussee/caveman" in t


def test_readme_tells_projects_to_gitignore_graph_data():
    assert ".code-review-graph/" in README.read_text(encoding="utf-8")


def test_command_doc_mentions_optional_tools():
    t = CMD.read_text(encoding="utf-8")
    assert "caveman" in t
    assert "code-review-graph" in t

"""遷移完整性守衛:code-review-graph 不得殘留在活的編排面上。

這次遷移橫跨 SKILL.md、README、command doc、check-deps.sh、.gitignore 與四個
測試檔。半套遷移不會讓任何既有測試變紅——留一句 SKILL 指令指向一個已經不再被
偵測的工具,loop 照跑,只是那句話永遠不會生效。這條測試是唯一會發現的東西。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 歷史 spec 與 plan 記錄的是當時的決策,本來就該保留 code-review-graph 的字樣。
EXEMPT_PREFIXES = ("docs/superpowers/",)

# 掃描範圍:活的編排面與設定。刻意不掃整個 repo——node_modules 與 .git 沒有意義。
SCAN_ROOTS = (
    "plugins/dev-loop/skills",
    "plugins/dev-loop/commands",
    "plugins/dev-loop/bin",
    "openspec",
    "tests",
)
SCAN_FILES = ("README.md", ".gitignore", "Makefile")


def _candidates():
    for rel in SCAN_FILES:
        p = ROOT / rel
        if p.is_file():
            yield p
    for root in SCAN_ROOTS:
        base = ROOT / root
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in (".md", ".sh", ".py", ".json", ".yml", ".yaml"):
                yield p


def test_no_code_review_graph_residue():
    hits = []
    for p in _candidates():
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(EXEMPT_PREFIXES) or rel == "tests/test_no_crg_residue.py":
            continue
        if "code-review-graph" in p.read_text(encoding="utf-8"):
            hits.append(rel)
    assert not hits, "code-review-graph 殘留在:%s" % ", ".join(sorted(hits))

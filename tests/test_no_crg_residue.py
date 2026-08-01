"""遷移完整性守衛:code-review-graph 不得殘留在活的編排面上。

這次遷移橫跨 SKILL.md、README、command doc、check-deps.sh、.gitignore 與四個
測試檔。半套遷移不會讓任何既有測試變紅——留一句 SKILL 指令指向一個已經不再被
偵測的工具,loop 照跑,只是那句話永遠不會生效。這條測試是唯一會發現的東西。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 歷史 spec 與 plan 記錄的是當時的決策,本來就該保留 code-review-graph 的字樣。
# 這個豁免要是 load-bearing 的:SCAN_ROOTS 必須真的含 docs,否則沒有任何候選
# 路徑會以 docs/ 開頭,豁免永遠不會被用到(這正是先前的漏洞——SCAN_ROOTS 沒有
# docs 條目,98 個掃描路徑沒有一個以 docs/ 開頭,拿掉豁免結果不變)。
EXEMPT_PREFIXES = ("docs/superpowers/",)

# 掃描範圍:活的編排面與設定。刻意不掃整個 repo——node_modules 與 .git 沒有意義。
# docs 納入是為了讓上面的豁免有東西可豁免(同時也擴大涵蓋範圍);hooks.json 與
# 兩層 .claude-plugin/ 是活的編排面(hook 設定、plugin/marketplace 宣告);
# .github 是 CI/release 工作流程,同樣是活面。
SCAN_ROOTS = (
    "plugins/dev-loop/skills",
    "plugins/dev-loop/commands",
    "plugins/dev-loop/bin",
    "plugins/dev-loop/hooks",
    "plugins/dev-loop/.claude-plugin",
    ".claude-plugin",
    ".github",
    "docs",
    "openspec",
    "tests",
)
SCAN_FILES = ("README.md", ".gitignore", "Makefile")

_SCANNED_SUFFIXES = (".md", ".sh", ".py", ".json", ".yml", ".yaml")


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
            if not p.is_file():
                continue
            if p.suffix in _SCANNED_SUFFIXES:
                yield p
            elif p.suffix == "" and "bin" in p.relative_to(ROOT).parts:
                # 副檔名過濾會讓 bin/ 底下無副檔名的執行檔(如
                # plugins/dev-loop/bin/devloop)對這條守衛隱形,即使它就位在
                # 掃描根目錄內——單獨為 bin/ 補上 extensionless 檔案。
                yield p


def _hits(exempt_prefixes):
    hits = []
    for p in _candidates():
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(exempt_prefixes) or rel == "tests/test_no_crg_residue.py":
            continue
        if "code-review-graph" in p.read_text(encoding="utf-8"):
            hits.append(rel)
    return hits


def test_no_code_review_graph_residue():
    hits = _hits(EXEMPT_PREFIXES)
    assert not hits, "code-review-graph 殘留在:%s" % ", ".join(sorted(hits))


def test_docs_exemption_is_load_bearing():
    """先前的漏洞:EXEMPT_PREFIXES 寫著 docs/superpowers/,但 SCAN_ROOTS 沒有
    docs 條目,所以沒有任何候選路徑會以 docs/ 開頭——豁免永遠不會被用到,拿掉
    它結果不變。現在 SCAN_ROOTS 含 docs,這條測試證明豁免是活的:(1) 有候選
    路徑以 docs/ 開頭;(2) 不豁免的話,`docs/superpowers/` 下真的有
    code-review-graph 的歷史提及會被抓到,而且只有那些。"""
    docs_candidates = [
        p.relative_to(ROOT).as_posix() for p in _candidates()
        if p.relative_to(ROOT).as_posix().startswith("docs/")
    ]
    assert docs_candidates, "SCAN_ROOTS 沒有涵蓋任何 docs/ 路徑,豁免無東西可豁免"

    hits_without_exemption = _hits(())
    assert hits_without_exemption, (
        "拿掉豁免後結果不變——docs/superpowers/ 下沒有偵測到任何歷史提及,"
        "代表豁免仍是死碼"
    )
    assert all(h.startswith("docs/superpowers/") for h in hits_without_exemption), (
        "拿掉豁免後出現了 docs/superpowers/ 以外的殘留,守衛本身就該紅：%s"
        % hits_without_exemption
    )


def test_bin_extensionless_executable_is_scanned():
    """`plugins/dev-loop/bin/devloop` 沒有副檔名,原本的副檔名過濾清單
    (.md/.sh/.py/.json/.yml/.yaml)會讓它對這條守衛完全隱形,即使它人在被掃
    的 bin/ 根目錄底下。"""
    candidates = {p.relative_to(ROOT).as_posix() for p in _candidates()}
    assert "plugins/dev-loop/bin/devloop" in candidates

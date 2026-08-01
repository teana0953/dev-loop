from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins/dev-loop/skills/dev-loop/SKILL.md"


def _text():
    return SKILL.read_text(encoding="utf-8")


def _slice(text, start_marker, end_marker):
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[start:end]


def test_skill_documents_changed_file_source_is_explicit():
    """改動檔清單必須有明確、可執行的來源命令,而不是留給 agent 自己猜。
    這條命令同時是 review 範圍的定義——OCR 不參與決定審哪些檔。"""
    t = _text()
    assert "git diff <trunk>...HEAD --name-only" in t


REVIEW_SEG_START = "**reviewer 的閱讀材料**"
REVIEW_SEG_END = "接著 `legs-init"


def test_skill_documents_ocr_rule_lookup_for_review():
    """review 段必須有可執行的 ocr 命令,而不是泛泛說「用 OCR」。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "ocr delegate rule" in seg
    assert "command -v ocr" in seg


def test_skill_ocr_section_documents_degradation():
    """沿用既有規矩:每個可選工具段落都要能自證降級,不能只在別處交代。三個
    具體觸發條件(不在 PATH、非 0 退出、逾時)都要點名,連逾時秒數都要釘住——
    悄悄改掉其中一個觸發條件或秒數,不該還能通過這條測試。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "降級" in seg
    assert "恆不可裁" in seg
    assert "不在 PATH" in seg
    assert "非 0 退出" in seg
    assert "逾時(30 秒)" in seg


def test_skill_review_scope_is_not_narrowed():
    """這整個改動存在的理由:diff 範圍必須看完每個真的改了的檔案,而且文字
    不能宣稱或暗示這個範圍被縮小了。這是先前舊審查工具的兩條測試
    (test_skill_review_scope_a_is_honest_about_no_reduction、
    test_skill_review_scope_bounded_not_more_than_fallback)在守的不變量,換了
    工具之後這條不變量還在,必須繼續有測試釘住——否則未來有人悄悄加回
    `-- <改動檔...>` 這類過濾,或把「不縮小」那句話改弱,整條測試套件不會有
    任何一條抓到。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "審查必須看完每個真的改了的檔案" in seg
    assert "這個範圍不縮小,也不假裝縮小" in seg


def test_skill_excludes_json_from_ocr_rule_lookup():
    """.json 的規則是「忽略 json-values 的內容」,而 fixtures/parity/*.json
    的意義全在 value——那句指令不得進 reviewer 的 prompt。必須連理由一起寫,
    否則日後有人會以為這是隨手加的例外而拿掉。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "排除 .json" in seg
    assert "json-values" in seg


def test_skill_says_ocr_does_not_select_files():
    """OCR 的 delegate preview 會排除測試檔與 .md。SKILL 必須明講不用它選檔,
    否則日後照官方流程「補上 preview」會靜默縮小審查範圍。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "加法,不是減法" in seg
    assert "delegate preview" in seg
    assert "不要用它選檔" in seg


def test_skill_warns_ocr_arg_error_is_silent():
    """傳參錯誤時 ocr exit 0 並回通用規則組,沒有錯誤訊號——這個坑必須寫在
    命令旁邊,因為它無法靠 exit code 偵測。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "獨立參數" in seg
    assert "exit 0" in seg

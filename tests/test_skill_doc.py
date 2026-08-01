import re
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
    任何一條抓到。

    只斷言兩句話存在不夠:mutation-proven 過——把讀取材料換成
    `delegate preview` 為底的一對命令、兩句話原封不動留著,7 條測試照樣全過。
    這裡額外正面釘住「無過濾的 git diff 是獨立一個 fenced block」,並負面
    排除路徑過濾形式(`git diff <trunk>...HEAD -- `)與段落外的
    `delegate preview` 提及(唯一合法出現處是禁止使用它選檔的那句)。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "審查必須看完每個真的改了的檔案" in seg
    assert "這個範圍不縮小,也不假裝縮小" in seg
    # 正面:無過濾的 git diff 必須自成一個 fenced block(而不是被
    # `delegate preview` 為底的命令取代)。
    assert re.search(r"```\n\s*git diff <trunk>\.\.\.HEAD\n\s*```", seg)
    # 負面:不得出現路徑過濾形式的 diff(縮小審查範圍)。
    assert "git diff <trunk>...HEAD -- " not in seg
    # 負面:`delegate preview` 只准出現在「不要用它選檔」那一句禁止性提及裡,
    # 不能有第二處(例如被拿去當閱讀材料的來源)。
    assert seg.count("delegate preview") == 1
    assert "不要用它選檔" in seg


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


def test_skill_gives_executable_file_list_pipeline():
    """`ocr delegate rule <上一步輸出的檔案,排除 .json>` 是佔位符,不是可執行
    命令——這段唯一有靜默失敗模式(整串路徑當一個參數傳入,exit 0 且無錯誤
    訊號),不能留給 agent 臨場拼湊。SKILL 必須給出檔案清單 → 過濾 → 陣列展開
    的完整可執行 pipeline,且要對 bash 與 zsh 都穩(專案預設 zsh,未加引號的
    參數展開不斷詞)。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "grep -v" in seg
    assert '"${FILES[@]}"' in seg
    assert "zsh" in seg
    assert "ocr delegate rule \"${FILES[@]}\"" in seg
    # 佔位符形式不該再出現。
    assert "<上一步輸出的檔案,排除 .json>" not in seg


def test_skill_delivers_ocr_output_verbatim_into_code_leg_only():
    """這是讓整個整合真的產生效果的唯一句子:輸出原樣併進 code leg 的
    prompt,uiux leg 不給。mutation-proven——刪掉這句,7 條既有測試全過,
    因為其餘 6 條只守「呼叫」,沒有一條守「消費」。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "原樣" in seg
    assert "併進" in seg
    assert "code leg" in seg
    assert "uiux leg 不給" in seg


def test_skill_verifies_ocr_output_before_trusting_it():
    """`ocr` 是三個字母的通用名字,PATH 上可能有同名的其他工具(OCR 文字
    辨識、個人腳本、alias)。降級只在非 0 退出時觸發;一個剛好 exit 0 的假
    `ocr` 會把任意文字原樣塞進 reviewer 的 prompt(見上一條測試——輸出是
    原樣併入,不解析)。SKILL 必須在使用輸出前驗證來源,並把驗證失敗列為
    降級觸發之一。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "### Rule Group" in seg
    assert "驗證輸出" in seg
    assert "輸出不含 `### Rule Group`" in seg

from __future__ import annotations

from pathlib import Path


def render_followup(notes) -> str:
    """notes 必須是字串 list。

    上游 parse_review_report 已驗過 note 型別,但 non_blocking 是從 checkpoint
    讀回來的,而 checkpoint 載入刻意不驗欄位型別——手改過的檔仍能送進非字串。
    這裡再擋一次,而且要在兩個引擎擋出同一個結果:放行的話 Python 會逐字元
    拆字串、TS 則直接把數字印進 markdown,同一份輸入兩種產物。
    """
    if not isinstance(notes, list):
        raise TypeError("notes must be a list, got %r" % (notes,))
    for i, n in enumerate(notes):
        if not isinstance(n, str):
            raise TypeError("notes[%d] must be a string, got %r" % (i, n))
    if not notes:
        return ""
    lines = ["## Follow-up(non-blocking)", ""]
    lines.extend("- " + n for n in notes)
    return "\n".join(lines) + "\n"


def write_followup(path, notes) -> None:
    Path(path).write_text(render_followup(notes), encoding="utf-8")

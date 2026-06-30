from __future__ import annotations

from pathlib import Path


def render_followup(notes) -> str:
    if not notes:
        return ""
    lines = ["## Follow-up(non-blocking)", ""]
    lines.extend("- " + n for n in notes)
    return "\n".join(lines)


def write_followup(path, notes) -> None:
    Path(path).write_text(render_followup(notes), encoding="utf-8")

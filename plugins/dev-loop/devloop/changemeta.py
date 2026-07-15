from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ChangeMeta:
    parallel_groups: list = field(default_factory=list)
    needs_uiux: bool = False
    finish: str = None


def load_change_meta(path) -> "ChangeMeta":
    p = Path(path)
    if not p.exists():
        return ChangeMeta()
    data = json.loads(p.read_text(encoding="utf-8"))
    return ChangeMeta(
        parallel_groups=data.get("parallel_groups", []),
        needs_uiux=data.get("needs_uiux", False),
        finish=data.get("finish", None),
    )


def is_serial(meta) -> bool:
    return len(meta.parallel_groups) <= 1

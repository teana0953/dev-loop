from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Config:
    trigger: str = "local"
    finish: str | None = None


def load_config(path) -> Config:
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        trigger=data.get("trigger", "local"),
        finish=data.get("finish", None),
    )

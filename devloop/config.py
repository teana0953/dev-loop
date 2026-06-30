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


def resolve_finish(config, meta) -> str:
    """決定收尾策略:change metadata 的 finish override 全域 config;皆無 → ask。"""
    if meta.finish is not None:
        return meta.finish
    if config.finish is not None:
        return config.finish
    return "ask"

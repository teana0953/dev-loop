from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Config:
    trigger: str = "local"
    finish: str | None = None
    auto_arm: bool = True


def load_config(path) -> Config:
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        trigger=data.get("trigger", "local"),
        finish=data.get("finish", None),
        auto_arm=bool(data.get("auto_arm", True)),
    )


VALID_FINISH_VALUES = ("merge", "pr", "ask")


def resolve_finish(config, meta) -> str:
    """決定收尾策略:change metadata 的 finish override 全域 config;皆無 → ask。

    無效值(非 merge/pr/ask/None)視為設定錯誤,拋 ValueError(值本身)。
    """
    if meta.finish is not None:
        decision = meta.finish
    elif config.finish is not None:
        decision = config.finish
    else:
        decision = "ask"
    if decision not in VALID_FINISH_VALUES:
        raise ValueError(decision)
    return decision

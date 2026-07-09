from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    finish: str | None = None
    auto_arm: bool = True
    gate_cmds: list = field(default_factory=list)


def load_config(path) -> Config:
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        finish=data.get("finish", None),
        auto_arm=bool(data.get("auto_arm", True)),
        gate_cmds=data.get("gate_cmds", []),
    )


def validate_gate_cmds(gate_cmds):
    """gate_cmds 必須是非空字串的 list;非法拋 ValueError(fail loudly,
    與 finish 值域驗證同精神——設定 typo 不得靜默退化)。"""
    if not isinstance(gate_cmds, list) or not all(
        isinstance(c, str) and c.strip() for c in gate_cmds
    ):
        raise ValueError("gate_cmds must be a list of non-empty strings, got %r" % (gate_cmds,))
    return gate_cmds


VALID_FINISH_VALUES = ("merge", "pr", "ask")


def resolve_finish(config, meta) -> str:
    """決定收尾策略:change metadata 的 finish override 全域 config;皆無 → ask。

    config.finish 與 meta.finish 各自獨立驗證——即使被合法值 override,
    非法值(typo)也不得靜默吞掉,拋 ValueError(含來源與值)。
    """
    for source, value in (("config.finish", config.finish), ("meta.finish", meta.finish)):
        if value is not None and value not in VALID_FINISH_VALUES:
            raise ValueError("%s=%r" % (source, value))
    if meta.finish is not None:
        return meta.finish
    if config.finish is not None:
        return config.finish
    return "ask"

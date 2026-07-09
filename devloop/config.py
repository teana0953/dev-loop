from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Config:
    finish: str | None = None
    auto_arm: bool = True


def load_config(path) -> Config:
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        finish=data.get("finish", None),
        auto_arm=bool(data.get("auto_arm", True)),
    )


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

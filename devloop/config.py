from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    finish: str | None = None
    auto_arm: bool = True
    gate_cmds: list = field(default_factory=list)
    # superpowers 由編排 skill 消費(引擎不分支):True/False/None(未設,
    # SKILL 第一次啟動時問使用者再寫回)。非布林值原樣保留,消費端視為未設。
    superpowers: bool | None = None
    # auto_approve 同為編排層開關:true 時跳過「批准設計/批准提案」人工關卡
    # (escalated 安全閥不受影響)。只認 JSON true——它管的是略過人工,
    # 解析錯誤必須朝「要人工」的保守方向退化。
    auto_approve: bool = False


def load_config(path) -> Config:
    p = Path(path)
    if not p.exists():
        return Config()
    data = json.loads(p.read_text(encoding="utf-8"))
    return Config(
        finish=data.get("finish", None),
        auto_arm=bool(data.get("auto_arm", True)),
        gate_cmds=data.get("gate_cmds", []),
        superpowers=data.get("superpowers", None),
        auto_approve=(data.get("auto_approve", False) is True),
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

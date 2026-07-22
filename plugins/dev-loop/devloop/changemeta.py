from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ChangeMeta:
    parallel_groups: list = field(default_factory=list)
    needs_uiux: bool = False
    finish: str = None
    # 流程檔位:full(預設)/ light。start 時凍結進 checkpoint,此後引擎只讀 checkpoint。
    flow_profile: str = None


VALID_FLOW_PROFILES = ("full", "light")


def load_change_meta(path) -> "ChangeMeta":
    p = Path(path)
    if not p.exists():
        return ChangeMeta()
    data = json.loads(p.read_text(encoding="utf-8"))
    flow_profile = data.get("flow_profile", None)
    # 壞設定在 start 就炸(同 config 的 model 驗證精神),不是跑到 qa 才發現
    if flow_profile is not None and flow_profile not in VALID_FLOW_PROFILES:
        raise ValueError("flow_profile=%r (valid: %s)"
                         % (flow_profile, "/".join(VALID_FLOW_PROFILES)))
    return ChangeMeta(
        parallel_groups=data.get("parallel_groups", []),
        needs_uiux=data.get("needs_uiux", False),
        finish=data.get("finish", None),
        flow_profile=flow_profile,
    )


def is_serial(meta) -> bool:
    return len(meta.parallel_groups) <= 1

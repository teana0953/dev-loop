from __future__ import annotations

import json
from pathlib import Path

from devloop.statemachine import (
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
)


def classify(findings):
    """將 review findings 映射成狀態機事件(規格 5)。

    任一 proposal 層級 blocking → 逃生門(回 propose);
    否則有 code blocking → fix;全無 blocking → merge。
    """
    blocking = [f for f in findings if f.get("severity") == "blocking"]
    if not blocking:
        return REVIEW_NO_BLOCKING
    if any(f.get("level") == "proposal" for f in blocking):
        return REVIEW_BLOCKING_PROPOSAL
    return REVIEW_BLOCKING_CODE


def non_blocking_notes(findings):
    """抽出 non-blocking 項的 note 文字供 follow-up。"""
    return [f.get("note", "") for f in findings if f.get("severity") == "non_blocking"]


def parse_review_report(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["findings"]

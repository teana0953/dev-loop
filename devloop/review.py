from __future__ import annotations

import json
from pathlib import Path

from devloop.statemachine import (
    PROPOSE_BLOCKING_DESIGN,
    PROPOSE_BLOCKING_PROPOSAL,
    PROPOSE_CLEAN,
    QA_FAIL,
    QA_PASS,
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


def classify_proposal(findings):
    """Proposal review 分類:design 層 blocking 優先 → 升級;
    proposal 層 blocking → 回 propose;無 blocking → clean。"""
    blocking = [f for f in findings if f.get("severity") == "blocking"]
    if not blocking:
        return PROPOSE_CLEAN
    if any(f.get("level") == "design" for f in blocking):
        return PROPOSE_BLOCKING_DESIGN
    return PROPOSE_BLOCKING_PROPOSAL


def non_blocking_notes(findings):
    """抽出 non-blocking 項的 note 文字供 follow-up。"""
    return [f.get("note", "") for f in findings if f.get("severity") == "non_blocking"]


def parse_review_report(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["findings"]


def classify_qa(findings):
    """QA 報告分類:任一 blocking → QA_FAIL;否則 QA_PASS。"""
    if any(f.get("severity") == "blocking" for f in findings):
        return QA_FAIL
    return QA_PASS

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


VALID_SEVERITIES = ("blocking", "non_blocking")


class ReportError(ValueError):
    """review 報告非法(檔案缺失、非 JSON、schema 不符)。格式錯必須 fail loudly,
    不得與「findings 為空(=pass)」混同。"""


def parse_review_report(path):
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise ReportError("cannot read report %s: %s" % (path, exc))
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ReportError("report %s is not valid JSON: %s" % (path, exc))
    if not isinstance(data, dict) or "findings" not in data:
        raise ReportError('report %s missing "findings" key' % path)
    findings = data["findings"]
    if not isinstance(findings, list):
        raise ReportError('report %s "findings" must be a list' % path)
    for i, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise ReportError("report %s findings[%d] must be an object" % (path, i))
        severity = finding.get("severity")
        if severity not in VALID_SEVERITIES:
            raise ReportError(
                "report %s findings[%d] invalid severity %r (expected blocking|non_blocking)"
                % (path, i, severity)
            )
    return findings


def aggregate_findings(report_paths):
    """把多個 review 報告的 findings 串接成單一 list(供 code+uiux legs 彙總)。"""
    merged = []
    for path in report_paths:
        merged.extend(parse_review_report(path))
    return merged


def classify_qa(findings):
    """QA 報告分類:任一 blocking → QA_FAIL;否則 QA_PASS。"""
    if any(f.get("severity") == "blocking" for f in findings):
        return QA_FAIL
    return QA_PASS

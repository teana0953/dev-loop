import json

from devloop.review import classify, non_blocking_notes, parse_review_report
from devloop.statemachine import (
    REVIEW_BLOCKING_CODE,
    REVIEW_BLOCKING_PROPOSAL,
    REVIEW_NO_BLOCKING,
)


def test_classify_no_blocking():
    findings = [{"severity": "non_blocking", "level": "code", "note": "rename"}]
    assert classify(findings) == REVIEW_NO_BLOCKING


def test_classify_empty_is_no_blocking():
    assert classify([]) == REVIEW_NO_BLOCKING


def test_classify_blocking_code():
    findings = [{"severity": "blocking", "level": "code", "note": "off-by-one"}]
    assert classify(findings) == REVIEW_BLOCKING_CODE


def test_classify_proposal_takes_precedence():
    findings = [
        {"severity": "blocking", "level": "code", "note": "bug"},
        {"severity": "blocking", "level": "proposal", "note": "spec wrong"},
    ]
    assert classify(findings) == REVIEW_BLOCKING_PROPOSAL


def test_non_blocking_notes_extracts_only_non_blocking():
    findings = [
        {"severity": "blocking", "level": "code", "note": "bug"},
        {"severity": "non_blocking", "level": "code", "note": "rename x"},
        {"severity": "non_blocking", "level": "code", "note": "add docstring"},
    ]
    assert non_blocking_notes(findings) == ["rename x", "add docstring"]


def test_parse_review_report(tmp_path):
    path = tmp_path / "review.json"
    path.write_text(
        json.dumps({"findings": [{"severity": "blocking", "level": "code", "note": "x"}]}),
        encoding="utf-8",
    )
    findings = parse_review_report(path)
    assert findings == [{"severity": "blocking", "level": "code", "note": "x"}]

import json

from devloop.review import classify, classify_proposal, classify_qa, non_blocking_notes, parse_review_report
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


def test_classify_qa_blocking_fails():
    findings = [{"severity": "blocking", "level": "behavior", "note": "crash on empty input"}]
    assert classify_qa(findings) == QA_FAIL


def test_classify_qa_no_blocking_passes():
    findings = [{"severity": "non_blocking", "level": "behavior", "note": "slow"}]
    assert classify_qa(findings) == QA_PASS


def test_classify_qa_empty_passes():
    assert classify_qa([]) == QA_PASS


def test_classify_proposal_clean():
    assert classify_proposal([{"severity": "non_blocking", "level": "proposal", "note": "x"}]) == PROPOSE_CLEAN


def test_classify_proposal_blocking_proposal():
    findings = [{"severity": "blocking", "level": "proposal", "note": "scope too big"}]
    assert classify_proposal(findings) == PROPOSE_BLOCKING_PROPOSAL


def test_classify_proposal_blocking_design_takes_precedence():
    findings = [
        {"severity": "blocking", "level": "proposal", "note": "x"},
        {"severity": "blocking", "level": "design", "note": "wrong approach"},
    ]
    assert classify_proposal(findings) == PROPOSE_BLOCKING_DESIGN


def test_aggregate_findings_concatenates(tmp_path):
    from devloop.review import aggregate_findings

    p1 = tmp_path / "code.json"
    p1.write_text(json.dumps({"findings": [{"severity": "blocking", "level": "code", "note": "bug"}]}), encoding="utf-8")
    p2 = tmp_path / "uiux.json"
    p2.write_text(json.dumps({"findings": [{"severity": "non_blocking", "level": "code", "note": "spacing"}]}), encoding="utf-8")
    merged = aggregate_findings([str(p1), str(p2)])
    assert len(merged) == 2
    assert merged[0]["note"] == "bug"
    assert merged[1]["note"] == "spacing"


def test_aggregate_findings_empty():
    from devloop.review import aggregate_findings

    assert aggregate_findings([]) == []

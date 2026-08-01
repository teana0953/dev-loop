import json

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.review import (
    aggregate_findings, classify, classify_proposal, classify_qa,
    non_blocking_notes, parse_review_report,
)

SECTIONS = [
    "classify", "classifyProposal", "classifyQa",
    "nonBlockingNotes", "parseReviewReport", "aggregateFindings",
]


def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _pure(section, fn):
    @pytest.mark.parametrize("case", parity_cases("review", section, SECTIONS))
    def test(case):
        expect, throws = resolve_expectation(case, "py")
        if throws:
            with pytest.raises(Exception):
                fn(case["findings"])
            return
        assert_subset({"value": fn(case["findings"])}, expect, case["name"])
    return test


test_classify_parity = _pure("classify", classify)
test_classify_proposal_parity = _pure("classifyProposal", classify_proposal)
test_classify_qa_parity = _pure("classifyQa", classify_qa)
test_non_blocking_notes_parity = _pure("nonBlockingNotes", non_blocking_notes)


@pytest.mark.parametrize("case", parity_cases("review", "parseReviewReport", SECTIONS))
def test_parse_review_report_parity(case, tmp_path):
    if case.get("file_absent"):
        path = tmp_path / "absent.json"
    else:
        path = _write(tmp_path, "report.json", case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            parse_review_report(path)
        return
    assert_subset({"value": parse_review_report(path)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("review", "aggregateFindings", SECTIONS))
def test_aggregate_findings_parity(case, tmp_path):
    paths = [
        _write(tmp_path, "r%d.json" % i, payload)
        for i, payload in enumerate(case["inputs"])
    ]
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            aggregate_findings(paths)
        return
    assert_subset({"value": aggregate_findings(paths)}, expect, case["name"])

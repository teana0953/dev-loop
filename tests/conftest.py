"""跨引擎 parity fixture 的 Python 側 loader。

fixtures/parity/*.json 同時被本檔與 plugins/dev-loop/src/parityFixture.ts
消費。兩側必須斷言同一張預期表——只改一側即為錯誤。
契約見 fixtures/parity/README.md。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

PARITY_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "parity"


def parity_cases(module, section, expected_sections):
    """取 <module>.json 的一個 section,回傳 pytest.param 清單。

    順帶守住「檔內每個 section 都有人消費」——加了 section 卻沒人讀,
    會靜默通過,fixture 就變成裝飾品。
    """
    data = json.loads((PARITY_DIR / ("%s.json" % module)).read_text(encoding="utf-8"))
    assert isinstance(data, dict), "%s.json root must be an object" % module
    assert set(data) == set(expected_sections), (
        "%s.json sections %s != consumed %s"
        % (module, sorted(data), sorted(expected_sections))
    )
    cases = data[section]
    assert cases, "%s.json section %s is empty" % (module, section)
    names = [c["name"] for c in cases]
    assert len(names) == len(set(names)), "%s/%s has duplicate case names" % (module, section)
    return [pytest.param(c, id=c["name"]) for c in cases]


def resolve_expectation(case, engine):
    """把 case 攤成 (expect, expect_throws)。分歧 case 取本引擎那份區塊。"""
    if "divergence_reason" in case:
        assert case["divergence_reason"].strip(), "divergence_reason must be non-empty"
        assert "py" in case and "ts" in case, "divergence case needs both py and ts blocks"
        assert "expect" not in case and "expect_throws" not in case, (
            "divergence case must not also carry a top-level expectation"
        )
        block = case[engine]
    else:
        block = case
    expect = block.get("expect")
    throws = block.get("expect_throws", False)
    assert (expect is None) != (not throws), (
        "case %r must have exactly one of expect / expect_throws" % case["name"]
    )
    return expect, throws


def _assert_type_strict_eq(got, want, path):
    """遞迴、型別嚴格的相等比較——match TS 那側 toStrictEqual 的遞迴行為。

    dict 額外檢查鍵集合完全相同,list 額外檢查長度相同,兩者都往下遞迴比對
    每個元素/值的型別與內容。純量則同時比 type 與值,讓 bool/int、int/float
    這類 Python 認為「相等」但語意不同的值被視為不符。
    """
    assert type(got) is type(want), "%s = %r, want %r" % (path, got, want)
    if isinstance(want, dict):
        assert set(got) == set(want), "%s = %r, want %r" % (path, got, want)
        for k in want:
            _assert_type_strict_eq(got[k], want[k], "%s.%s" % (path, k))
    elif isinstance(want, list):
        assert len(got) == len(want), "%s = %r, want %r" % (path, got, want)
        for i, w in enumerate(want):
            _assert_type_strict_eq(got[i], w, "%s[%d]" % (path, i))
    else:
        assert got == want, "%s = %r, want %r" % (path, got, want)


def assert_subset(actual, expected, label):
    """expected 是欄位子集。型別也要嚴格比,且遞迴比到 dict/list 內部——
    match TS 那側的 toStrictEqual(它本來就是遞迴的)。"""
    for key, want in expected.items():
        assert key in actual, "%s: missing field %s" % (label, key)
        got = actual[key]
        _assert_type_strict_eq(got, want, "%s: field %s" % (label, key))

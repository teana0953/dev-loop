# 跨引擎 parity fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把只存在於 SDD ledger 的人工跨引擎 sweep 結論,變成 repo 內可執行的斷言,讓 Python 與 TypeScript 任一側漂移時測試變紅。

**Architecture:** `fixtures/parity/*.json` 同時持有 `input` 與 `expect`;pytest 與 vitest 各自讀同一個檔、餵給各自的實作、斷言同一張預期表。預期值以 Python 現行行為為準人工寫定。已裁決的刻意分歧用 `py`/`ts` 分區塊 + `divergence_reason` 表達。

**Tech Stack:** JSON fixtures;Python 3.10+ / pytest;TypeScript 6 / vitest。不新增任何依賴。

**Spec:** `docs/superpowers/specs/2026-07-31-parity-fixtures-design.md`

## Global Constraints

- **Python 行為為準。** 任何預期值若與直覺衝突,以 `plugins/dev-loop/devloop/` 現行實作為準。本 plan 內所有預期值都已對兩引擎實測驗證過;若實作與 plan 不符,**先停下來回報**,不要自行改預期值也不要改實作。
- **本 plan 不修改任何引擎實作。** 只新增 fixture 與測試。唯一例外是新增 TS 測試輔助模組 `plugins/dev-loop/src/parityFixture.ts`。
- **fixture 檔是兩引擎共用的單一真理。** 只改一側的預期值(或只讓一側跳過某 case)即為錯誤。
- pytest 從 repo 根跑:`make test`。vitest 從 `plugins/dev-loop/` 跑:`npm test`。兩者都必須綠。
- TS:ESM + NodeNext,**相對 import 必須帶 `.js` 副檔名**;`strict: true`;eslint 掃 `src`,**禁止 `any`**(用 `unknown` + 明確 cast)。
- **絕不手動複製任何東西進 `plugins/dev-loop/dist/`。** `npm test` 的 `pretest` 會自動 `build && bundle`。
- 工具用最新穩定版;不手寫版號。本 plan 不新增依賴,所以不會動到 `package.json`。

---

## File Structure

**新增:**

| 檔案 | 責任 |
|---|---|
| `fixtures/parity/README.md` | fixture 契約說明 + M2c 演變程序 |
| `fixtures/parity/followup.json` | `render_followup` / `renderFollowup` 逐字輸出 |
| `fixtures/parity/config.json` | `load_config` / `resolve_model` / `resolve_finish` / `validate_gate_cmds` |
| `fixtures/parity/changemeta.json` | `load_change_meta` / `is_serial` |
| `fixtures/parity/checkpoint.json` | `Checkpoint.load` + save/load round trip |
| `tests/conftest.py` | Python 側 fixture 讀取 + 子集比對 + 分歧解析 |
| `tests/test_parity_followup.py` | 消費 `followup.json` |
| `tests/test_parity_config.py` | 消費 `config.json` |
| `tests/test_parity_changemeta.py` | 消費 `changemeta.json` |
| `tests/test_parity_checkpoint.py` | 消費 `checkpoint.json` |
| `plugins/dev-loop/src/parityFixture.ts` | TS 側同上三件事(與 conftest.py 對稱) |
| `plugins/dev-loop/src/parity.followup.test.ts` | 消費 `followup.json` |
| `plugins/dev-loop/src/parity.config.test.ts` | 消費 `config.json` |
| `plugins/dev-loop/src/parity.changemeta.test.ts` | 消費 `changemeta.json` |
| `plugins/dev-loop/src/parity.checkpoint.test.ts` | 消費 `checkpoint.json` |

**不修改任何既有檔案。**(`fixtures/` 在 repo 根,pytest 從根跑、vitest 從 `plugins/dev-loop/` 跑,兩側都取得到。)

## Fixture 檔契約

每個 fixture 檔是一個物件,鍵 = section 名(對應一個被測函式),值 = case 陣列。

每個 case:
- `name`(必要,section 內唯一)—— 同時是 pytest / vitest 的 test id
- section 專屬的輸入欄位(見各 section)
- **恰好一種預期**:
  - `expect`:物件,**欄位子集**比對(只斷言列出的欄位)
  - `expect_throws: true`:必須拋錯(**不比對錯誤訊息文字**,兩語言例外文法本就不同)
- 純量回傳值一律包成 `{"value": ...}`,讓比對器只有一種。

**已裁決的刻意分歧**:case 不放 `expect`/`expect_throws`,改放:
```json
{"name": "...", "input": ..., "divergence_reason": "為什麼兩邊該不一樣",
 "py": {"expect": {...}}, "ts": {"expect_throws": true}}
```
`py`/`ts` 兩區塊各自帶 `expect` 或 `expect_throws`。`divergence_reason` 不得為空。

---

### Task 1: fixture 契約 + 兩側 loader + followup fixture

先用最單純的模組(`render_followup`,純函式、純字串)把機制打通並證明它不是空轉。

**Files:**
- Create: `fixtures/parity/README.md`
- Create: `fixtures/parity/followup.json`
- Create: `tests/conftest.py`
- Create: `tests/test_parity_followup.py`
- Create: `plugins/dev-loop/src/parityFixture.ts`
- Create: `plugins/dev-loop/src/parity.followup.test.ts`

**Interfaces:**
- Produces(Python,`tests/conftest.py`):
  - `parity_cases(module: str, section: str, expected_sections: list[str]) -> list` —— 回傳 `pytest.param` 清單,順帶守住「檔內每個 section 都有人消費」
  - `assert_subset(actual: dict, expected: dict, label: str) -> None`
  - `resolve_expectation(case: dict, engine: str) -> tuple[dict | None, bool]` —— 回傳 `(expect, expect_throws)`,engine 是 `"py"` 或 `"ts"`
- Produces(TS,`src/parityFixture.ts`):
  - `parityCases(module_: string, section: string, expectedSections: string[]): ParityCase[]`
  - `expectSubset(actual: Record<string, unknown>, expected: Record<string, unknown>, label: string): void`
  - `resolveExpectation(c: ParityCase): { expect: Record<string, unknown> | undefined; throws: boolean }`
  - `interface ParityCase`(見下方程式碼)
- Task 2/3/4 只消費這些,不再新增輔助函式。

- [ ] **Step 1: 寫 fixture 契約說明**

建立 `fixtures/parity/README.md`:

````markdown
# 跨引擎 parity fixtures

這裡的每個 JSON 檔同時被 **pytest**(`tests/test_parity_*.py`)與 **vitest**
(`plugins/dev-loop/src/parity.*.test.ts`)讀取。同一份輸入餵給 Python 與
TypeScript 兩個引擎,斷言同一張預期表。任一側漂移即變紅。

設計出處:`docs/superpowers/specs/2026-07-31-parity-fixtures-design.md`

## 檔案格式

檔案是一個物件,鍵 = section 名(對應一個被測函式),值 = case 陣列。

每個 case:

- `name` — section 內唯一,同時是兩側的 test id
- section 專屬的輸入欄位
- 恰好一種預期:
  - `expect` — 物件,**欄位子集**比對(只斷言列出的欄位)
  - `expect_throws: true` — 必須拋錯。**不比對錯誤訊息文字**(兩語言例外文法本就不同)
- 純量回傳值包成 `{"value": ...}`

## 已裁決的刻意分歧

兩引擎行為刻意不同時,case 改寫成:

```json
{"name": "...", "input": ...,
 "divergence_reason": "為什麼兩邊該不一樣",
 "py": {"expect": {"parallel_groups": {"a": 1}}},
 "ts": {"expect_throws": true}}
```

`divergence_reason` 不得為空。沒有裁決過的差異**不准**寫成分歧 —— 那是 bug,
應該修實作。

## 規則

- 預期值以 **Python 現行行為為準**人工寫定,不自動產生。
- fixture 是兩引擎共用的單一真理:只改一側的預期值,或只讓一側跳過某 case,
  即為錯誤。
- 檔內每個 section 都必須有人消費 —— 兩側的 loader 會斷言 section 名稱集合完全相符。

## M2c 之後(Python 刪除時)

刪 Python 的那次 commit 同步做三件事:

1. 移除 `tests/test_parity_*.py`(pytest 那半邊的消費者)
2. 目錄改名 `fixtures/parity/` → `fixtures/behavior/`
3. 清掉所有 `py` / `ts` / `divergence_reason` 欄位(分歧概念隨 Python 一起消失),
   把 `py` 區塊的內容扶正成 case 的 `expect`/`expect_throws`

之後這批檔案不再是 parity,而是 **TS 引擎的行為規格**。
````

- [ ] **Step 2: 寫 followup fixture**

建立 `fixtures/parity/followup.json`:

```json
{
  "renderFollowup": [
    {
      "name": "empty notes render nothing",
      "notes": [],
      "expect": { "value": "" }
    },
    {
      "name": "single note",
      "notes": ["fix flaky test"],
      "expect": { "value": "## Follow-up(non-blocking)\n\n- fix flaky test\n" }
    },
    {
      "name": "multiple notes each get their own bullet",
      "notes": ["a", "b"],
      "expect": { "value": "## Follow-up(non-blocking)\n\n- a\n- b\n" }
    },
    {
      "name": "embedded newline is not re-indented",
      "notes": ["line1\nline2"],
      "expect": { "value": "## Follow-up(non-blocking)\n\n- line1\nline2\n" }
    },
    {
      "name": "surrounding whitespace is preserved verbatim",
      "notes": ["  padded  "],
      "expect": { "value": "## Follow-up(non-blocking)\n\n-   padded  \n" }
    },
    {
      "name": "non-ascii note survives",
      "notes": ["中文 note"],
      "expect": { "value": "## Follow-up(non-blocking)\n\n- 中文 note\n" }
    }
  ]
}
```

注意 `"## Follow-up(non-blocking)"` 用的是**全形括號**,逐字照抄。

- [ ] **Step 3: 寫 Python 側 loader**

建立 `tests/conftest.py`:

```python
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


def assert_subset(actual, expected, label):
    """expected 是欄位子集。型別也要嚴格比——match TS 那側的 toStrictEqual。"""
    for key, want in expected.items():
        assert key in actual, "%s: missing field %s" % (label, key)
        got = actual[key]
        assert type(got) is type(want) and got == want, (
            "%s: field %s = %r, want %r" % (label, key, got, want)
        )
```

- [ ] **Step 4: 寫 Python 側 followup 測試**

建立 `tests/test_parity_followup.py`:

```python
import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.finish import render_followup

SECTIONS = ["renderFollowup"]


@pytest.mark.parametrize("case", parity_cases("followup", "renderFollowup", SECTIONS))
def test_render_followup_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            render_followup(case["notes"])
        return
    assert_subset({"value": render_followup(case["notes"])}, expect, case["name"])
```

- [ ] **Step 5: 跑 Python 側,確認全過**

Run: `make test`
Expected: PASS,`test_parity_followup.py` 出現 6 個 case。

- [ ] **Step 6: 寫 TS 側 loader**

建立 `plugins/dev-loop/src/parityFixture.ts`:

```typescript
/**
 * 跨引擎 parity fixture 的 TS 側 loader。
 *
 * fixtures/parity/*.json 同時被本檔與 tests/conftest.py 消費。兩側必須斷言
 * 同一張預期表——只改一側即為錯誤。契約見 fixtures/parity/README.md。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { expect } from "vitest";

// src/ -> plugins/dev-loop/ -> plugins/ -> repo root
const PARITY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/parity");

export interface Expectation {
  expect?: Record<string, unknown>;
  expect_throws?: boolean;
}

export interface ParityCase extends Expectation {
  name: string;
  divergence_reason?: string;
  py?: Expectation;
  ts?: Expectation;
  [key: string]: unknown;
}

/**
 * 取 <module>.json 的一個 section。順帶守住「檔內每個 section 都有人消費」
 * ——加了 section 卻沒人讀,會靜默通過,fixture 就變成裝飾品。
 */
export function parityCases(
  module_: string,
  section: string,
  expectedSections: string[],
): ParityCase[] {
  const raw: unknown = JSON.parse(readFileSync(join(PARITY_DIR, `${module_}.json`), "utf-8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${module_}.json root must be an object`);
  }
  const data = raw as Record<string, ParityCase[]>;
  expect(Object.keys(data).sort(), `${module_}.json sections`).toEqual([...expectedSections].sort());
  const cases = data[section];
  expect(cases.length, `${module_}.json section ${section}`).toBeGreaterThan(0);
  const names = cases.map((c) => c.name);
  expect(new Set(names).size, `${module_}/${section} duplicate case names`).toBe(names.length);
  return cases;
}

/** 把 case 攤成 { expect, throws }。分歧 case 取 TS 那份區塊。 */
export function resolveExpectation(c: ParityCase): {
  expect: Record<string, unknown> | undefined;
  throws: boolean;
} {
  let block: Expectation = c;
  if (c.divergence_reason !== undefined) {
    expect(c.divergence_reason.trim(), "divergence_reason must be non-empty").not.toBe("");
    if (c.py === undefined || c.ts === undefined) {
      throw new Error(`case ${c.name}: divergence case needs both py and ts blocks`);
    }
    if (c.expect !== undefined || c.expect_throws !== undefined) {
      throw new Error(`case ${c.name}: divergence case must not also carry a top-level expectation`);
    }
    block = c.ts;
  }
  const throws = block.expect_throws === true;
  if ((block.expect === undefined) === !throws) {
    throw new Error(`case ${c.name} must have exactly one of expect / expect_throws`);
  }
  return { expect: block.expect, throws };
}

/** expected 是欄位子集;用 toStrictEqual,false 與 0 不得互通。 */
export function expectSubset(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  label: string,
): void {
  for (const [key, want] of Object.entries(expected)) {
    expect(Object.prototype.hasOwnProperty.call(actual, key), `${label}: missing field ${key}`).toBe(true);
    expect(actual[key], `${label}: field ${key}`).toStrictEqual(want);
  }
}
```

- [ ] **Step 7: 寫 TS 側 followup 測試**

建立 `plugins/dev-loop/src/parity.followup.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { renderFollowup } from "./finish.js";

const SECTIONS = ["renderFollowup"];

describe("parity: renderFollowup", () => {
  for (const c of parityCases("followup", "renderFollowup", SECTIONS)) {
    it(c.name, () => {
      const notes = c.notes as string[];
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => renderFollowup(notes)).toThrow();
        return;
      }
      expectSubset({ value: renderFollowup(notes) }, want!, c.name);
    });
  }
});
```

- [ ] **Step 8: 跑 TS 側,確認全過 + lint 過**

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS,`parity.followup.test.ts` 出現 6 個 case;eslint 無錯。

- [ ] **Step 9: 證明這套 harness 不是空轉**

暫時把 `fixtures/parity/followup.json` 裡 `"single note"` 的預期值改成
`"## Follow-up(non-blocking)\n\n- WRONG\n"`,兩側各跑一次:

Run: `make test`
Expected: FAIL,訊息含 `single note: field value`

Run(在 `plugins/dev-loop/`):`npm test`
Expected: FAIL,訊息含 `single note: field value`

確認兩側都紅之後,把預期值改回 `"## Follow-up(non-blocking)\n\n- fix flaky test\n"`,重跑兩側確認回綠。

- [ ] **Step 10: Commit**

```bash
git add fixtures/parity tests/conftest.py tests/test_parity_followup.py \
        plugins/dev-loop/src/parityFixture.ts plugins/dev-loop/src/parity.followup.test.ts
git commit -m "test: shared parity fixture harness, proven on renderFollowup

Cross-engine agreement so far lived only in SDD ledger prose; nothing in
the repo went red when Python and TypeScript drifted. Add a fixture format
holding input+expect, consumed by pytest and vitest alike, and land the
first module on it. Verified non-vacuous by corrupting one expected value
and watching both suites fail."
```

---

### Task 2: config fixture

`load_config` 是 M2a 真實缺陷(`??` 誤當 `dict.get`)的發生地,**缺欄位 vs 顯式 null** 是這個 fixture 的重點。

**Files:**
- Create: `fixtures/parity/config.json`
- Create: `tests/test_parity_config.py`
- Create: `plugins/dev-loop/src/parity.config.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `parity_cases` / `resolve_expectation` / `assert_subset`(Python)與 `parityCases` / `resolveExpectation` / `expectSubset`(TS)
- Produces: 無(葉節點)

**Section 與輸入欄位:**

| section | 輸入欄位 |
|---|---|
| `loadConfig` | `input`(要寫進檔案的 JSON) 或 `file_absent: true` |
| `resolveModel` | `config`(config 檔的 JSON)、`stage` |
| `resolveFinish` | `config_finish`、`meta_finish`(皆為純量或 null) |
| `validateGateCmds` | `input` |

`file_absent: true` 與 `input: null` 是兩個不同的 case ——後者是「檔案存在,root 是 JSON null」。

- [ ] **Step 1: 寫 config fixture**

建立 `fixtures/parity/config.json`:

```json
{
  "loadConfig": [
    {
      "name": "missing file yields all defaults",
      "file_absent": true,
      "expect": {
        "finish": null, "auto_arm": true, "gate_cmds": [], "superpowers": null,
        "auto_approve": false, "model_profile": null, "models": {}
      }
    },
    {
      "name": "empty object yields all defaults",
      "input": {},
      "expect": {
        "finish": null, "auto_arm": true, "gate_cmds": [], "superpowers": null,
        "auto_approve": false, "model_profile": null, "models": {}
      }
    },
    {
      "name": "fully populated file round-trips every field",
      "input": {
        "finish": "pr", "auto_arm": false, "gate_cmds": ["pytest -q", "ruff check ."],
        "superpowers": true, "auto_approve": true, "model_profile": "budget",
        "models": { "apply": "opus", "fix": "haiku" }
      },
      "expect": {
        "finish": "pr", "auto_arm": false, "gate_cmds": ["pytest -q", "ruff check ."],
        "superpowers": true, "auto_approve": true, "model_profile": "budget",
        "models": { "apply": "opus", "fix": "haiku" }
      }
    },
    {
      "name": "explicit null auto_arm disables the watcher",
      "input": { "auto_arm": null },
      "expect": { "auto_arm": false }
    },
    {
      "name": "auto_arm 0 is falsy",
      "input": { "auto_arm": 0 },
      "expect": { "auto_arm": false }
    },
    {
      "name": "auto_arm non-empty string is truthy",
      "input": { "auto_arm": "no" },
      "expect": { "auto_arm": true }
    },
    {
      "name": "explicit null gate_cmds survives as null for downstream validation",
      "input": { "gate_cmds": null },
      "expect": { "gate_cmds": null }
    },
    {
      "name": "explicit null model_profile is the same as absent",
      "input": { "model_profile": null },
      "expect": { "model_profile": null }
    },
    {
      "name": "explicit null models is rejected",
      "input": { "models": null },
      "expect_throws": true
    },
    {
      "name": "models as a list is rejected",
      "input": { "models": [] },
      "expect_throws": true
    },
    {
      "name": "unknown model stage is rejected",
      "input": { "models": { "gate": "sonnet" } },
      "expect_throws": true
    },
    {
      "name": "full model id instead of an alias is rejected",
      "input": { "models": { "apply": "claude-sonnet-5" } },
      "expect_throws": true
    },
    {
      "name": "unknown model_profile is rejected",
      "input": { "model_profile": "cheap" },
      "expect_throws": true
    },
    {
      "name": "non-boolean superpowers passes through unchanged",
      "input": { "superpowers": "yes" },
      "expect": { "superpowers": "yes" }
    },
    {
      "name": "superpowers false stays false",
      "input": { "superpowers": false },
      "expect": { "superpowers": false }
    },
    {
      "name": "auto_approve 1 is not true",
      "input": { "auto_approve": 1 },
      "expect": { "auto_approve": false }
    },
    {
      "name": "auto_approve string true is not true",
      "input": { "auto_approve": "true" },
      "expect": { "auto_approve": false }
    },
    {
      "name": "auto_approve only honours JSON true",
      "input": { "auto_approve": true },
      "expect": { "auto_approve": true }
    },
    {
      "name": "array root is rejected",
      "input": [1, 2, 3],
      "expect_throws": true
    },
    {
      "name": "null root is rejected",
      "input": null,
      "expect_throws": true
    }
  ],

  "resolveModel": [
    {
      "name": "budget leaves brainstorm inheriting",
      "config": { "model_profile": "budget" }, "stage": "brainstorm",
      "expect": { "value": null }
    },
    {
      "name": "budget routes apply to sonnet",
      "config": { "model_profile": "budget" }, "stage": "apply",
      "expect": { "value": "sonnet" }
    },
    {
      "name": "budget leaves review inheriting",
      "config": { "model_profile": "budget" }, "stage": "review",
      "expect": { "value": null }
    },
    {
      "name": "budget routes fix to sonnet",
      "config": { "model_profile": "budget" }, "stage": "fix",
      "expect": { "value": "sonnet" }
    },
    {
      "name": "explicit models override beats the budget route",
      "config": { "model_profile": "budget", "models": { "apply": "opus" } }, "stage": "apply",
      "expect": { "value": "opus" }
    },
    {
      "name": "no profile means inherit",
      "config": {}, "stage": "apply",
      "expect": { "value": null }
    },
    {
      "name": "quality profile means inherit everywhere",
      "config": { "model_profile": "quality" }, "stage": "fix",
      "expect": { "value": null }
    },
    {
      "name": "explicit models override works without any profile",
      "config": { "models": { "review": "opus" } }, "stage": "review",
      "expect": { "value": "opus" }
    },
    {
      "name": "unknown stage is a caller bug and throws",
      "config": {}, "stage": "gate",
      "expect_throws": true
    }
  ],

  "resolveFinish": [
    {
      "name": "neither set falls back to ask",
      "config_finish": null, "meta_finish": null,
      "expect": { "value": "ask" }
    },
    {
      "name": "meta overrides config",
      "config_finish": "merge", "meta_finish": "pr",
      "expect": { "value": "pr" }
    },
    {
      "name": "config alone is used",
      "config_finish": "merge", "meta_finish": null,
      "expect": { "value": "merge" }
    },
    {
      "name": "explicit ask in meta is honoured",
      "config_finish": "merge", "meta_finish": "ask",
      "expect": { "value": "ask" }
    },
    {
      "name": "invalid config value throws even when meta would win",
      "config_finish": "MERGE", "meta_finish": "pr",
      "expect_throws": true
    },
    {
      "name": "invalid meta value throws",
      "config_finish": null, "meta_finish": "squash",
      "expect_throws": true
    }
  ],

  "validateGateCmds": [
    {
      "name": "list of non-empty strings passes through",
      "input": ["pytest -q", "ruff check ."],
      "expect": { "value": ["pytest -q", "ruff check ."] }
    },
    {
      "name": "empty list is valid",
      "input": [],
      "expect": { "value": [] }
    },
    {
      "name": "whitespace-only command is rejected",
      "input": ["   "],
      "expect_throws": true
    },
    {
      "name": "empty string command is rejected",
      "input": [""],
      "expect_throws": true
    },
    {
      "name": "non-string element is rejected",
      "input": [1],
      "expect_throws": true
    },
    {
      "name": "bare string instead of a list is rejected",
      "input": "pytest -q",
      "expect_throws": true
    },
    {
      "name": "null is rejected",
      "input": null,
      "expect_throws": true
    }
  ]
}
```

- [ ] **Step 2: 寫 Python 側 config 測試**

建立 `tests/test_parity_config.py`:

```python
import json
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.changemeta import ChangeMeta
from devloop.config import (
    Config, load_config, resolve_finish, resolve_model, validate_gate_cmds,
)

SECTIONS = ["loadConfig", "resolveModel", "resolveFinish", "validateGateCmds"]


def _write(tmp_path, payload):
    p = tmp_path / "config.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("config", "loadConfig", SECTIONS))
def test_load_config_parity(case, tmp_path):
    if case.get("file_absent"):
        path = tmp_path / "absent.json"
    else:
        path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            load_config(path)
        return
    assert_subset(asdict(load_config(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "resolveModel", SECTIONS))
def test_resolve_model_parity(case, tmp_path):
    cfg = load_config(_write(tmp_path, case["config"]))
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            resolve_model(case["stage"], cfg)
        return
    assert_subset({"value": resolve_model(case["stage"], cfg)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "resolveFinish", SECTIONS))
def test_resolve_finish_parity(case):
    cfg = Config(finish=case["config_finish"])
    meta = ChangeMeta(finish=case["meta_finish"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            resolve_finish(cfg, meta)
        return
    assert_subset({"value": resolve_finish(cfg, meta)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("config", "validateGateCmds", SECTIONS))
def test_validate_gate_cmds_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            validate_gate_cmds(case["input"])
        return
    assert_subset({"value": validate_gate_cmds(case["input"])}, expect, case["name"])
```

- [ ] **Step 3: 跑 Python 側**

Run: `make test`
Expected: PASS(config parity 共 42 個 case)

- [ ] **Step 4: 寫 TS 側 config 測試**

建立 `plugins/dev-loop/src/parity.config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import {
  loadConfig, resolveModel, resolveFinish, validateGateCmds, type Config,
} from "./config.js";

const SECTIONS = ["loadConfig", "resolveModel", "resolveFinish", "validateGateCmds"];

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "config.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

function absentPath(): string {
  return join(mkdtempSync(join(tmpdir(), "parity-")), "absent.json");
}

describe("parity: loadConfig", () => {
  for (const c of parityCases("config", "loadConfig", SECTIONS)) {
    it(c.name, () => {
      const path = c.file_absent === true ? absentPath() : write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadConfig(path)).toThrow();
        return;
      }
      expectSubset(loadConfig(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

function configOf(c: ParityCase): Config {
  return loadConfig(write(c.config));
}

describe("parity: resolveModel", () => {
  for (const c of parityCases("config", "resolveModel", SECTIONS)) {
    it(c.name, () => {
      const stage = c.stage as string;
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => resolveModel(stage, configOf(c))).toThrow();
        return;
      }
      expectSubset({ value: resolveModel(stage, configOf(c)) }, want!, c.name);
    });
  }
});

describe("parity: resolveFinish", () => {
  for (const c of parityCases("config", "resolveFinish", SECTIONS)) {
    it(c.name, () => {
      const cfg = loadConfig(write({ finish: c.config_finish }));
      const meta = { finish: c.meta_finish as string | null };
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => resolveFinish(cfg, meta)).toThrow();
        return;
      }
      expectSubset({ value: resolveFinish(cfg, meta) }, want!, c.name);
    });
  }
});

describe("parity: validateGateCmds", () => {
  for (const c of parityCases("config", "validateGateCmds", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => validateGateCmds(c.input)).toThrow();
        return;
      }
      expectSubset({ value: validateGateCmds(c.input) }, want!, c.name);
    });
  }
});
```

注意 `resolveFinish` 的 TS 側刻意走 `loadConfig(write({finish: ...}))` 而非手捏物件
——這樣兩側都是「從檔案載入的 Config」,少一個手寫預設值走鐘的機會。

- [ ] **Step 5: 跑 TS 側 + lint**

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: 驗證非空轉**

暫時把 `"explicit null auto_arm disables the watcher"` 的 `expect` 改成
`{"auto_arm": true}`,兩側各跑一次:

Run: `make test` — Expected: FAIL,訊息含 `field auto_arm`
Run(在 `plugins/dev-loop/`):`npm test` — Expected: FAIL,訊息含 `field auto_arm`

改回 `false`,重跑兩側確認回綠。

- [ ] **Step 7: Commit**

```bash
git add fixtures/parity/config.json tests/test_parity_config.py \
        plugins/dev-loop/src/parity.config.test.ts
git commit -m "test: parity fixture for config loading and resolution

Pins the absent-key vs explicit-null distinction that produced M2a's
watcher-state divergence, plus model/finish/gate_cmds resolution across
both engines."
```

---

### Task 3: change-meta fixture(含已裁決分歧)

`parallel_groups` 決定序列 vs 平行分支,是本 fixture 唯一有**已裁決刻意分歧**的地方:TS 在載入時就驗證是不是 list,Python 放行到 `is_serial` 才炸(或不炸)。

**Files:**
- Create: `fixtures/parity/changemeta.json`
- Create: `tests/test_parity_changemeta.py`
- Create: `plugins/dev-loop/src/parity.changemeta.test.ts`

**Interfaces:**
- Consumes: Task 1 的 loader 三件套
- Produces: 無

**Section 與輸入欄位:**

| section | 輸入欄位 |
|---|---|
| `loadChangeMeta` | `input` 或 `file_absent: true` |
| `isSerial` | `input`(先 load 再 `is_serial`) |

- [ ] **Step 1: 寫 changemeta fixture**

建立 `fixtures/parity/changemeta.json`:

```json
{
  "loadChangeMeta": [
    {
      "name": "missing file yields all defaults",
      "file_absent": true,
      "expect": { "parallel_groups": [], "needs_uiux": false, "finish": null, "flow_profile": null }
    },
    {
      "name": "empty object yields all defaults",
      "input": {},
      "expect": { "parallel_groups": [], "needs_uiux": false, "finish": null, "flow_profile": null }
    },
    {
      "name": "fully populated file round-trips every field",
      "input": {
        "parallel_groups": [["a"], ["b"]], "needs_uiux": true,
        "finish": "pr", "flow_profile": "light"
      },
      "expect": {
        "parallel_groups": [["a"], ["b"]], "needs_uiux": true,
        "finish": "pr", "flow_profile": "light"
      }
    },
    {
      "name": "flow_profile full is accepted",
      "input": { "flow_profile": "full" },
      "expect": { "flow_profile": "full" }
    },
    {
      "name": "explicit null flow_profile is the same as absent",
      "input": { "flow_profile": null },
      "expect": { "flow_profile": null }
    },
    {
      "name": "unknown flow_profile is rejected at load time",
      "input": { "flow_profile": "fast" },
      "expect_throws": true
    },
    {
      "name": "explicit null needs_uiux is not coerced to false",
      "input": { "needs_uiux": null },
      "expect": { "needs_uiux": null }
    },
    {
      "name": "non-boolean needs_uiux passes through unchanged",
      "input": { "needs_uiux": [] },
      "expect": { "needs_uiux": [] }
    },
    {
      "name": "array root is rejected",
      "input": [],
      "expect_throws": true
    },
    {
      "name": "parallel_groups as an object",
      "input": { "parallel_groups": { "a": 1 } },
      "divergence_reason": "TS 在載入時就驗 parallel_groups 是不是 list(裁決:壞設定要在 start 就炸,不能等到 apply 分支才發現);Python 放行,非 list 值要到 is_serial 的 len() 才可能出事,而 dict 剛好有 len(),於是靜默選了序列分支。",
      "py": { "expect": { "parallel_groups": { "a": 1 } } },
      "ts": { "expect_throws": true }
    },
    {
      "name": "parallel_groups explicitly null",
      "input": { "parallel_groups": null },
      "divergence_reason": "同上:TS 載入即拒;Python 放行,要到 is_serial 才 TypeError。兩邊最終都會炸,但炸的時機不同。",
      "py": { "expect": { "parallel_groups": null } },
      "ts": { "expect_throws": true }
    },
    {
      "name": "parallel_groups as a number",
      "input": { "parallel_groups": 3 },
      "divergence_reason": "同上:TS 載入即拒;Python 放行,要到 is_serial 才 TypeError。",
      "py": { "expect": { "parallel_groups": 3 } },
      "ts": { "expect_throws": true }
    }
  ],

  "isSerial": [
    {
      "name": "missing parallel_groups is serial",
      "input": {},
      "expect": { "value": true }
    },
    {
      "name": "empty parallel_groups is serial",
      "input": { "parallel_groups": [] },
      "expect": { "value": true }
    },
    {
      "name": "one group is serial",
      "input": { "parallel_groups": [["a"]] },
      "expect": { "value": true }
    },
    {
      "name": "two groups are parallel",
      "input": { "parallel_groups": [["a"], ["b"]] },
      "expect": { "value": false }
    },
    {
      "name": "three groups are parallel",
      "input": { "parallel_groups": [["a"], ["b"], ["c"]] },
      "expect": { "value": false }
    },
    {
      "name": "null parallel_groups blows up on both engines",
      "input": { "parallel_groups": null },
      "expect_throws": true
    },
    {
      "name": "numeric parallel_groups blows up on both engines",
      "input": { "parallel_groups": 3 },
      "expect_throws": true
    },
    {
      "name": "object parallel_groups",
      "input": { "parallel_groups": { "a": 1 } },
      "divergence_reason": "Python 的 len(dict) 是 1,於是靜默判成序列;TS 在 loadChangeMeta 就拒收,根本走不到 isSerial。這正是 TS 較嚴格的理由——一個手滑寫成物件的設定,在 Python 下會安靜地取消平行執行。",
      "py": { "expect": { "value": true } },
      "ts": { "expect_throws": true }
    }
  ]
}
```

`isSerial` 的 null / number 兩個 case **不是**分歧:兩引擎都拋錯,只是拋的位置不同
(Python 在 `is_serial`,TS 在 `load_change_meta`),而測試把 load + is_serial 包在同一個
`expect_throws` 斷言裡,所以兩邊都紅得一致。物件那個 case 才是真分歧——Python 不拋、
還回了一個具體答案。

- [ ] **Step 2: 寫 Python 側 changemeta 測試**

建立 `tests/test_parity_changemeta.py`:

```python
import json
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.changemeta import is_serial, load_change_meta

SECTIONS = ["loadChangeMeta", "isSerial"]


def _write(tmp_path, payload):
    p = tmp_path / "change-meta.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("changemeta", "loadChangeMeta", SECTIONS))
def test_load_change_meta_parity(case, tmp_path):
    if case.get("file_absent"):
        path = tmp_path / "absent.json"
    else:
        path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            load_change_meta(path)
        return
    assert_subset(asdict(load_change_meta(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("changemeta", "isSerial", SECTIONS))
def test_is_serial_parity(case, tmp_path):
    path = _write(tmp_path, case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        # load 或 is_serial 任一步拋錯都算——兩引擎驗證時機不同,
        # 但「這份設定不能安靜地選一條分支」的保證相同。
        with pytest.raises(Exception):
            is_serial(load_change_meta(path))
        return
    assert_subset({"value": is_serial(load_change_meta(path))}, expect, case["name"])
```

- [ ] **Step 3: 跑 Python 側**

Run: `make test`
Expected: PASS(changemeta parity 共 20 個 case)

- [ ] **Step 4: 寫 TS 側 changemeta 測試**

建立 `plugins/dev-loop/src/parity.changemeta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { loadChangeMeta, isSerial } from "./changemeta.js";

const SECTIONS = ["loadChangeMeta", "isSerial"];

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "change-meta.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

describe("parity: loadChangeMeta", () => {
  for (const c of parityCases("changemeta", "loadChangeMeta", SECTIONS)) {
    it(c.name, () => {
      const path = c.file_absent === true
        ? join(mkdtempSync(join(tmpdir(), "parity-")), "absent.json")
        : write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadChangeMeta(path)).toThrow();
        return;
      }
      expectSubset(loadChangeMeta(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

describe("parity: isSerial", () => {
  for (const c of parityCases("changemeta", "isSerial", SECTIONS)) {
    it(c.name, () => {
      const path = write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        // load 或 isSerial 任一步拋錯都算——兩引擎驗證時機不同,
        // 但「這份設定不能安靜地選一條分支」的保證相同。
        expect(() => isSerial(loadChangeMeta(path))).toThrow();
        return;
      }
      expectSubset({ value: isSerial(loadChangeMeta(path)) }, want!, c.name);
    });
  }
});
```

- [ ] **Step 5: 跑 TS 側 + lint**

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: 驗證分歧機制真的兩邊各走各的**

暫時把 `loadChangeMeta` 的 `"parallel_groups as an object"` 這個 case 的
`"ts"` 區塊改成 `{"expect": {"parallel_groups": {"a": 1}}}`(即宣稱 TS 也不拋):

Run(在 `plugins/dev-loop/`):`npm test`
Expected: FAIL(TS 實際會拋)

Run: `make test`
Expected: **PASS**(Python 那半邊沒被動到)

這證明 `py`/`ts` 兩區塊確實各自生效、沒有互相汙染。改回 `{"expect_throws": true}`,
重跑兩側確認回綠。

- [ ] **Step 7: Commit**

```bash
git add fixtures/parity/changemeta.json tests/test_parity_changemeta.py \
        plugins/dev-loop/src/parity.changemeta.test.ts
git commit -m "test: parity fixture for change metadata

Records the one ruled divergence in this module: TS validates
parallel_groups at load time, Python lets a non-list through until
is_serial, where a dict silently reports serial. Both engines assert the
same table; the divergence carries its rationale in-band."
```

---

### Task 4: checkpoint fixture(載入 + round trip)

checkpoint 是雙軌交接真正會交換的檔——這是四個 fixture 裡最貼近「實際混合引擎續跑」的一個。

**Files:**
- Create: `fixtures/parity/checkpoint.json`
- Create: `tests/test_parity_checkpoint.py`
- Create: `plugins/dev-loop/src/parity.checkpoint.test.ts`

**Interfaces:**
- Consumes: Task 1 的 loader 三件套
- Produces: 無

**Section 與輸入欄位:**

| section | 輸入欄位 |
|---|---|
| `loadCheckpoint` | `input`(磁碟上的 checkpoint JSON) |
| `roundTrip` | `input`;流程是 load → save 到新路徑 → 再 load,`expect` 比對重載後的欄位 |

`updated_at` 在 `roundTrip` **不列入 `expect`** —— 兩引擎的時間戳文法不同
(Python 微秒 `+00:00`、TS 毫秒 `Z`),是已知的延後項。測試改為斷言它非空且以
`YYYY-MM-DDTHH:MM:SS` 開頭,這部分是兩邊都成立的共同保證。

- [ ] **Step 1: 寫 checkpoint fixture**

建立 `fixtures/parity/checkpoint.json`:

```json
{
  "loadCheckpoint": [
    {
      "name": "minimal checkpoint fills every default",
      "input": { "phase": "apply", "change_id": "add-csv-export", "branch": "feat/csv" },
      "expect": {
        "phase": "apply", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 0, "last_artifact": "", "non_blocking": [], "updated_at": "",
        "resume_exec": null, "units": [], "review_legs": [], "propose_attempts": 0,
        "gate_failures": 0, "finish_mode": null, "flow_profile": "full", "needs_uiux": false
      }
    },
    {
      "name": "fully populated checkpoint round-trips every field",
      "input": {
        "phase": "review", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 3, "last_artifact": "docs/review.md", "non_blocking": ["tidy imports"],
        "updated_at": "2026-07-31T00:00:00+00:00", "resume_exec": "gate",
        "units": [{ "id": "u1", "status": "done" }], "review_legs": ["security"],
        "propose_attempts": 2, "gate_failures": 1, "finish_mode": "pr",
        "flow_profile": "light", "needs_uiux": true
      },
      "expect": {
        "phase": "review", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 3, "last_artifact": "docs/review.md", "non_blocking": ["tidy imports"],
        "updated_at": "2026-07-31T00:00:00+00:00", "resume_exec": "gate",
        "units": [{ "id": "u1", "status": "done" }], "review_legs": ["security"],
        "propose_attempts": 2, "gate_failures": 1, "finish_mode": "pr",
        "flow_profile": "light", "needs_uiux": true
      }
    },
    {
      "name": "unknown key is rejected",
      "input": { "phase": "apply", "change_id": "c", "branch": "b", "bogus": 1 },
      "expect_throws": true
    },
    {
      "name": "missing branch is rejected",
      "input": { "phase": "apply", "change_id": "c" },
      "expect_throws": true
    },
    {
      "name": "missing phase is rejected",
      "input": { "change_id": "c", "branch": "b" },
      "expect_throws": true
    },
    {
      "name": "missing change_id is rejected",
      "input": { "phase": "apply", "branch": "b" },
      "expect_throws": true
    },
    {
      "name": "array root is rejected",
      "input": [],
      "expect_throws": true
    },
    {
      "name": "phase value is deliberately not validated at load time",
      "input": { "phase": "nope", "change_id": "c", "branch": "b" },
      "expect": { "phase": "nope" }
    },
    {
      "name": "iteration type is deliberately not validated at load time",
      "input": { "phase": "apply", "change_id": "c", "branch": "b", "iteration": "3" },
      "expect": { "iteration": "3" }
    },
    {
      "name": "non-ascii change_id and branch survive",
      "input": { "phase": "apply", "change_id": "加匯出", "branch": "feat/匯出" },
      "expect": { "change_id": "加匯出", "branch": "feat/匯出" }
    }
  ],

  "roundTrip": [
    {
      "name": "minimal checkpoint survives save and reload",
      "input": { "phase": "apply", "change_id": "add-csv-export", "branch": "feat/csv" },
      "expect": {
        "phase": "apply", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 0, "last_artifact": "", "non_blocking": [],
        "resume_exec": null, "units": [], "review_legs": [], "propose_attempts": 0,
        "gate_failures": 0, "finish_mode": null, "flow_profile": "full", "needs_uiux": false
      }
    },
    {
      "name": "fully populated checkpoint survives save and reload",
      "input": {
        "phase": "review", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 3, "last_artifact": "docs/review.md", "non_blocking": ["tidy imports"],
        "updated_at": "2026-07-31T00:00:00+00:00", "resume_exec": "gate",
        "units": [{ "id": "u1", "status": "done" }], "review_legs": ["security"],
        "propose_attempts": 2, "gate_failures": 1, "finish_mode": "pr",
        "flow_profile": "light", "needs_uiux": true
      },
      "expect": {
        "phase": "review", "change_id": "add-csv-export", "branch": "feat/csv",
        "iteration": 3, "last_artifact": "docs/review.md", "non_blocking": ["tidy imports"],
        "resume_exec": "gate", "units": [{ "id": "u1", "status": "done" }],
        "review_legs": ["security"], "propose_attempts": 2, "gate_failures": 1,
        "finish_mode": "pr", "flow_profile": "light", "needs_uiux": true
      }
    },
    {
      "name": "non-ascii fields survive save and reload",
      "input": { "phase": "apply", "change_id": "加匯出", "branch": "feat/匯出" },
      "expect": { "change_id": "加匯出", "branch": "feat/匯出" }
    }
  ]
}
```

`roundTrip` 的 `expect` 一律不含 `updated_at`(save 會覆寫它,而文法兩引擎不同)。

- [ ] **Step 2: 寫 Python 側 checkpoint 測試**

建立 `tests/test_parity_checkpoint.py`:

```python
import json
import re
from dataclasses import asdict

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.checkpoint import Checkpoint

SECTIONS = ["loadCheckpoint", "roundTrip"]

# 兩引擎共通的時間戳保證(小數位與時區後綴的文法差異是已知延後項,不在此斷言)
TS_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return p


@pytest.mark.parametrize("case", parity_cases("checkpoint", "loadCheckpoint", SECTIONS))
def test_load_checkpoint_parity(case, tmp_path):
    path = _write(tmp_path, "checkpoint.json", case["input"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            Checkpoint.load(path)
        return
    assert_subset(asdict(Checkpoint.load(path)), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("checkpoint", "roundTrip", SECTIONS))
def test_checkpoint_round_trip_parity(case, tmp_path):
    src = _write(tmp_path, "checkpoint.json", case["input"])
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "roundTrip cases must not expect a throw"
    cp = Checkpoint.load(src)
    dst = tmp_path / "nested" / "reloaded.json"
    cp.save(dst)
    reloaded = Checkpoint.load(dst)
    assert_subset(asdict(reloaded), expect, case["name"])
    # save 一定重寫 updated_at;文法差異是延後項,只斷言兩邊共通的部分
    assert TS_PREFIX.match(reloaded.updated_at), (
        "%s: updated_at = %r" % (case["name"], reloaded.updated_at)
    )
```

`dst` 刻意放在一層還不存在的子目錄下,順便驗 `save` 會自己建目錄。

- [ ] **Step 3: 跑 Python 側**

Run: `make test`
Expected: PASS(checkpoint parity 共 13 個 case)

- [ ] **Step 4: 寫 TS 側 checkpoint 測試**

建立 `plugins/dev-loop/src/parity.checkpoint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint.js";

const SECTIONS = ["loadCheckpoint", "roundTrip"];

// 兩引擎共通的時間戳保證(小數位與時區後綴的文法差異是已知延後項,不在此斷言)
const TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function write(payload: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "parity-")), "checkpoint.json");
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

describe("parity: loadCheckpoint", () => {
  for (const c of parityCases("checkpoint", "loadCheckpoint", SECTIONS)) {
    it(c.name, () => {
      const path = write(c.input);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => loadCheckpoint(path)).toThrow();
        return;
      }
      expectSubset(loadCheckpoint(path) as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

describe("parity: checkpoint round trip", () => {
  for (const c of parityCases("checkpoint", "roundTrip", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "roundTrip cases must not expect a throw").toBe(false);
      const cp = loadCheckpoint(write(c.input));
      // dst 刻意放在一層還不存在的子目錄下,順便驗 saveCheckpoint 會自己建目錄
      const dst = join(mkdtempSync(join(tmpdir(), "parity-")), "nested", "reloaded.json");
      saveCheckpoint(cp, dst);
      const reloaded = loadCheckpoint(dst);
      expectSubset(reloaded as unknown as Record<string, unknown>, want!, c.name);
      // save 一定重寫 updated_at;文法差異是延後項,只斷言兩邊共通的部分
      expect(TS_PREFIX.test(reloaded.updated_at), `${c.name}: updated_at = ${reloaded.updated_at}`).toBe(true);
    });
  }
});
```

- [ ] **Step 5: 跑 TS 側 + lint**

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: 驗證非空轉**

暫時把 `loadCheckpoint` 的 `"minimal checkpoint fills every default"` 裡
`"flow_profile": "full"` 改成 `"light"`,兩側各跑一次:

Run: `make test` — Expected: FAIL,訊息含 `field flow_profile`
Run(在 `plugins/dev-loop/`):`npm test` — Expected: FAIL,訊息含 `field flow_profile`

改回 `"full"`,重跑兩側確認回綠。

- [ ] **Step 7: 全套跑一次 + 確認 dist 沒有莫名其妙變動**

Run: `make test`
Expected: PASS

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS

Run(在 repo 根):`git status --porcelain plugins/dev-loop/dist`
Expected: **無輸出**。本 plan 完全沒動 `src/` 裡任何進 bundle 的程式(`parityFixture.ts`
只被測試 import,不在 `cli.ts` 的相依樹上),所以 `dist/cli.js` 不該有任何變化。
若有變化,**停下來回報**,不要 commit。

- [ ] **Step 8: Commit**

```bash
git add fixtures/parity/checkpoint.json tests/test_parity_checkpoint.py \
        plugins/dev-loop/src/parity.checkpoint.test.ts
git commit -m "test: parity fixture for checkpoint load and round trip

Checkpoints are the file the two engines actually hand back and forth
during the dual-track migration, so this fixture drives the real path:
on-disk JSON in, load, save, reload, compare. The timestamp grammar
divergence stays out of the expectation table and is asserted only down
to the shared second-precision prefix."
```

---

## Self-Review

**1. Spec coverage**

| Spec 要求 | 對應 |
|---|---|
| 共用 fixture,兩側各自斷言同一預期表 | Task 1 Step 3 / Step 6 的 loader |
| `fixtures/parity/` 放 repo 根 | Task 1(`PARITY_DIR` 兩側都指向根) |
| `expect` 是欄位子集 | `assert_subset` / `expectSubset` |
| `expect_throws` 只比對有無拋錯 | 兩側都用裸 `Exception` / `toThrow()` |
| 已裁決分歧用 `expect_py`/`expect_ts` + `divergence_reason` | 實作為 `py`/`ts` 兩個區塊(語意相同,巢狀比平坦欄位更難寫錯——區塊內強制恰好一種預期);`divergence_reason` 保持原名 |
| 已知延後分歧不假綠 | checkpoint 的 `updated_at` 不列入 `expect`,改斷言共通前綴;規格原本提的 `known_divergence` 標記在只有這一處的情況下沒必要,直接在測試裡處理並註明 |
| config:缺欄位 vs 顯式 null | Task 2 的 `auto_arm`/`gate_cmds`/`models`/`model_profile` 四組 |
| config:model 值域、gate_cmds、resolve_finish | Task 2 四個 section |
| changemeta:flow_profile、needs_uiux、parallel_groups、is_serial 邊界 | Task 3 |
| checkpoint:round trip + 拒收 | Task 4 兩個 section |
| followup:逐字輸出 | Task 1 |
| 檔內 section 都要有人消費 | `parity_cases` / `parityCases` 的 section 集合斷言 |

**與 spec 的兩處偏離,已在上表註明理由:**
- spec 寫 `expect_py`/`expect_ts` 平坦欄位,實作改為 `py`/`ts` 巢狀區塊 —— 因為分歧的一側也可能是「拋錯」,巢狀才能讓兩側各自帶 `expect` 或 `expect_throws`。
- spec 提 checkpoint 的「`phase` 非法、`iteration` 非數」是拒收案例 —— **實測兩引擎都接受**(Python 的 dataclass 不做值域驗證,TS 照抄)。plan 改成把「刻意不驗證」記錄成明確的 case,而非錯誤地斷言拒收。

**2. Placeholder scan** — 無 TBD / 「類似 Task N」/ 無程式碼的程式步驟。每個 fixture 檔都是完整內容,每個測試檔都是完整程式。

**3. Type consistency** — Python 三個 helper(`parity_cases` / `resolve_expectation` / `assert_subset`)與 TS 三個(`parityCases` / `resolveExpectation` / `expectSubset`)在 Task 2/3/4 的呼叫簽名與 Task 1 定義一致;`SECTIONS` 常數在每個測試檔內與對應 fixture 的頂層鍵完全相符。

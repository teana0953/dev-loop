# L1 M2b-1 Implementation Plan:純模組移植 + CLI 路由交接

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `units`/`review`/`housekeeping` 移植到 TypeScript,並讓 `bin/devloop` 改由 TS 引擎當前門——認得的自己處理,不認得的委派回 Python。

**Architecture:** 三個純模組逐一移植,各自配 parity fixture 或兩側對照測試。接著 `cli.ts` 從「單一 status 命令」重構成有路由表、參數解析與 Python 委派的進入點,再接上三個不碰 watcher 的子命令。

**Tech Stack:** TypeScript 6 / vitest;Python 3.10+ / pytest。不新增任何依賴。

**Spec:** `docs/superpowers/specs/2026-08-01-L1-M2b1-pure-modules-and-cli-routing-design.md`

## Global Constraints

- **Python 行為為準。** 本 plan 內所有預期值都已對現行實作實測驗證;若實作與 plan 不符,**先停下來回報**,不要自行改預期值也不要改實作。
- **不修改 Python 引擎**(`plugins/dev-loop/devloop/*.py`),除非某個 task 明文要求。本 plan 只有 Task 5 會動到 Python 測試檔,不動 Python 實作。
- **fixture 是兩引擎共用的單一真理**(契約見 `fixtures/parity/README.md`):新 case 只加進 fixture 檔,絕不只改一側的測試檔;真的兩邊行為不同要先裁決、寫 `divergence_reason` + `py`/`ts` 區塊,不准靠放寬某側的 expect 讓測試變綠。
- **移植時 `Boolean(x)` 與 `x ?? d` 都不是安全直譯。** 用 `plugins/dev-loop/src/jsonio.ts` 的 `pyTruthy` 與 `pyGet`。這兩個坑各出過一次事,兩次都是「輸入合法、兩邊都不報錯、行為相反」。Python 的 `d[k]` 也不是 `obj.k`——缺鍵要拋錯,見 Task 1 的 `pyIndex`。
- pytest 從 repo 根跑:`make test`。vitest 從 `plugins/dev-loop/` 跑:`npm test`。兩者都必須綠,`npm run lint` 也是。
- TS:ESM + NodeNext,**相對 import 必須帶 `.js` 副檔名**;`strict: true`;eslint 掃 `src`,**禁止 `any`**(用 `unknown` + 明確 cast)。
- **絕不手動複製任何東西進 `plugins/dev-loop/dist/`。** `npm test` 的 `pretest` 會自動 `build && bundle`。改完 `src/` 若要手動驗 CLI,先跑 `npm run bundle`。
- 工具用最新穩定版;不手寫版號。本 plan 不新增依賴,不動 `package.json`。

---

## File Structure

| 檔案 | 責任 | Task |
|---|---|---|
| `plugins/dev-loop/src/jsonio.ts` | 新增 `pyIndex`(Python `d[k]` 的 KeyError 語意) | 1 |
| `plugins/dev-loop/src/units.ts` | units 狀態計算 | 1 |
| `plugins/dev-loop/src/units.test.ts` | units 單元測試 | 1 |
| `fixtures/parity/units.json` | units parity 預期表 | 1 |
| `tests/test_parity_units.py` / `plugins/dev-loop/src/parity.units.test.ts` | 兩側消費者 | 1 |
| `plugins/dev-loop/src/review.ts` | findings 分類 + 報告解析 | 2 |
| `plugins/dev-loop/src/review.test.ts` | review 單元測試 | 2 |
| `fixtures/parity/review.json` | review parity 預期表 | 2 |
| `tests/test_parity_review.py` / `plugins/dev-loop/src/parity.review.test.ts` | 兩側消費者 | 2 |
| `plugins/dev-loop/src/housekeeping.ts` | 工作檔歸檔 | 3 |
| `plugins/dev-loop/src/housekeeping.test.ts` | 檔案系統測試(與 `tests/test_housekeeping.py` 對照) | 3 |
| `plugins/dev-loop/src/cli.ts` | 路由表、參數解析、Python 委派 | 4、5 |
| `plugins/dev-loop/src/cli.test.ts` | 既有;改用 `bin/devloop`、加路由測試 | 4 |
| `plugins/dev-loop/bin/devloop` | 改 exec node | 4 |
| `plugins/dev-loop/bin/devloop-ts` | **刪除**(M1 的暫時 wrapper,已被取代) | 4 |
| `plugins/dev-loop/bin/check-deps.sh` | node 列為硬前置 | 4 |
| `README.md` | 前置需求同步 | 4 |
| `fixtures/parity/cli.json` | CLI 逐字輸出預期表 | 5 |
| `tests/test_parity_cli.py` / `plugins/dev-loop/src/parity.cli.test.ts` | 兩側消費者 | 5 |

---

### Task 1: units 模組 + parity fixture

**Files:**
- Modify: `plugins/dev-loop/src/jsonio.ts`(新增 `pyIndex`)
- Create: `plugins/dev-loop/src/units.ts`
- Create: `plugins/dev-loop/src/units.test.ts`
- Create: `fixtures/parity/units.json`
- Create: `tests/test_parity_units.py`
- Create: `plugins/dev-loop/src/parity.units.test.ts`
- Modify: `tests/test_parity_manifest.py`、`plugins/dev-loop/src/parity.manifest.test.ts`(把 `units` 加進 `CONSUMED_MODULES`)

**Interfaces:**
- Consumes:`pyGet`、`pyTruthy`(既有,`./jsonio.js`);parity loader 三件套(`parity_cases`/`resolve_expectation`/`assert_subset` 與 `parityCases`/`resolveExpectation`/`expectSubset`)
- Produces:
  - `pyIndex<T>(data: Record<string, unknown>, key: string): T` —— 缺鍵拋 `Error`
  - `interface Unit { id: string; tasks: unknown; worktree: string; branch: string; status: string }`
  - `buildUnits(parallelGroups: unknown[], branch: string, wtRoot: string): Unit[]`
  - `pendingUnits(units: Unit[]): Unit[]`
  - `mark(units: Unit[], unitId: string, status: string): void`
  - `allDone(units: Unit[]): boolean`
  - `allMerged(units: Unit[]): boolean`
- Task 5 會用到 `pendingUnits`。

- [ ] **Step 1: 新增 `pyIndex`**

在 `plugins/dev-loop/src/jsonio.ts` 末尾追加:

```typescript
/**
 * Python `data[key]` parity: a missing key raises, it does not yield
 * `undefined`. `obj.k` / `obj["k"]` in TypeScript quietly produce
 * `undefined`, which then flows onward as an `undefined` id or a status that
 * matches no branch — the same silent-wrong-answer shape as `??` standing in
 * for `dict.get`. Use this wherever the Python being ported subscripts a dict
 * directly; use `pyGet` where it calls `.get(key, default)`.
 */
export function pyIndex<T>(data: Record<string, unknown>, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    throw new Error(`KeyError: ${JSON.stringify(key)}`);
  }
  return data[key] as T;
}
```

- [ ] **Step 2: 寫 units 模組**

建立 `plugins/dev-loop/src/units.ts`:

```typescript
import { pyGet, pyIndex, pyTruthy } from "./jsonio.js";

const PENDING = ["pending", "in_progress"];
const DONE_OR_MERGED = ["done", "merged"];

export interface Unit {
  id: string;
  // Python 對 tasks 不做任何驗證或轉型(data.get("tasks", [])),原樣保留
  tasks: unknown;
  worktree: string;
  branch: string;
  status: string;
}

/** 由 change meta 的 parallel_groups 展開成 units(規格:平行執行單元)。 */
export function buildUnits(parallelGroups: unknown[], branch: string, wtRoot: string): Unit[] {
  const units: Unit[] = [];
  for (const raw of parallelGroups) {
    const g = raw as Record<string, unknown>;
    // Python: g["id"] —— 缺 id 是 KeyError,不是產一個 id 為 undefined 的 unit
    const gid = pyIndex<string>(g, "id");
    units.push({
      id: gid,
      // Python: g.get("tasks", []) —— 顯式 null 要原樣保留,不得替換成 []
      tasks: pyGet<unknown>(g, "tasks", []),
      worktree: `${wtRoot}/${gid}`,
      branch: `${branch}-${gid}`,
      status: "pending",
    });
  }
  return units;
}

export function pendingUnits(units: Unit[]): Unit[] {
  return units.filter((u) => PENDING.includes(pyIndex<string>(u as unknown as Record<string, unknown>, "status")));
}

/** 就地改 unit 狀態;找不到 unit_id 拋錯(Python 的 KeyError)。 */
export function mark(units: Unit[], unitId: string, status: string): void {
  for (const u of units) {
    if (u.id === unitId) {
      u.status = status;
      return;
    }
  }
  throw new Error(`no unit ${JSON.stringify(unitId)}`);
}

/**
 * Python: `bool(units) and all(...)`。
 *
 * `units.every(...)` 對空陣列回 true——一個沒有任何 unit 的 checkpoint 會被
 * 判成「全部完成」直接放行進 merge。空集合的 all() 為真是兩個語言共通的,
 * 真正的守門是前面那個 `bool(units)`,移植時不能掉。
 */
export function allDone(units: Unit[]): boolean {
  return pyTruthy(units)
    && units.every((u) => DONE_OR_MERGED.includes(pyIndex<string>(u as unknown as Record<string, unknown>, "status")));
}

export function allMerged(units: Unit[]): boolean {
  return pyTruthy(units)
    && units.every((u) => pyIndex<string>(u as unknown as Record<string, unknown>, "status") === "merged");
}
```

- [ ] **Step 3: 寫 units fixture**

建立 `fixtures/parity/units.json`:

```json
{
  "buildUnits": [
    {
      "name": "empty groups yield no units",
      "parallel_groups": [], "branch": "feat/x", "wt_root": ".devloop/wt",
      "expect": { "value": [] }
    },
    {
      "name": "absent tasks defaults to an empty list",
      "parallel_groups": [{ "id": "g1" }], "branch": "feat/x", "wt_root": ".devloop/wt",
      "expect": {
        "value": [{
          "id": "g1", "tasks": [], "worktree": ".devloop/wt/g1",
          "branch": "feat/x-g1", "status": "pending"
        }]
      }
    },
    {
      "name": "explicit null tasks is preserved, not defaulted",
      "parallel_groups": [{ "id": "g1", "tasks": null }], "branch": "feat/x", "wt_root": ".devloop/wt",
      "expect": {
        "value": [{
          "id": "g1", "tasks": null, "worktree": ".devloop/wt/g1",
          "branch": "feat/x-g1", "status": "pending"
        }]
      }
    },
    {
      "name": "tasks pass through unchanged",
      "parallel_groups": [{ "id": "g1", "tasks": ["a", "b"] }], "branch": "b", "wt_root": "w",
      "expect": {
        "value": [{
          "id": "g1", "tasks": ["a", "b"], "worktree": "w/g1",
          "branch": "b-g1", "status": "pending"
        }]
      }
    },
    {
      "name": "two groups get one worktree and branch each",
      "parallel_groups": [{ "id": "a" }, { "id": "b" }], "branch": "feat/x", "wt_root": "w",
      "expect": {
        "value": [
          { "id": "a", "tasks": [], "worktree": "w/a", "branch": "feat/x-a", "status": "pending" },
          { "id": "b", "tasks": [], "worktree": "w/b", "branch": "feat/x-b", "status": "pending" }
        ]
      }
    },
    {
      "name": "a group without an id is rejected",
      "parallel_groups": [{ "tasks": [] }], "branch": "b", "wt_root": "w",
      "expect_throws": true
    }
  ],

  "pendingUnits": [
    {
      "name": "no units means nothing pending",
      "units": [],
      "expect": { "value": [] }
    },
    {
      "name": "pending and in_progress both count as pending",
      "units": [
        { "id": "a", "status": "pending" }, { "id": "b", "status": "in_progress" },
        { "id": "c", "status": "done" }, { "id": "d", "status": "merged" },
        { "id": "e", "status": "failed" }
      ],
      "expect": { "value": [{ "id": "a", "status": "pending" }, { "id": "b", "status": "in_progress" }] }
    },
    {
      "name": "a unit without a status is rejected",
      "units": [{ "id": "a" }],
      "expect_throws": true
    }
  ],

  "mark": [
    {
      "name": "marks the named unit in place",
      "units": [{ "id": "a", "status": "pending" }, { "id": "b", "status": "pending" }],
      "unit_id": "b", "status": "done",
      "expect": { "value": [{ "id": "a", "status": "pending" }, { "id": "b", "status": "done" }] }
    },
    {
      "name": "marks only the first match and stops",
      "units": [{ "id": "a", "status": "pending" }, { "id": "a", "status": "pending" }],
      "unit_id": "a", "status": "done",
      "expect": { "value": [{ "id": "a", "status": "done" }, { "id": "a", "status": "pending" }] }
    },
    {
      "name": "an unknown unit id is rejected",
      "units": [{ "id": "a", "status": "pending" }],
      "unit_id": "zz", "status": "done",
      "expect_throws": true
    }
  ],

  "allDone": [
    {
      "name": "no units is NOT all done",
      "units": [],
      "expect": { "value": false }
    },
    {
      "name": "done and merged both count as done",
      "units": [{ "id": "a", "status": "done" }, { "id": "b", "status": "merged" }],
      "expect": { "value": true }
    },
    {
      "name": "one pending unit is not all done",
      "units": [{ "id": "a", "status": "done" }, { "id": "b", "status": "pending" }],
      "expect": { "value": false }
    },
    {
      "name": "a unit without a status is rejected",
      "units": [{ "id": "a" }],
      "expect_throws": true
    }
  ],

  "allMerged": [
    {
      "name": "no units is NOT all merged",
      "units": [],
      "expect": { "value": false }
    },
    {
      "name": "done is not merged",
      "units": [{ "id": "a", "status": "done" }, { "id": "b", "status": "merged" }],
      "expect": { "value": false }
    },
    {
      "name": "every unit merged",
      "units": [{ "id": "a", "status": "merged" }],
      "expect": { "value": true }
    }
  ]
}
```

`"no units is NOT all done"` 是本 fixture 最重要的一條:`units.every(...)` 對空陣列回 `true`,漏掉 `bool(units)` 就會讓一個沒有任何 unit 的 checkpoint 直接放行進 merge。

- [ ] **Step 4: 寫 Python 側消費者**

建立 `tests/test_parity_units.py`:

```python
import copy

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.units import all_done, all_merged, build_units, mark, pending_units

SECTIONS = ["buildUnits", "pendingUnits", "mark", "allDone", "allMerged"]


@pytest.mark.parametrize("case", parity_cases("units", "buildUnits", SECTIONS))
def test_build_units_parity(case):
    expect, throws = resolve_expectation(case, "py")
    args = (case["parallel_groups"], case["branch"], case["wt_root"])
    if throws:
        with pytest.raises(Exception):
            build_units(*args)
        return
    assert_subset({"value": build_units(*args)}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "pendingUnits", SECTIONS))
def test_pending_units_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            pending_units(case["units"])
        return
    assert_subset({"value": pending_units(case["units"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "mark", SECTIONS))
def test_mark_parity(case):
    # mark 就地改動,所以複製一份再餵,避免 fixture 讀到的物件被跨 case 汙染
    units = copy.deepcopy(case["units"])
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            mark(units, case["unit_id"], case["status"])
        return
    mark(units, case["unit_id"], case["status"])
    assert_subset({"value": units}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "allDone", SECTIONS))
def test_all_done_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            all_done(case["units"])
        return
    assert_subset({"value": all_done(case["units"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("units", "allMerged", SECTIONS))
def test_all_merged_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            all_merged(case["units"])
        return
    assert_subset({"value": all_merged(case["units"])}, expect, case["name"])
```

- [ ] **Step 5: 跑 Python 側**

Run: `make test`
Expected: PASS(units parity 共 19 個 case)

- [ ] **Step 6: 寫 TS 側消費者**

建立 `plugins/dev-loop/src/parity.units.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { allDone, allMerged, buildUnits, mark, pendingUnits, type Unit } from "./units.js";

const SECTIONS = ["buildUnits", "pendingUnits", "mark", "allDone", "allMerged"];

function units(c: { units?: unknown }): Unit[] {
  // mark 就地改動,所以每個 case 各拿一份副本,避免跨 case 汙染
  return structuredClone(c.units) as Unit[];
}

describe("parity: buildUnits", () => {
  for (const c of parityCases("units", "buildUnits", SECTIONS)) {
    it(c.name, () => {
      const call = () => buildUnits(
        c.parallel_groups as unknown[], c.branch as string, c.wt_root as string,
      );
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(call).toThrow();
        return;
      }
      expectSubset({ value: call() }, want!, c.name);
    });
  }
});

describe("parity: pendingUnits", () => {
  for (const c of parityCases("units", "pendingUnits", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => pendingUnits(units(c))).toThrow();
        return;
      }
      expectSubset({ value: pendingUnits(units(c)) }, want!, c.name);
    });
  }
});

describe("parity: mark", () => {
  for (const c of parityCases("units", "mark", SECTIONS)) {
    it(c.name, () => {
      const u = units(c);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => mark(u, c.unit_id as string, c.status as string)).toThrow();
        return;
      }
      mark(u, c.unit_id as string, c.status as string);
      expectSubset({ value: u }, want!, c.name);
    });
  }
});

describe("parity: allDone", () => {
  for (const c of parityCases("units", "allDone", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => allDone(units(c))).toThrow();
        return;
      }
      expectSubset({ value: allDone(units(c)) }, want!, c.name);
    });
  }
});

describe("parity: allMerged", () => {
  for (const c of parityCases("units", "allMerged", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => allMerged(units(c))).toThrow();
        return;
      }
      expectSubset({ value: allMerged(units(c)) }, want!, c.name);
    });
  }
});
```

- [ ] **Step 7: 把 `units` 加進兩側的 manifest 清單**

`tests/test_parity_manifest.py` 與 `plugins/dev-loop/src/parity.manifest.test.ts` 各有一份 `CONSUMED_MODULES`。兩邊都加入 `units`。**兩邊都要改**——只改一邊會讓該側的 manifest guard 立刻變紅,那正是它的用途。

- [ ] **Step 8: 寫 TS 單元測試**

建立 `plugins/dev-loop/src/units.test.ts`。parity fixture 已涵蓋輸入輸出對應,這裡只補 fixture 表達不了的:

```typescript
import { describe, it, expect } from "vitest";
import { allDone, buildUnits, mark, type Unit } from "./units.js";

describe("mark", () => {
  it("mutates in place rather than returning a new array", () => {
    const units: Unit[] = [
      { id: "a", tasks: [], worktree: "w/a", branch: "b-a", status: "pending" },
    ];
    const same = units[0];
    mark(units, "a", "done");
    expect(units[0]).toBe(same);
    expect(same!.status).toBe("done");
  });
});

describe("buildUnits", () => {
  it("does not alias the input groups", () => {
    const groups = [{ id: "g1", tasks: ["a"] }];
    const built = buildUnits(groups, "b", "w");
    expect(built[0]!.tasks).toBe(groups[0]!.tasks);
    // Python 同樣是直接放 g.get("tasks") 的物件,不複製——這裡固定住這個事實,
    // 免得日後有人「順手」加了深複製,讓兩個引擎的別名語意分家。
  });
});

describe("allDone", () => {
  it("is false for an empty list even though every() would be true", () => {
    expect([].every(() => false)).toBe(true);
    expect(allDone([])).toBe(false);
  });
});
```

- [ ] **Step 9: 跑 TS 側 + lint**

Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: PASS

- [ ] **Step 10: 驗證非空轉**

暫時把 `units.json` 裡 `"no units is NOT all done"` 的預期改成 `{"value": true}`,兩側各跑一次:

Run: `make test` — Expected: FAIL,訊息含 `no units is NOT all done`
Run(在 `plugins/dev-loop/`):`npm test` — Expected: FAIL,同一個 case 名稱

改回 `false`,重跑兩側確認回綠。

- [ ] **Step 11: Commit**

```bash
git add plugins/dev-loop/src/jsonio.ts plugins/dev-loop/src/units.ts \
        plugins/dev-loop/src/units.test.ts plugins/dev-loop/src/parity.units.test.ts \
        plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/units.json tests/test_parity_units.py tests/test_parity_manifest.py \
        plugins/dev-loop/dist/cli.js
git commit -m "feat(ts): port the units module

Adds pyIndex next to pyGet and pyTruthy: Python's d[k] raises on a missing
key while obj.k yields undefined, which then travels onward as an undefined
unit id or a status matching no branch.

The fixture's load-bearing case is the empty list. Python guards all_done
with bool(units); every() on an empty array is true, so dropping that guard
would let a checkpoint with no units at all report itself fully done and
walk into merge."
```

若 `git status` 顯示 `dist/cli.js` 沒有變動,就從 `git add` 拿掉它——`units.ts` 不在 `cli.ts` 的相依樹上,esbuild 會把它 tree-shake 掉,沒變動是正確的。

---

### Task 2: review 模組 + parity fixture

**Files:**
- Create: `plugins/dev-loop/src/review.ts`
- Create: `plugins/dev-loop/src/review.test.ts`
- Create: `fixtures/parity/review.json`
- Create: `tests/test_parity_review.py`
- Create: `plugins/dev-loop/src/parity.review.test.ts`
- Modify: `tests/test_parity_manifest.py`、`plugins/dev-loop/src/parity.manifest.test.ts`

**Interfaces:**
- Consumes:`pyGet`(`./jsonio.js`);`readFileSync`;statemachine 的事件常數(`./statemachine.js` 已匯出 `PROPOSE_CLEAN`、`PROPOSE_BLOCKING_PROPOSAL`、`PROPOSE_BLOCKING_DESIGN`、`QA_PASS`、`QA_FAIL`、`REVIEW_NO_BLOCKING`、`REVIEW_BLOCKING_CODE`、`REVIEW_BLOCKING_PROPOSAL`)
- Produces:
  - `class ReportError extends Error`
  - `type Finding = Record<string, unknown>`
  - `classify(findings: Finding[]): string`
  - `classifyProposal(findings: Finding[]): string`
  - `classifyQa(findings: Finding[]): string`
  - `nonBlockingNotes(findings: Finding[]): unknown[]`
  - `parseReviewReport(path: string): Finding[]`
  - `aggregateFindings(paths: string[]): Finding[]`
  - `VALID_SEVERITIES`
- M2b-2 接 `review`/`qa`/`proposal-review` 三個子命令時會用到全部,並以 `instanceof ReportError` 分辨報告格式錯誤。

- [ ] **Step 1: 寫 review 模組**

建立 `plugins/dev-loop/src/review.ts`:

```typescript
import { readFileSync } from "node:fs";
import { pyGet } from "./jsonio.js";
import {
  PROPOSE_BLOCKING_DESIGN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_CLEAN,
  QA_FAIL, QA_PASS,
  REVIEW_BLOCKING_CODE, REVIEW_BLOCKING_PROPOSAL, REVIEW_NO_BLOCKING,
} from "./statemachine.js";

export type Finding = Record<string, unknown>;

/**
 * review 報告非法(檔案缺失、非 JSON、schema 不符)。格式錯必須 fail loudly,
 * 不得與「findings 為空(=pass)」混同。
 *
 * 是一個具名子類而非裸 Error,好讓 CLI 用 instanceof 把「報告壞掉」和
 * 其他例外分開處理(Python 那側是 ReportError(ValueError))。
 */
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

function blockingOf(findings: Finding[]): Finding[] {
  // Python: f.get("severity") —— 缺鍵回 None,不是 KeyError
  return findings.filter((f) => pyGet<unknown>(f, "severity", null) === "blocking");
}

/**
 * 將 review findings 映射成狀態機事件(規格 5)。
 *
 * 任一 proposal 層級 blocking → 逃生門(回 propose);
 * 否則有 code blocking → fix;全無 blocking → merge。
 */
export function classify(findings: Finding[]): string {
  const blocking = blockingOf(findings);
  if (blocking.length === 0) {
    return REVIEW_NO_BLOCKING;
  }
  if (blocking.some((f) => pyGet<unknown>(f, "level", null) === "proposal")) {
    return REVIEW_BLOCKING_PROPOSAL;
  }
  return REVIEW_BLOCKING_CODE;
}

/**
 * Proposal review 分類:design 層 blocking 優先 → 升級;
 * proposal 層 blocking → 回 propose;無 blocking → clean。
 */
export function classifyProposal(findings: Finding[]): string {
  const blocking = blockingOf(findings);
  if (blocking.length === 0) {
    return PROPOSE_CLEAN;
  }
  if (blocking.some((f) => pyGet<unknown>(f, "level", null) === "design")) {
    return PROPOSE_BLOCKING_DESIGN;
  }
  return PROPOSE_BLOCKING_PROPOSAL;
}

/** 抽出 non-blocking 項的 note 文字供 follow-up。 */
export function nonBlockingNotes(findings: Finding[]): unknown[] {
  return findings
    .filter((f) => pyGet<unknown>(f, "severity", null) === "non_blocking")
    .map((f) => pyGet<unknown>(f, "note", ""));
}

export const VALID_SEVERITIES = ["blocking", "non_blocking"] as const;

export function parseReviewReport(path: string): Finding[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (exc) {
    throw new ReportError(`cannot read report ${path}: ${String(exc)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (exc) {
    throw new ReportError(`report ${path} is not valid JSON: ${String(exc)}`);
  }
  if (
    typeof data !== "object" || data === null || Array.isArray(data)
    || !Object.prototype.hasOwnProperty.call(data, "findings")
  ) {
    throw new ReportError(`report ${path} missing "findings" key`);
  }
  const findings = (data as Record<string, unknown>).findings;
  if (!Array.isArray(findings)) {
    throw new ReportError(`report ${path} "findings" must be a list`);
  }
  findings.forEach((finding, i) => {
    if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
      throw new ReportError(`report ${path} findings[${i}] must be an object`);
    }
    const f = finding as Finding;
    const severity = pyGet<unknown>(f, "severity", null);
    if (!(VALID_SEVERITIES as readonly unknown[]).includes(severity)) {
      throw new ReportError(
        `report ${path} findings[${i}] invalid severity ${JSON.stringify(severity)} `
        + `(expected blocking|non_blocking)`,
      );
    }
    // note 走到 render_followup 就是要被字串串接的。不驗型別的話,一個
    // {"note": 42} 會安靜地活到 merge 階段才出事,而且兩個引擎的出事方式
    // 不同——報告解析當下就拒收,錯誤位置才有意義。
    if (Object.prototype.hasOwnProperty.call(f, "note") && typeof f.note !== "string") {
      throw new ReportError(
        `report ${path} findings[${i}] note must be a string, got ${JSON.stringify(f.note)}`,
      );
    }
  });
  return findings as Finding[];
}

/** 把多個 review 報告的 findings 串接成單一 list(供 code+uiux legs 彙總)。 */
export function aggregateFindings(reportPaths: string[]): Finding[] {
  const merged: Finding[] = [];
  for (const path of reportPaths) {
    merged.push(...parseReviewReport(path));
  }
  return merged;
}

/** QA 報告分類:任一 blocking → QA_FAIL;否則 QA_PASS。 */
export function classifyQa(findings: Finding[]): string {
  return blockingOf(findings).length > 0 ? QA_FAIL : QA_PASS;
}
```

注意 `classify` 用的是 `blocking.some(level === "proposal")`,而 `classifyProposal` 用的是 `level === "design"`——兩個函式的優先序欄位不同,別互相抄。

- [ ] **Step 2: 寫 review fixture**

建立 `fixtures/parity/review.json`:

```json
{
  "classify": [
    { "name": "no findings means nothing blocking", "findings": [], "expect": { "value": "review_no_blocking" } },
    {
      "name": "only non-blocking findings",
      "findings": [{ "severity": "non_blocking", "note": "tidy" }],
      "expect": { "value": "review_no_blocking" }
    },
    {
      "name": "a finding with no severity key is not blocking",
      "findings": [{ "level": "code" }],
      "expect": { "value": "review_no_blocking" }
    },
    {
      "name": "blocking code finding routes to fix",
      "findings": [{ "severity": "blocking", "level": "code" }],
      "expect": { "value": "review_blocking_code" }
    },
    {
      "name": "a blocking finding with no level defaults to code",
      "findings": [{ "severity": "blocking" }],
      "expect": { "value": "review_blocking_code" }
    },
    {
      "name": "blocking proposal finding takes the escape hatch",
      "findings": [{ "severity": "blocking", "level": "proposal" }],
      "expect": { "value": "review_blocking_proposal" }
    },
    {
      "name": "proposal outranks code when both are blocking",
      "findings": [
        { "severity": "blocking", "level": "code" },
        { "severity": "blocking", "level": "proposal" }
      ],
      "expect": { "value": "review_blocking_proposal" }
    },
    {
      "name": "a non-blocking proposal finding does not trigger the escape hatch",
      "findings": [
        { "severity": "blocking", "level": "code" },
        { "severity": "non_blocking", "level": "proposal" }
      ],
      "expect": { "value": "review_blocking_code" }
    }
  ],

  "classifyProposal": [
    { "name": "no findings is clean", "findings": [], "expect": { "value": "propose_clean" } },
    {
      "name": "only non-blocking findings is clean",
      "findings": [{ "severity": "non_blocking" }],
      "expect": { "value": "propose_clean" }
    },
    {
      "name": "blocking design finding escalates",
      "findings": [{ "severity": "blocking", "level": "design" }],
      "expect": { "value": "propose_blocking_design" }
    },
    {
      "name": "blocking proposal finding goes back to propose",
      "findings": [{ "severity": "blocking", "level": "proposal" }],
      "expect": { "value": "propose_blocking_proposal" }
    },
    {
      "name": "design outranks proposal when both are blocking",
      "findings": [
        { "severity": "blocking", "level": "proposal" },
        { "severity": "blocking", "level": "design" }
      ],
      "expect": { "value": "propose_blocking_design" }
    },
    {
      "name": "a blocking finding with no level goes back to propose",
      "findings": [{ "severity": "blocking" }],
      "expect": { "value": "propose_blocking_proposal" }
    }
  ],

  "classifyQa": [
    { "name": "no findings passes", "findings": [], "expect": { "value": "qa_pass" } },
    {
      "name": "only non-blocking findings passes",
      "findings": [{ "severity": "non_blocking" }],
      "expect": { "value": "qa_pass" }
    },
    {
      "name": "any blocking finding fails, regardless of level",
      "findings": [{ "severity": "blocking", "level": "proposal" }],
      "expect": { "value": "qa_fail" }
    }
  ],

  "nonBlockingNotes": [
    { "name": "no findings means no notes", "findings": [], "expect": { "value": [] } },
    {
      "name": "collects only non-blocking notes, in order",
      "findings": [
        { "severity": "non_blocking", "note": "x" },
        { "severity": "blocking", "note": "y" },
        { "severity": "non_blocking", "note": "z" }
      ],
      "expect": { "value": ["x", "z"] }
    },
    {
      "name": "an absent note becomes an empty string",
      "findings": [{ "severity": "non_blocking" }],
      "expect": { "value": [""] }
    }
  ],

  "parseReviewReport": [
    {
      "name": "a valid report yields its findings",
      "input": { "findings": [{ "severity": "blocking", "level": "code", "note": "bug" }] },
      "expect": { "value": [{ "severity": "blocking", "level": "code", "note": "bug" }] }
    },
    {
      "name": "empty findings is valid and means pass",
      "input": { "findings": [] },
      "expect": { "value": [] }
    },
    { "name": "a missing file is rejected", "file_absent": true, "expect_throws": true },
    { "name": "an array root is rejected", "input": [], "expect_throws": true },
    { "name": "a null root is rejected", "input": null, "expect_throws": true },
    { "name": "a missing findings key is rejected", "input": { "items": [] }, "expect_throws": true },
    { "name": "findings as an object is rejected", "input": { "findings": {} }, "expect_throws": true },
    {
      "name": "a non-object finding is rejected",
      "input": { "findings": ["oops"] },
      "expect_throws": true
    },
    {
      "name": "a missing severity is rejected",
      "input": { "findings": [{ "level": "code" }] },
      "expect_throws": true
    },
    {
      "name": "an unknown severity is rejected",
      "input": { "findings": [{ "severity": "critical" }] },
      "expect_throws": true
    },
    {
      "name": "a non-string note is rejected",
      "input": { "findings": [{ "severity": "non_blocking", "note": 42 }] },
      "expect_throws": true
    },
    {
      "name": "an absent note is valid",
      "input": { "findings": [{ "severity": "blocking" }] },
      "expect": { "value": [{ "severity": "blocking" }] }
    }
  ],

  "aggregateFindings": [
    { "name": "no reports means no findings", "inputs": [], "expect": { "value": [] } },
    {
      "name": "concatenates in report order",
      "inputs": [
        { "findings": [{ "severity": "blocking", "note": "a" }] },
        { "findings": [{ "severity": "non_blocking", "note": "b" }] }
      ],
      "expect": {
        "value": [
          { "severity": "blocking", "note": "a" },
          { "severity": "non_blocking", "note": "b" }
        ]
      }
    },
    {
      "name": "one bad report rejects the whole aggregate",
      "inputs": [{ "findings": [] }, { "findings": [{ "severity": "critical" }] }],
      "expect_throws": true
    }
  ]
}
```

`parseReviewReport` 的 case 用 `input` 寫檔(`file_absent: true` 表示不建檔);`aggregateFindings` 的 `inputs` 是一個陣列,每個元素寫成一個獨立報告檔,依序傳入。

- [ ] **Step 3: 寫 Python 側消費者**

建立 `tests/test_parity_review.py`:

```python
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
```

`_pure` 這個工廠是為了讓四個結構完全相同的純函式 section 不必逐字重複四遍;它產生的四個 test 函式各自被 pytest 收集。

- [ ] **Step 4: 跑 Python 側**

Run: `make test`
Expected: PASS(review parity 共 32 個 case)

- [ ] **Step 5: 寫 TS 側消費者**

建立 `plugins/dev-loop/src/parity.review.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import {
  aggregateFindings, classify, classifyProposal, classifyQa,
  nonBlockingNotes, parseReviewReport, type Finding,
} from "./review.js";

const SECTIONS = [
  "classify", "classifyProposal", "classifyQa",
  "nonBlockingNotes", "parseReviewReport", "aggregateFindings",
];

function write(payload: unknown, name = "report.json"): string {
  const p = join(mkdtempSync(join(tmpdir(), "review-")), name);
  writeFileSync(p, JSON.stringify(payload), "utf-8");
  return p;
}

function pureSection(section: string, fn: (f: Finding[]) => unknown): void {
  describe(`parity: ${section}`, () => {
    for (const c of parityCases("review", section, SECTIONS)) {
      it(c.name, () => {
        const findings = c.findings as Finding[];
        const { expect: want, throws } = resolveExpectation(c);
        if (throws) {
          expect(() => fn(findings)).toThrow();
          return;
        }
        expectSubset({ value: fn(findings) }, want!, c.name);
      });
    }
  });
}

pureSection("classify", classify);
pureSection("classifyProposal", classifyProposal);
pureSection("classifyQa", classifyQa);
pureSection("nonBlockingNotes", nonBlockingNotes);

function reportPath(c: ParityCase): string {
  return c.file_absent === true
    ? join(mkdtempSync(join(tmpdir(), "review-")), "absent.json")
    : write(c.input);
}

describe("parity: parseReviewReport", () => {
  for (const c of parityCases("review", "parseReviewReport", SECTIONS)) {
    it(c.name, () => {
      const path = reportPath(c);
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => parseReviewReport(path)).toThrow();
        return;
      }
      expectSubset({ value: parseReviewReport(path) }, want!, c.name);
    });
  }
});

describe("parity: aggregateFindings", () => {
  for (const c of parityCases("review", "aggregateFindings", SECTIONS)) {
    it(c.name, () => {
      const paths = (c.inputs as unknown[]).map((p, i) => write(p, `r${i}.json`));
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => aggregateFindings(paths)).toThrow();
        return;
      }
      expectSubset({ value: aggregateFindings(paths) }, want!, c.name);
    });
  }
});
```

- [ ] **Step 6: 把 `review` 加進兩側 manifest 清單**

同 Task 1 Step 7,`tests/test_parity_manifest.py` 與 `plugins/dev-loop/src/parity.manifest.test.ts` 的 `CONSUMED_MODULES` 都加入 `review`。

- [ ] **Step 7: 寫 TS 單元測試**

建立 `plugins/dev-loop/src/review.test.ts`,補 fixture 表達不了的部分:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportError, parseReviewReport } from "./review.js";

function write(payload: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "review-")), "r.json");
  writeFileSync(p, payload, "utf-8");
  return p;
}

describe("ReportError", () => {
  // M2b-2 的 CLI 要靠 instanceof 把「報告壞掉」跟其他例外分開,
  // 所以這個子類身分本身就是契約。
  it("is thrown for a malformed report, not a bare Error", () => {
    expect(() => parseReviewReport(write("{not json"))).toThrow(ReportError);
  });
  it("is thrown for a missing file", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "review-")), "nope.json");
    expect(() => parseReviewReport(missing)).toThrow(ReportError);
  });
  it("names the offending finding index", () => {
    const p = write(JSON.stringify({ findings: [{ severity: "blocking" }, { severity: "x" }] }));
    expect(() => parseReviewReport(p)).toThrow("findings[1]");
  });
});
```

- [ ] **Step 8: 跑兩側 + lint**

Run: `make test`
Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: 皆 PASS

- [ ] **Step 9: 驗證非空轉**

暫時把 `review.json` 裡 `"proposal outranks code when both are blocking"` 的預期改成 `{"value": "review_blocking_code"}`,兩側各跑一次,確認都紅在同一個 case 名稱,再改回。

- [ ] **Step 10: Commit**

```bash
git add plugins/dev-loop/src/review.ts plugins/dev-loop/src/review.test.ts \
        plugins/dev-loop/src/parity.review.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/review.json tests/test_parity_review.py tests/test_parity_manifest.py
git commit -m "feat(ts): port the review module

classify and classifyProposal rank different level fields — proposal over
code for the former, design over proposal for the latter — so the fixture
pins both orderings explicitly rather than trusting them to look alike.

ReportError is a named subclass because M2b-2's CLI needs instanceof to tell
a malformed report from any other failure, the way Python's
ReportError(ValueError) already does."
```

---

### Task 3: housekeeping 模組

不進 parity fixture:初始目錄樹與結果佈局用 fixture 描述會比測試本身更難讀。改成兩側各自的檔案系統測試,涵蓋同一批情境。

**Files:**
- Create: `plugins/dev-loop/src/housekeeping.ts`
- Create: `plugins/dev-loop/src/housekeeping.test.ts`

**Interfaces:**
- Consumes:`node:fs`、`node:path`
- Produces:
  - `KEEP_FILES: readonly string[]`
  - `archiveWorkfiles(checkpointPath: string, changeId: string): string[]`
- Task 5 的 `devloop archive` 會用到。

- [ ] **Step 1: 寫 housekeeping 模組**

建立 `plugins/dev-loop/src/housekeeping.ts`:

```typescript
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync,
  renameSync, statSync, utimesSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

// 跨 change 的常駐檔,歸檔時不動(checkpoint 以實際檔名另列)
export const KEEP_FILES = ["config.json", "watcher.pid"] as const;

/**
 * 把該 change 的工作檔搬進 `<devloop-dir>/archive/<change_id>/`,回傳歸檔名單。
 *
 * 搬移:checkpoint 同目錄頂層所有檔案(報告、followup、history.jsonl、
 * watcher-log.jsonl…),常駐檔(config/checkpoint/watcher.pid)與子目錄除外;
 * 外加 `changes/<change_id>.json` meta。checkpoint 另複製一份快照進歸檔
 * (原檔保留,status 在 done 終態仍可讀)。
 *
 * 採「搬走所有非常駐檔」而非白名單 pattern:報告檔名由編排端決定,
 * 引擎不猜;跑得越多 `.devloop/` 越乾淨而不是越髒。
 */
export function archiveWorkfiles(checkpointPath: string, changeId: string): string[] {
  const cpName = basename(checkpointPath);
  const root = dirname(checkpointPath);
  const dest = join(root, "archive", String(changeId));
  const keep = new Set<string>([...KEEP_FILES, cpName]);
  const archived: string[] = [];

  // Python 的 sorted(root.iterdir()) 排的是路徑字串,同目錄下等同於按檔名排。
  // 顯式給比較器而不用 Array.sort() 的預設,是為了讓排序規則寫在明處——
  // 回傳名單的順序是這個函式的可觀察輸出。
  const names = readdirSync(root).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const p = join(root, name);
    if (!statSync(p).isFile() || keep.has(name)) {
      continue;
    }
    mkdirSync(dest, { recursive: true });
    renameSync(p, join(dest, name));
    archived.push(name);
  }

  const meta = join(root, "changes", `${changeId}.json`);
  if (existsSync(meta)) {
    mkdirSync(dest, { recursive: true });
    renameSync(meta, join(dest, basename(meta)));
    archived.push(`changes/${basename(meta)}`);
  }

  if (existsSync(checkpointPath)) {
    mkdirSync(dest, { recursive: true });
    const target = join(dest, cpName);
    copyFileSync(checkpointPath, target);
    // Python 用的是 shutil.copy2,它會連同 mode 與時間戳一起複製;
    // copyFileSync 兩者都不保留。歸檔是鑑識用的產物,時間戳不能在移植中歸零。
    const st = statSync(checkpointPath);
    chmodSync(target, st.mode);
    utimesSync(target, st.atime, st.mtime);
    archived.push(`${cpName} (snapshot)`);
  }

  return archived;
}
```

- [ ] **Step 2: 寫 TS 檔案系統測試**

建立 `plugins/dev-loop/src/housekeeping.test.ts`。這批情境要與 `tests/test_housekeeping.py` 對照——先讀那個檔,確認涵蓋的情境一致,缺的補上:

```typescript
import { describe, it, expect } from "vitest";
import {
  mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_FILES, archiveWorkfiles } from "./housekeeping.js";

function devloopDir(): string {
  const d = join(mkdtempSync(join(tmpdir(), "hk-")), ".devloop");
  mkdirSync(join(d, "changes"), { recursive: true });
  return d;
}

function write(dir: string, name: string, body = "{}"): string {
  const p = join(dir, name);
  writeFileSync(p, body, "utf-8");
  return p;
}

describe("archiveWorkfiles", () => {
  it("moves workfiles, keeps the residents, and snapshots the checkpoint", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    write(d, "config.json");
    write(d, "watcher.pid", "123");
    write(d, "history.jsonl", "{}\n");
    write(d, "zz-report.json");
    write(d, "a-report.json");
    write(join(d, "changes"), "c1.json");
    mkdirSync(join(d, "subdir"));
    write(join(d, "subdir"), "x.txt", "x");

    const archived = archiveWorkfiles(cp, "c1");

    expect(archived).toEqual([
      "a-report.json", "history.jsonl", "zz-report.json",
      "changes/c1.json", "checkpoint.json (snapshot)",
    ]);
    expect(readdirSync(d).sort()).toEqual(
      ["archive", "changes", "checkpoint.json", "config.json", "subdir", "watcher.pid"],
    );
    expect(readdirSync(join(d, "archive", "c1")).sort()).toEqual(
      ["a-report.json", "c1.json", "checkpoint.json", "history.jsonl", "zz-report.json"],
    );
    // 子目錄整個不動
    expect(readdirSync(join(d, "subdir"))).toEqual(["x.txt"]);
  });

  it("returns the moved files in name order", () => {
    // 回傳名單的順序是可觀察輸出,SKILL 會印出來給人看
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    for (const n of ["m.json", "b.json", "z.json", "a.json"]) write(d, n);
    expect(archiveWorkfiles(cp, "c1").slice(0, 4)).toEqual(
      ["a.json", "b.json", "m.json", "z.json"],
    );
  });

  it("preserves the checkpoint snapshot's mtime", () => {
    // copy2 的語意。歸檔是鑑識用的產物。
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    const when = new Date(1_000_000_000_000);
    utimesSync(cp, when, when);
    archiveWorkfiles(cp, "c1");
    expect(statSync(join(d, "archive", "c1", "checkpoint.json")).mtime.getTime())
      .toBe(when.getTime());
  });

  it("is idempotent: a second call only re-snapshots the checkpoint", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    write(d, "r.json");
    archiveWorkfiles(cp, "c1");
    expect(archiveWorkfiles(cp, "c1")).toEqual(["checkpoint.json (snapshot)"]);
  });

  it("works when there is no change meta", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    expect(archiveWorkfiles(cp, "no-such-change")).toEqual(["checkpoint.json (snapshot)"]);
  });

  it("keeps exactly the documented resident files", () => {
    expect([...KEEP_FILES]).toEqual(["config.json", "watcher.pid"]);
  });
});
```

- [ ] **Step 3: 對照 Python 測試,補齊缺口**

讀 `tests/test_housekeeping.py`。Python 有而 TS 沒有的情境,補進 `housekeeping.test.ts`;TS 有而 Python 沒有的(例如 mtime 保留、順序),補進 `tests/test_housekeeping.py`——**這是本 plan 唯一允許新增 Python 測試的地方**,不改 Python 實作。兩邊涵蓋同一批情境是這個模組取代 parity fixture 的方式。

- [ ] **Step 4: 跑兩側 + lint**

Run: `make test`
Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: 皆 PASS

- [ ] **Step 5: 實測 mtime 保留確實會失敗於未修版**

暫時把 `housekeeping.ts` 的 `utimesSync(target, st.atime, st.mtime);` 註解掉,跑 `npm test`。
Expected: FAIL —— `preserves the checkpoint snapshot's mtime` 變紅。
還原,重跑確認回綠。這一步是要證明 `copy2` 的語意真的被測到了,而不是碰巧通過。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/src/housekeeping.ts plugins/dev-loop/src/housekeeping.test.ts \
        tests/test_housekeeping.py
git commit -m "feat(ts): port the housekeeping module

Three details do not survive a naive port: the returned archive list is
ordered by sorted(iterdir()) and that order is user-visible, replace() is an
atomic rename, and copy2 preserves mode and timestamps where copyFileSync
preserves neither. An archive is a forensic artifact; its timestamps must not
quietly reset in the move to a new language.

Filesystem scenarios stay as mirrored tests on both sides rather than a
parity fixture — a directory tree reads worse as JSON than as test setup."
```

---

### Task 4: CLI 路由交接

這是本 plan 風險最高的一步:`bin/devloop` 從此走 TS。做完之後,**每一次** plugin 呼叫都經過 `dist/cli.js`。

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`(重構成有路由表、參數解析、Python 委派)
- Modify: `plugins/dev-loop/src/cli.test.ts`(改用 `bin/devloop`,加路由與委派測試)
- Modify: `plugins/dev-loop/bin/devloop`
- Delete: `plugins/dev-loop/bin/devloop-ts`
- Modify: `plugins/dev-loop/bin/check-deps.sh`
- Modify: `README.md`

**Interfaces:**
- Produces:
  - `export const TS_COMMANDS: readonly string[]` —— TS 宣稱擁有的子命令
  - `export interface CliDeps { archiveChange: typeof archiveChange; delegate: (argv: string[]) => number }`
  - `export function main(argv: string[], deps?: Partial<CliDeps>): number`
- Task 5 會往 `TS_COMMANDS` 與 `main` 的 switch 加三個命令,並用 `deps.archiveChange` 注入測試替身。

- [ ] **Step 1: 重構 `cli.ts`**

把 `plugins/dev-loop/src/cli.ts` 改寫成下列形狀。`cmdStatus` 的內容原封不動保留,只搬位置:

```typescript
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCheckpoint } from "./checkpoint.js";
import { nextHint } from "./statemachine.js";

/**
 * 本引擎自己處理的子命令。其餘一律委派回 Python。
 *
 * 這份清單與 main() 的分派必須完全一致——清單多列一個沒實作的命令,呼叫會
 * 落到 unknown 分支;少列一個已實作的,呼叫會靜默走 Python,「已移植」變成
 * 假的而且沒有人會發現。cli.test.ts 有一條測試釘住兩者相符。
 */
export const TS_COMMANDS = ["status"] as const;

export interface CliDeps {
  delegate: (argv: string[]) => number;
}

/**
 * 未移植的子命令委派回 Python 引擎。
 *
 * PYTHONPATH 從前是 bin/devloop 這支 bash 設的,現在由這裡設——設錯的話所有
 * 未移植的命令會當場 ModuleNotFoundError,所以 cli.test.ts 真的跑一個委派命令
 * 而不是只斷言參數。
 *
 * import.meta.url 在兩種情境下都指向 plugins/dev-loop 的下一層(bundle 是
 * dist/cli.js、測試是 src/cli.ts),所以往上兩層都是 plugin 根。
 */
function delegateToPython(argv: string[]): number {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = process.env.PYTHONPATH;
  const proc = spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: existing ? `${root}${sep}${existing}` : root },
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.signal) {
    // shell 慣例:被 signal 中止的行程回 128 + 訊號編號
    return 128 + (constants.signals[proc.signal as keyof typeof constants.signals] ?? 0);
  }
  return proc.status ?? 1;
}

/**
 * status subcommand. Mirrors Python's `_cmd_status` output format exactly,
 * minus the deferred pieces:
 *  - no --json flag
 *  - no config.json / gate_cmds sourcing (nextHint called without gateCmds)
 *  - no watcher-missing warning
 */
function cmdStatus(file: string): number {
  const cp = loadCheckpoint(file);
  const hint = nextHint(cp.phase, file, {
    units: cp.units as Array<{ id: string; status?: string }>,
    reviewLegs: cp.review_legs as Array<{ kind: string; status?: string }>,
    finishMode: cp.finish_mode,
    flowProfile: cp.flow_profile,
    needsUiux: cp.needs_uiux,
  });
  process.stdout.write(
    `phase=${cp.phase} iteration=${cp.iteration} change_id=${cp.change_id} branch=${cp.branch}\n`,
  );
  process.stdout.write(`${hint}\n`);
  if (cp.updated_at) {
    process.stdout.write(`updated_at=${cp.updated_at}\n`);
  }
  return 0;
}

/** `--key value` 形式的旗標。未知形狀留給各命令自行判斷。 */
function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
}

export function main(argv: string[], deps: Partial<CliDeps> = {}): number {
  const delegate = deps.delegate ?? delegateToPython;
  const [cmd, ...rest] = argv;
  if (cmd === undefined || !(TS_COMMANDS as readonly string[]).includes(cmd)) {
    // 未知命令也走這條:Python 的 argparse 會印出 usage 與合法命令清單並回 2,
    // 那正是現行行為,不需要在這裡另外複製一份。
    return delegate(argv);
  }
  if (cmd === "status") {
    const file = flag(rest, "--file");
    if (file === undefined) {
      process.stderr.write("status requires --file\n");
      return 2;
    }
    return cmdStatus(file);
  }
  // TS_COMMANDS 列了但這裡沒分派 —— cli.test.ts 的一致性測試會先擋下
  process.stderr.write(`unrouted command: ${cmd}\n`);
  return 2;
}

/**
 * bin/devloop 直接執行這個檔;測試則是 import 它。沒有這個守衛,import 會在
 * 載入當下就跑掉 main() 並呼叫 process.exit,整個測試程序就死了。
 *
 * 必須比 realpath,不能只比 resolve():plugin 常常是經由 symlink 安裝的
 * (marketplace 連結、本機開發連結),而 node 解析模組時會把 import.meta.url
 * 正規化成實體路徑,argv[1] 卻保留使用者走的那條 symlink 路徑。實測過:
 * symlink 目錄下兩者不相等,守衛不成立,main() 不會執行——CLI 什麼都不印、
 * 回 0,而且沒有任何錯誤訊息。
 */
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === b;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && samePath(invokedPath, fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
```

`realpathSync` 要從 `node:fs` import(與 `spawnSync` 那行併排)。

- [ ] **Step 2: 改 `bin/devloop`,刪 `bin/devloop-ts`**

`plugins/dev-loop/bin/devloop` 全檔改成:

```bash
#!/usr/bin/env bash
# dev-loop 引擎 wrapper:自定位 plugin 根(bin/ 的上一層),轉呼叫 TS 引擎。
# TS 認得的子命令由它自己處理,其餘由 cli.ts 委派回 python3 -m devloop.cli
# (PYTHONPATH 也在那裡設)。dist/cli.js 是 commit 進版控的自足 bundle,
# 使用者不需要跑 npm install。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = plugins/dev-loop
exec node "$ROOT/dist/cli.js" "$@"
```

```bash
git rm plugins/dev-loop/bin/devloop-ts
```

`bin/devloop-ts` 是 M1 為了不覆蓋當時的 Python wrapper 而做的暫時進入點,現在 `bin/devloop` 本身就是它,留著只會有兩個真理來源。

- [ ] **Step 3: 改 `cli.test.ts`**

`plugins/dev-loop/src/cli.test.ts` 目前的 `WRAPPER` 常數指向 `bin/devloop-ts`:

```typescript
const WRAPPER = join(process.cwd(), "bin", "devloop-ts");
```

改成:

```typescript
const WRAPPER = join(process.cwd(), "bin", "devloop");
```

並把測試名稱裡的 `bin/devloop-ts` 一併改成 `bin/devloop`。

- [ ] **Step 4: 加路由一致性測試**

在 `plugins/dev-loop/src/cli.test.ts` 追加:

```typescript
import { TS_COMMANDS, main } from "./cli.js";

describe("command routing", () => {
  it("routes every command it does not own to Python", () => {
    const seen: string[][] = [];
    const rc = main(["event", "--file", "x", "--event", "apply_done"], {
      delegate: (argv) => { seen.push(argv); return 7; },
    });
    expect(rc).toBe(7);
    expect(seen).toEqual([["event", "--file", "x", "--event", "apply_done"]]);
  });

  it("routes an unknown command to Python rather than inventing its own error", () => {
    // Python 的 argparse 已經會印 usage 與合法命令清單並回 2;TS 自己再寫一份
    // 只會多一個會漂移的真理來源。
    const seen: string[][] = [];
    main(["nosuch"], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(seen).toEqual([["nosuch"]]);
  });

  it("routes no-args to Python", () => {
    const seen: string[][] = [];
    main([], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(seen).toEqual([[]]);
  });

  it("every command it claims is actually dispatched", () => {
    // 清單少列一個已實作的命令,呼叫會靜默走 Python——功能正常,但「已移植」
    // 是假的。這條測試是唯一會發現這件事的東西。
    for (const cmd of TS_COMMANDS) {
      let delegated = false;
      main([cmd], { delegate: () => { delegated = true; return 0; } });
      expect(delegated, `${cmd} is in TS_COMMANDS but fell through to Python`).toBe(false);
    }
  });
});
```

`main([cmd])` 對 `status` 會走缺 `--file` 的分支回 2 並印 stderr,不會 delegate——正是這條測試要驗的。

- [ ] **Step 5: 加委派鏈的端對端 smoke test**

在 `plugins/dev-loop/src/cli.test.ts` 追加。這條路徑沒有任何單元測試覆蓋得到,而它現在是所有未移植命令的唯一通路:

```typescript
describe("delegation to the Python engine", () => {
  it("runs a not-yet-ported command end to end through bin/devloop", () => {
    // 走真的 wrapper、真的 node、真的 python3。PYTHONPATH 設錯的話這裡會
    // ModuleNotFoundError,而不是靜靜地過。
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    const p = join(dir, "cp.json");
    writeFileSync(
      p,
      JSON.stringify({ phase: "apply", change_id: "c", branch: "b", iteration: 0 }),
      "utf-8",
    );
    const out = execFileSync(WRAPPER, ["event", "--file", p, "--event", "apply_done"], {
      encoding: "utf-8",
    });
    expect(out).toContain("phase=gate");
  });

  it("passes the Python exit code through", () => {
    // 不存在的子命令:argparse 回 2
    let status: number | undefined;
    try {
      execFileSync(WRAPPER, ["nosuch-command"], { encoding: "utf-8", stdio: "pipe" });
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(2);
  });
});
```

若這台機器沒有 `python3`,這兩條會失敗——那是正確的,委派鏈本來就需要它。

- [ ] **Step 6: 把 node 列為硬前置**

`plugins/dev-loop/bin/check-deps.sh` 的硬前置區塊:

```bash
missing=()
command -v python3  >/dev/null 2>&1 || missing+=("python3")
command -v git      >/dev/null 2>&1 || missing+=("git")
command -v openspec >/dev/null 2>&1 || missing+=("openspec(npm i -g @fission-ai/openspec)")
```

改成(node 排在最前面,因為 `bin/devloop` 現在第一件事就是呼叫它):

```bash
missing=()
# node 是引擎進入點:bin/devloop 直接 exec node dist/cli.js,缺它連未移植的
# 子命令都跑不到(它們是由 TS 委派回 python3 的)。
command -v node     >/dev/null 2>&1 || missing+=("node(18+)")
command -v python3  >/dev/null 2>&1 || missing+=("python3")
command -v git      >/dev/null 2>&1 || missing+=("git")
command -v openspec >/dev/null 2>&1 || missing+=("openspec(npm i -g @fission-ai/openspec)")
```

- [ ] **Step 7: 同步 README**

`README.md` 第 62 行:

```
前置:`python3`(3.10+)、`git`、`openspec`(`npm i -g @fission-ai/openspec`)。
```

改成:

```
前置:`node`(18+)、`python3`(3.10+)、`git`、`openspec`(`npm i -g @fission-ai/openspec`)。引擎正在從 Python 遷移到 TypeScript,兩者目前都需要:`bin/devloop` 由 node 進入,尚未遷移的子命令由它委派回 `python3`。
```

`tests/test_docs_consistency.py` 目前只斷言 README 提到可選工具與 `.code-review-graph/`,沒有斷言前置清單,所以這一步不需要動它。仍然跑一次 `make test` 確認。

- [ ] **Step 8: 跑兩側 + lint + 手動驗 wrapper**

Run: `make test`
Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: 皆 PASS

手動確認 wrapper 兩條路都通:

```bash
cd /tmp && rm -rf devloop-smoke && mkdir devloop-smoke && cd devloop-smoke
PLUGIN=/Users/tliang/workspace/claude/code/dev-loop/plugins/dev-loop
mkdir -p .devloop
python3 -c "import sys; sys.path.insert(0,'$PLUGIN'); from devloop.checkpoint import Checkpoint; Checkpoint(phase='apply', change_id='c', branch='b').save('.devloop/cp.json')"
"$PLUGIN/bin/devloop" status --file .devloop/cp.json          # TS 自己處理
"$PLUGIN/bin/devloop" event --file .devloop/cp.json --event apply_done   # 委派回 Python
"$PLUGIN/bin/devloop" nosuch-command; echo "rc=$?"            # 委派後 argparse 回 2
```

Expected:第一條印 `phase=apply` 與 `next:` 兩行;第二條印 `phase=gate iteration=0`;第三條印 argparse 的 usage 且 `rc=2`。

再驗一次 symlink 情境——plugin 常常是這樣安裝的,而這正是上面那個 `samePath` 守衛存在的理由:

```bash
ln -sfn "$PLUGIN" /tmp/devloop-linked
/tmp/devloop-linked/bin/devloop status --file .devloop/cp.json
```

Expected:輸出與直接呼叫完全相同。若什麼都沒印且 `rc=0`,就是守衛的路徑比對失敗——停下來回報,不要改成忽略守衛。

- [ ] **Step 9: 確認 bundle 已更新且進版控**

`cli.ts` 改了,而 `cli.ts` 是 bundle 的進入點,所以 `dist/cli.js` **必須**有變動。

Run(在 `plugins/dev-loop/`):`npm run bundle`
Run(在 repo 根):`git status --porcelain plugins/dev-loop/dist`
Expected: 顯示 `dist/cli.js` 已修改。若**沒有**變動,停下來回報——那表示 bundle 沒有反映 `src/` 的改動,交付會壞掉。

- [ ] **Step 10: Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/bin/devloop plugins/dev-loop/bin/check-deps.sh \
        plugins/dev-loop/dist/cli.js README.md
git rm --cached plugins/dev-loop/bin/devloop-ts 2>/dev/null || true
git commit -m "feat(ts): make the TypeScript engine the front door

bin/devloop now execs node dist/cli.js. Until this commit the TypeScript CLI
had never once been invoked by the plugin — even status went to Python — so
everything built since M1 was exercised only by its own tests.

Commands the TypeScript engine does not own are delegated back to
python3 -m devloop.cli with stdio inherited and the exit code passed through,
so the orchestration layer sees no change at all. The routing table lives in
TypeScript rather than the bash wrapper: it is typed, it is tested against
what main() actually dispatches, and M2c retires it by deleting a branch.

The failure mode this guards against is a stale bundle silently falling
through to Python — the command still works, so 'ported' quietly becomes a
lie. One test asserts every claimed command is really dispatched."
```

---

### Task 5: 接上三個子命令 + CLI parity fixture

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`
- Create: `fixtures/parity/cli.json`
- Create: `tests/test_parity_cli.py`
- Create: `plugins/dev-loop/src/parity.cli.test.ts`
- Modify: `tests/test_parity_manifest.py`、`plugins/dev-loop/src/parity.manifest.test.ts`

**Interfaces:**
- Consumes:Task 1 的 `pendingUnits`、Task 3 的 `archiveWorkfiles`、M2a 的 `archiveChange`(`./openspec.js`)、`loadConfig`/`resolveModel`(`./config.js`)、`loadCheckpoint`(`./checkpoint.js`)、Task 4 的 `main`/`TS_COMMANDS`/`CliDeps`
- Produces:`CliDeps` 多一個 `archiveChange` 欄位;`TS_COMMANDS` 變成 `["status", "archive", "units-status", "model"]`

- [ ] **Step 1: 加三個命令**

`plugins/dev-loop/src/cli.ts`:

`TS_COMMANDS` 改成:

```typescript
export const TS_COMMANDS = ["status", "archive", "units-status", "model"] as const;
```

`CliDeps` 改成:

```typescript
export interface CliDeps {
  delegate: (argv: string[]) => number;
  // archive 會真的呼叫 openspec CLI,測試要能換掉它。Python 那側是
  // monkeypatch cli.archive_change,這裡用注入達到同一件事。
  archiveChange: (changeId: string) => OpenSpecResult;
}
```

加上 import:

```typescript
import { archiveChange } from "./openspec.js";
import type { OpenSpecResult } from "./openspec.js";
import { archiveWorkfiles } from "./housekeeping.js";
import { pendingUnits, type Unit } from "./units.js";
import { loadConfig, resolveModel } from "./config.js";
import { join } from "node:path";
```

(`join` 與既有的 `dirname`/`resolve` 併成同一行 import。)

三個命令實作:

```typescript
/**
 * merge 階段歸檔:openspec archive 成功後才收工作檔。
 *
 * 失敗語意是刻意的:openspec archive 失敗回 1;工作檔歸檔失敗只印 warning、
 * 回 0——後者是清理,不該反噬前者已經完成的歸檔結果。
 */
function cmdArchive(file: string, archive: (changeId: string) => OpenSpecResult): number {
  const cp = loadCheckpoint(file);
  const result = archive(cp.change_id);
  process.stdout.write(`${result.output}\n`);
  if (!result.ok) {
    return 1;
  }
  try {
    const archived = archiveWorkfiles(file, cp.change_id);
    process.stdout.write(
      `archived workfiles: ${archived.length} -> ${join(dirname(file), "archive", cp.change_id)}\n`,
    );
  } catch (exc) {
    process.stderr.write(`warning: workfile archive failed: ${String(exc)}\n`);
  }
  return 0;
}

function cmdUnitsStatus(file: string): number {
  const cp = loadCheckpoint(file);
  const units = cp.units as unknown as Unit[];
  for (const u of units) {
    process.stdout.write(`${u.id} ${u.status}\n`);
  }
  const pend = pendingUnits(units).map((u) => u.id);
  process.stdout.write(`pending: ${pend.length > 0 ? pend.join(",") : "-"}\n`);
  return 0;
}

/**
 * 階段 model 決議(dispatch subagent 前查詢):印 alias 或 inherit。
 * 決策真理來源在引擎(resolveModel),SKILL 只照做;config 非法 exit 2。
 */
function cmdModel(stage: string, configPath: string): number {
  let alias: string | null;
  try {
    alias = resolveModel(stage, loadConfig(configPath));
  } catch (exc) {
    process.stderr.write(`error: ${exc instanceof Error ? exc.message : String(exc)}\n`);
    return 2;
  }
  process.stdout.write(`${alias ?? "inherit"}\n`);
  return 0;
}
```

`main` 的分派追加:

```typescript
  if (cmd === "archive") {
    const file = flag(rest, "--file");
    if (file === undefined) {
      process.stderr.write("archive requires --file\n");
      return 2;
    }
    return cmdArchive(file, deps.archiveChange ?? archiveChange);
  }
  if (cmd === "units-status") {
    const file = flag(rest, "--file");
    if (file === undefined) {
      process.stderr.write("units-status requires --file\n");
      return 2;
    }
    return cmdUnitsStatus(file);
  }
  if (cmd === "model") {
    const stage = flag(rest, "--stage");
    if (stage === undefined) {
      process.stderr.write("model requires --stage\n");
      return 2;
    }
    // Python 的 --config 預設值
    return cmdModel(stage, flag(rest, "--config") ?? ".devloop/config.json");
  }
```

**注意 `model` 的錯誤 exit code**:Python 的 `--stage` 有 `choices=(...)`,非法值由 argparse 擋下回 2;這裡沒有 choices,非法 stage 會走到 `resolveModel` 拋錯、被 catch 後同樣回 2。exit code 相同,stderr 文字不同——這是允許的(見下方 fixture 的說明)。

- [ ] **Step 2: 寫 cli fixture**

建立 `fixtures/parity/cli.json`。只涵蓋 `units-status` 與 `model`——兩者完全 hermetic,不需要任何測試替身。`archive` 要呼叫 openspec,改用兩側各自的注入測試(Step 5)。

`expect` 只比對 `stdout` 與 `exit_code`。**不比對 stderr 文字**:Python 走 argparse、TS 走手寫解析,參數層的錯誤訊息本來就不同,而 SKILL.md 不解析它們。

```json
{
  "unitsStatus": [
    {
      "name": "lists each unit and the pending set",
      "checkpoint": {
        "phase": "apply", "change_id": "c1", "branch": "feat/x",
        "units": [
          { "id": "g1", "status": "pending" },
          { "id": "g2", "status": "done" }
        ]
      },
      "argv": ["units-status", "--file", "<CHECKPOINT>"],
      "expect": { "stdout": "g1 pending\ng2 done\npending: g1\n", "exit_code": 0 }
    },
    {
      "name": "prints a dash when nothing is pending",
      "checkpoint": {
        "phase": "apply", "change_id": "c1", "branch": "b",
        "units": [{ "id": "g1", "status": "done" }]
      },
      "argv": ["units-status", "--file", "<CHECKPOINT>"],
      "expect": { "stdout": "g1 done\npending: -\n", "exit_code": 0 }
    },
    {
      "name": "a checkpoint with no units prints only the pending line",
      "checkpoint": { "phase": "apply", "change_id": "c1", "branch": "b" },
      "argv": ["units-status", "--file", "<CHECKPOINT>"],
      "expect": { "stdout": "pending: -\n", "exit_code": 0 }
    }
  ],

  "model": [
    {
      "name": "budget profile routes apply to sonnet",
      "config": { "model_profile": "budget" },
      "argv": ["model", "--stage", "apply", "--config", "<CONFIG>"],
      "expect": { "stdout": "sonnet\n", "exit_code": 0 }
    },
    {
      "name": "budget profile leaves review inheriting",
      "config": { "model_profile": "budget" },
      "argv": ["model", "--stage", "review", "--config", "<CONFIG>"],
      "expect": { "stdout": "inherit\n", "exit_code": 0 }
    },
    {
      "name": "an explicit models override wins",
      "config": { "model_profile": "budget", "models": { "apply": "opus" } },
      "argv": ["model", "--stage", "apply", "--config", "<CONFIG>"],
      "expect": { "stdout": "opus\n", "exit_code": 0 }
    },
    {
      "name": "no profile means inherit",
      "config": {},
      "argv": ["model", "--stage", "apply", "--config", "<CONFIG>"],
      "expect": { "stdout": "inherit\n", "exit_code": 0 }
    },
    {
      "name": "a missing config file means inherit",
      "config_absent": true,
      "argv": ["model", "--stage", "apply", "--config", "<CONFIG>"],
      "expect": { "stdout": "inherit\n", "exit_code": 0 }
    },
    {
      "name": "an invalid config exits 2 without printing a model",
      "config": { "model_profile": "cheap" },
      "argv": ["model", "--stage", "apply", "--config", "<CONFIG>"],
      "expect": { "stdout": "", "exit_code": 2 }
    }
  ]
}
```

`<CHECKPOINT>` 與 `<CONFIG>` 是佔位符,兩側的消費者各自替換成自己建的臨時檔路徑。

- [ ] **Step 3: 寫 Python 側消費者**

建立 `tests/test_parity_cli.py`:

```python
import json

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.checkpoint import Checkpoint
from devloop.cli import main

SECTIONS = ["unitsStatus", "model"]


def _argv(case, tmp_path):
    """把 fixture 的佔位符換成本次的臨時檔路徑,順便把檔案建出來。"""
    subs = {}
    if "checkpoint" in case:
        p = tmp_path / "cp.json"
        Checkpoint(**case["checkpoint"]).save(p)
        subs["<CHECKPOINT>"] = str(p)
    if "config" in case:
        p = tmp_path / "config.json"
        p.write_text(json.dumps(case["config"]), encoding="utf-8")
        subs["<CONFIG>"] = str(p)
    if case.get("config_absent"):
        subs["<CONFIG>"] = str(tmp_path / "absent.json")
    return [subs.get(a, a) for a in case["argv"]]


def _run(case, tmp_path, capsys):
    code = main(_argv(case, tmp_path))
    return {"stdout": capsys.readouterr().out, "exit_code": code}


@pytest.mark.parametrize("case", parity_cases("cli", "unitsStatus", SECTIONS))
def test_units_status_cli_parity(case, tmp_path, capsys):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "cli cases assert on exit codes, not exceptions"
    assert_subset(_run(case, tmp_path, capsys), expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("cli", "model", SECTIONS))
def test_model_cli_parity(case, tmp_path, capsys):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "cli cases assert on exit codes, not exceptions"
    assert_subset(_run(case, tmp_path, capsys), expect, case["name"])
```

- [ ] **Step 4: 寫 TS 側消費者**

建立 `plugins/dev-loop/src/parity.cli.test.ts`。TS 這側用子行程跑真的 `dist/cli.js`——這樣連 bundle 是否包含新命令都一併驗到了:

```typescript
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";

const SECTIONS = ["unitsStatus", "model"];
const CLI = join(process.cwd(), "dist", "cli.js");

const CHECKPOINT_DEFAULTS = {
  iteration: 0, last_artifact: "", non_blocking: [], updated_at: "",
  resume_exec: null, units: [], review_legs: [], propose_attempts: 0,
  gate_failures: 0, finish_mode: null, flow_profile: "full", needs_uiux: false,
};

function argvFor(c: ParityCase): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cli-parity-"));
  mkdirSync(dir, { recursive: true });
  const subs: Record<string, string> = {};
  if (c.checkpoint !== undefined) {
    const p = join(dir, "cp.json");
    // Python 側是 Checkpoint(**case["checkpoint"]),欄位會補上 dataclass 預設值;
    // 這裡補同一份,否則 loadCheckpoint 會因缺欄位而拒收。
    writeFileSync(p, JSON.stringify({ ...CHECKPOINT_DEFAULTS, ...(c.checkpoint as object) }), "utf-8");
    subs["<CHECKPOINT>"] = p;
  }
  if (c.config !== undefined) {
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify(c.config), "utf-8");
    subs["<CONFIG>"] = p;
  }
  if (c.config_absent === true) {
    subs["<CONFIG>"] = join(dir, "absent.json");
  }
  return (c.argv as string[]).map((a) => subs[a] ?? a);
}

function run(argv: string[]): { stdout: string; exit_code: number } {
  try {
    return { stdout: execFileSync("node", [CLI, ...argv], { encoding: "utf-8" }), exit_code: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", exit_code: err.status ?? 1 };
  }
}

for (const section of SECTIONS) {
  describe(`parity: cli ${section}`, () => {
    for (const c of parityCases("cli", section, SECTIONS)) {
      it(c.name, () => {
        const { expect: want, throws } = resolveExpectation(c);
        expect(throws, "cli cases assert on exit codes, not exceptions").toBe(false);
        expectSubset(run(argvFor(c)), want!, c.name);
      });
    }
  });
}
```

- [ ] **Step 5: 加 `archive` 的兩側注入測試**

`archive` 會呼叫 openspec CLI,所以不進 fixture。兩側各寫一組,涵蓋同一批情境。

`plugins/dev-loop/src/cli.test.ts` 追加:

```typescript
import { main } from "./cli.js";

describe("archive", () => {
  function checkpointAt(dir: string, changeId: string): string {
    const p = join(dir, "checkpoint.json");
    writeFileSync(
      p,
      JSON.stringify({ phase: "merge", change_id: changeId, branch: "b" }),
      "utf-8",
    );
    return p;
  }

  it("archives the change, then sweeps the workfiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "add-foo");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const seen: string[] = [];
    const rc = main(["archive", "--file", cp], {
      archiveChange: (id) => {
        seen.push(id);
        return { ok: true, command: ["openspec", "archive", id], output: "archived" };
      },
    });
    expect(rc).toBe(0);
    expect(seen).toEqual(["add-foo"]);
    expect(readdirSync(join(dir, "archive", "add-foo")).sort())
      .toEqual(["checkpoint.json", "r.json"]);
  });

  it("returns 1 and sweeps nothing when the openspec archive fails", () => {
    // 失敗語意是刻意的:openspec 沒歸檔成功就不該動工作檔
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "x");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const rc = main(["archive", "--file", cp], {
      archiveChange: (id) => ({ ok: false, command: ["openspec", "archive", id], output: "nope" }),
    });
    expect(rc).toBe(1);
    expect(existsSync(join(dir, "archive"))).toBe(false);
  });
});
```

(需要補 `readdirSync`、`existsSync` 的 import。)

Python 那側已有 `test_archive_subcommand` 與 `test_archive_failure_returns_1`。讀 `tests/test_cli.py` 確認它們涵蓋的情境與上面兩條一致;Python 若缺「失敗時不動工作檔」的斷言,補上去——**不改 Python 實作**。

- [ ] **Step 6: 把 `cli` 加進兩側 manifest 清單**

同前,`CONSUMED_MODULES` 兩邊都加入 `cli`。

- [ ] **Step 7: 重打包並確認 bundle 變動**

Run(在 `plugins/dev-loop/`):`npm run bundle`
Run(在 repo 根):`git status --porcelain plugins/dev-loop/dist`
Expected: `dist/cli.js` 已修改(三個命令與其相依模組現在都進 bundle 了)。

沒有變動就停下來回報。

- [ ] **Step 8: 跑兩側 + lint**

Run: `make test`
Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: 皆 PASS

- [ ] **Step 9: 驗證非空轉**

暫時把 `cli.json` 裡 `"prints a dash when nothing is pending"` 的預期 stdout 改成 `"g1 done\npending: g1\n"`,兩側各跑一次,確認都紅在同一個 case 名稱,再改回。

- [ ] **Step 10: 手動端對端驗收**

```bash
cd /tmp && rm -rf devloop-e2e && mkdir devloop-e2e && cd devloop-e2e
PLUGIN=/Users/tliang/workspace/claude/code/dev-loop/plugins/dev-loop
mkdir -p .devloop
python3 -c "
import sys, json; sys.path.insert(0,'$PLUGIN')
from devloop.checkpoint import Checkpoint
Checkpoint(phase='apply', change_id='c1', branch='feat/x',
           units=[{'id':'g1','status':'pending'},{'id':'g2','status':'done'}]).save('.devloop/cp.json')
open('.devloop/config.json','w').write(json.dumps({'model_profile':'budget'}))
"
"$PLUGIN/bin/devloop" units-status --file .devloop/cp.json
"$PLUGIN/bin/devloop" model --stage apply --config .devloop/config.json
"$PLUGIN/bin/devloop" model --stage review --config .devloop/config.json
```

Expected:依序印出 `g1 pending` / `g2 done` / `pending: g1`、`sonnet`、`inherit`。

同一批命令用 Python 直接跑一次比對:

```bash
PYTHONPATH="$PLUGIN" python3 -m devloop.cli units-status --file .devloop/cp.json
PYTHONPATH="$PLUGIN" python3 -m devloop.cli model --stage apply --config .devloop/config.json
```

Expected:輸出逐字相同。

- [ ] **Step 11: Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/src/parity.cli.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        plugins/dev-loop/dist/cli.js \
        fixtures/parity/cli.json tests/test_parity_cli.py tests/test_parity_manifest.py \
        tests/test_cli.py
git commit -m "feat(ts): serve archive, units-status and model from TypeScript

These are the three subcommands that never touch the watcher, so they can
move without dragging in a detached process spawn. archive is the first time
M2a's openspec module runs in production rather than in its own tests.

Adds a CLI-level parity fixture. Module-level parity being green says nothing
about the CLI layer, and the CLI layer is what SKILL.md actually parses —
output format, error text and exit codes are all contract. It pins stdout and
exit code verbatim; stderr is excluded because argparse and a hand-written
parser word argument errors differently and nothing reads those.

archive stays out of the fixture and gets injected test doubles on both sides
instead: it shells out to openspec, and a fixture case that needs a stub is a
fixture case that is lying about what it pinned."
```

---

## Self-Review

**1. Spec coverage**

| Spec 要求 | 對應 |
|---|---|
| 移植 `units` | Task 1 |
| 移植 `review` | Task 2 |
| 移植 `housekeeping` | Task 3 |
| `bin/devloop` 改 exec node | Task 4 Step 2 |
| TS 委派未移植命令回 Python,透傳 exit code、signal 回 128+n | Task 4 Step 1 |
| 路由表在 TS、有一致性測試 | Task 4 Step 1、Step 4 |
| node 列硬前置、README 同步 | Task 4 Step 6、Step 7 |
| 接 `archive` | Task 5 Step 1、Step 5 |
| 接 `units-status`、`model` | Task 5 Step 1、fixture |
| `units.json` fixture(含 `all_done([])`) | Task 1 Step 3 |
| `review.json` fixture(含 design>proposal、缺 severity、六種拒收) | Task 2 Step 2 |
| `housekeeping` 兩側對照測試(順序、rename、mtime) | Task 3 Step 2、Step 3、Step 5 |
| `cli.json` fixture 逐字 stdout + exit code | Task 5 Step 2 |
| 委派鏈端對端 smoke test | Task 4 Step 5 |
| `archive` 失敗語意(openspec 失敗回 1、housekeeping 失敗只 warning) | Task 5 Step 1、Step 5 |

**與 spec 的一處偏離**:spec 說 `cli.json` 涵蓋「三個接上的子命令」,實作只涵蓋 `units-status` 與 `model`。理由:`archive` 必須呼叫 openspec CLI,fixture 沒有表達測試替身的欄位,硬塞會讓 fixture 開始描述 mock 而不是行為。改以兩側各自的注入測試涵蓋,涵蓋範圍不減。已在 Task 5 Step 2 與 commit message 註明。

**2. Placeholder scan** —— 無 TBD、無「類似 Task N」、無只描述不給程式碼的步驟。每個新檔都有完整內容;既有檔的修改都指明了原文與改後文字。

**3. Type consistency** —— `Unit` 在 Task 1 定義,Task 5 的 `cmdUnitsStatus` 以同一型別消費;`CliDeps` 在 Task 4 定義為只有 `delegate`,Task 5 明文擴充為兩個欄位;`OpenSpecResult` 沿用 `openspec.ts` 既有匯出;`TS_COMMANDS` 在 Task 4 是 `["status"]`,Task 5 改為四個並由同一條一致性測試守住。`pyIndex` 在 Task 1 Step 1 定義,Task 1 Step 2 使用。

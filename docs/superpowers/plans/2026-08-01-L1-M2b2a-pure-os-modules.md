# L1 M2b-2a Implementation Plan:五個純模組(shlex / worktree / gate / adapter / teardown)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M2b-2 範圍內「給定注入的接縫後就是純函式」的五個對象移植到 TypeScript,每個都配 parity fixture。

**Architecture:** 一個 task 一個對象,各自獨立。不接任何 CLI 子命令——`watcher` 模組、CLI backbone 與六個命令留給 M2b-2b。

**Tech Stack:** TypeScript 6 / vitest;Python 3.10+ / pytest。不新增任何依賴。

**Spec:** `docs/superpowers/specs/2026-08-01-L1-M2b2-os-facing-modules-and-cli-backbone-design.md`

## Global Constraints

- **Python 行為為準。** 本 plan 所有預期值都已對現行實作實測。若實作與 plan 不符,**先停下來回報**,不要自行改預期值也不要改實作。
- **不修改任何 Python 實作檔**(`plugins/dev-loop/devloop/*.py`)。
- **fixture 是兩引擎共用的單一真理**(契約見 `fixtures/parity/README.md`):新 case 只加進 fixture 檔,絕不只改一側的測試檔;真的兩邊行為不同要先裁決、寫 `divergence_reason` + `py`/`ts` 區塊,不准靠放寬某側的 expect 讓測試變綠。
- **移植時四個直譯都不安全**,`jsonio.ts` 有對應 helper:`Boolean(x)` → `pyTruthy`、`x ?? d` → `pyGet`、`obj.k` → `pyIndex`,本 plan Task 2 新增第四個(`Path.resolve` 的語意)。
- pytest 從 repo 根跑:`make test`。vitest 從 `plugins/dev-loop/` 跑:`npm test`。兩者都必須綠,`npm run lint` 也是。
- TS:ESM + NodeNext,**相對 import 必須帶 `.js` 副檔名**;`strict: true`;eslint 掃 `src`,**禁止 `any`**。
- **絕不手動複製任何東西進 `plugins/dev-loop/dist/`。** 本 plan 移植的模組都不在 `cli.ts` 的相依樹上,所以 `dist/cli.js` **不該有變動**;若有,停下來回報。
- 不新增依賴,不動 `package.json`。
- 每個 task 都要把新模組加進兩側的 `CONSUMED_MODULES`(`tests/test_parity_manifest.py` 與 `plugins/dev-loop/src/parity.manifest.test.ts`),**兩邊都改**。

---

## File Structure

| 檔案 | 責任 | Task |
|---|---|---|
| `plugins/dev-loop/src/shlex.ts` + `.test.ts` | POSIX shlex split/join | 1 |
| `fixtures/parity/shlex.json` + 兩側消費者 | | 1 |
| `plugins/dev-loop/src/pypath.ts` + `.test.ts` | `Path.resolve` 的 Python 語意 | 2 |
| `plugins/dev-loop/src/worktree.ts` + `.test.ts` | git worktree 操作與清單解析 | 2 |
| `fixtures/parity/worktree.json` + 兩側消費者 | | 2 |
| `plugins/dev-loop/src/gate.ts` + `.test.ts` | 依序執行 gate 命令、短路 | 3 |
| `fixtures/parity/gate.json` + 兩側消費者 | | 3 |
| `plugins/dev-loop/src/adapter.ts` + `.test.ts` | watcher 重試迴圈 | 4 |
| `fixtures/parity/adapter.json` + 兩側消費者 | | 4 |
| `plugins/dev-loop/src/teardown.ts` + `.test.ts` | 四個 idempotent 清殘留函式 | 5 |
| `fixtures/parity/teardown.json` + 兩側消費者 | | 5 |

---

### Task 1: shlex

本輪最高風險。`resume_exec`(典型值 `claude -p '/dev-loop resume'`)要被 split 成 argv、join 回字串、再 split 一次;`gate` 也用 `shlex.split` 把每條 gate 命令切成 argv。切錯的後果是無人看管的背景行程永遠跑錯命令,或 gate 假失敗把 loop 推去 fix。

**Files:**
- Create: `plugins/dev-loop/src/shlex.ts`
- Create: `plugins/dev-loop/src/shlex.test.ts`
- Create: `fixtures/parity/shlex.json`
- Create: `tests/test_parity_shlex.py`
- Create: `plugins/dev-loop/src/parity.shlex.test.ts`
- Modify: 兩側 `CONSUMED_MODULES`

**Interfaces:**
- Produces:
  - `shlexSplit(s: string): string[]` —— 對應 `shlex.split(s)`(POSIX 模式)
  - `shlexJoin(parts: string[]): string` —— 對應 `shlex.join(parts)`
  - `shlexQuote(s: string): string` —— 對應 `shlex.quote(s)`,`shlexJoin` 的單元
- Task 3(gate)與 M2b-2b(watcher / watch 命令)都會用。

- [ ] **Step 1: 寫 shlex 模組**

建立 `plugins/dev-loop/src/shlex.ts`:

```typescript
/**
 * Python `shlex` 的 POSIX 子集,只涵蓋本專案用到的三個函式。
 *
 * 為什麼要自己寫:Node 沒有 shlex,而 resume_exec(`claude -p '/dev-loop resume'`)
 * 要走 split → join → split 三道,gate 也用 split 把每條命令切成 argv。切錯的後果
 * 是背景 watcher 永遠跑錯命令(輸出只進 watcher-log.jsonl,沒人當場看得到),
 * 或 gate 假失敗把 loop 推去 fix 而不是報告工具問題。
 *
 * 範圍:POSIX 模式(Python 的 shlex.split 預設 posix=True)。不做 Windows 語意。
 */

/**
 * Python `shlex.quote` 的安全字元集。其餘一律加單引號——**包含非 ASCII**,
 * 所以 `中文` 會變成 `'中文'`。這點容易漏:憑直覺寫的實作多半只對含空白的
 * 字串加引號,往返仍然成立,但 join 的輸出與 Python 不同字。
 */
const SAFE = /^[a-zA-Z0-9_@%+=:,./-]+$/;

export function shlexQuote(s: string): string {
  if (s === "") {
    return "''";
  }
  if (SAFE.test(s)) {
    return s;
  }
  // Python: "'" + s.replace("'", "'\"'\"'") + "'"
  return "'" + s.replace(/'/g, `'"'"'`) + "'";
}

export function shlexJoin(parts: string[]): string {
  return parts.map(shlexQuote).join(" ");
}

/**
 * Python `shlex.split(s)`(posix=True, comments=False)。
 *
 * 規則:空白分隔;單引號內一切原樣(含反斜線);雙引號內反斜線只逃逸
 * `"` 與 `\` 本身,其餘保留;引號外反斜線逃逸下一個字元。空字串與純空白
 * 回空陣列。未閉合的引號拋錯(Python 是 ValueError: No closing quotation)。
 */
export function shlexSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false; // 區分「空 token」(來自 '' 或 "")與「還沒開始」
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
      i += 1;
      continue;
    }
    started = true;
    if (c === "'") {
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) {
        throw new Error("No closing quotation");
      }
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      let closed = false;
      while (i < s.length) {
        const d = s[i]!;
        if (d === "\\" && i + 1 < s.length && (s[i + 1] === '"' || s[i + 1] === "\\")) {
          cur += s[i + 1];
          i += 2;
          continue;
        }
        if (d === '"') {
          closed = true;
          i += 1;
          break;
        }
        cur += d;
        i += 1;
      }
      if (!closed) {
        throw new Error("No closing quotation");
      }
      continue;
    }
    if (c === "\\") {
      if (i + 1 < s.length) {
        cur += s[i + 1];
        i += 2;
      } else {
        // 尾端單一反斜線:Python posix 模式視為逃逸不完整,拋 ValueError
        throw new Error("No escaped character");
      }
      continue;
    }
    cur += c;
    i += 1;
  }
  if (started) {
    out.push(cur);
  }
  return out;
}
```

- [ ] **Step 2: 寫 shlex fixture**

建立 `fixtures/parity/shlex.json`。三個 section 皆已對 Python 實測:

```json
{
  "split": [
    { "name": "the real resume command with single quotes",
      "input": "claude -p '/dev-loop resume'",
      "expect": { "value": ["claude", "-p", "/dev-loop resume"] } },
    { "name": "the same with double quotes",
      "input": "claude -p \"/dev-loop resume\"",
      "expect": { "value": ["claude", "-p", "/dev-loop resume"] } },
    { "name": "plain words", "input": "echo hello",
      "expect": { "value": ["echo", "hello"] } },
    { "name": "empty string yields no tokens", "input": "",
      "expect": { "value": [] } },
    { "name": "whitespace only yields no tokens", "input": "  ",
      "expect": { "value": [] } },
    { "name": "tabs separate tokens too", "input": "cmd\ttab\tsep",
      "expect": { "value": ["cmd", "tab", "sep"] } },
    { "name": "double quotes preserve inner spaces", "input": "a \"b c\" d",
      "expect": { "value": ["a", "b c", "d"] } },
    { "name": "single quotes preserve runs of spaces", "input": "a 'b  c' d",
      "expect": { "value": ["a", "b  c", "d"] } },
    { "name": "apostrophe inside double quotes", "input": "echo \"it's\"",
      "expect": { "value": ["echo", "it's"] } },
    { "name": "backslash escapes a quote outside quotes", "input": "echo it\\'s",
      "expect": { "value": ["echo", "it's"] } },
    { "name": "backslash escapes a space", "input": "echo a\\ b",
      "expect": { "value": ["echo", "a b"] } },
    { "name": "backslash escapes a double quote inside double quotes",
      "input": "echo \"a\\\"b\"",
      "expect": { "value": ["echo", "a\"b"] } },
    { "name": "non-ascii words are ordinary", "input": "echo 中文 參數",
      "expect": { "value": ["echo", "中文", "參數"] } },
    { "name": "quoted value attached to a flag",
      "input": "cmd --flag=\"v with space\"",
      "expect": { "value": ["cmd", "--flag=v with space"] } },
    { "name": "unclosed single quote is rejected", "input": "echo 'oops",
      "expect_throws": true },
    { "name": "unclosed double quote is rejected", "input": "echo \"oops",
      "expect_throws": true }
  ],

  "quote": [
    { "name": "empty string becomes a quoted empty string",
      "input": "", "expect": { "value": "''" } },
    { "name": "a safe word is left alone",
      "input": "a", "expect": { "value": "a" } },
    { "name": "every safe character class is left alone",
      "input": "aZ9_@%+=:,./-", "expect": { "value": "aZ9_@%+=:,./-" } },
    { "name": "a space forces quoting",
      "input": "a b", "expect": { "value": "'a b'" } },
    { "name": "a single quote uses the POSIX escape dance",
      "input": "a'b", "expect": { "value": "'a'\"'\"'b'" } },
    { "name": "a double quote only needs the surrounding single quotes",
      "input": "a\"b", "expect": { "value": "'a\"b'" } },
    { "name": "non-ascii is NOT safe and gets quoted",
      "input": "中文", "expect": { "value": "'中文'" } }
  ],

  "join": [
    { "name": "no parts joins to the empty string",
      "input": [], "expect": { "value": "" } },
    { "name": "one empty part",
      "input": [""], "expect": { "value": "''" } },
    { "name": "the real resume argv",
      "input": ["claude", "-p", "/dev-loop resume"],
      "expect": { "value": "claude -p '/dev-loop resume'" } },
    { "name": "safe words need no quoting",
      "input": ["echo", "hello"], "expect": { "value": "echo hello" } },
    { "name": "an apostrophe in a part",
      "input": ["echo", "it's"], "expect": { "value": "echo 'it'\"'\"'s'" } },
    { "name": "non-ascii parts are each quoted",
      "input": ["echo", "中文", "參數"], "expect": { "value": "echo '中文' '參數'" } },
    { "name": "a flag whose value contains spaces",
      "input": ["cmd", "--flag=v with space"],
      "expect": { "value": "cmd '--flag=v with space'" } }
  ],

  "roundTrip": [
    { "name": "the real resume command survives split-join-split",
      "input": "claude -p '/dev-loop resume'" },
    { "name": "double-quoted form normalises to single quotes",
      "input": "claude -p \"/dev-loop resume\"" },
    { "name": "runs of spaces inside quotes survive", "input": "a 'b  c' d" },
    { "name": "an apostrophe survives", "input": "echo \"it's\"" },
    { "name": "non-ascii survives", "input": "echo 中文 參數" },
    { "name": "an escaped space survives", "input": "echo a\\ b" }
  ]
}
```

`roundTrip` 的 case 沒有 `expect`——它斷言的是 `split(join(split(input))) === split(input)`,一個對兩引擎都成立的不變量。兩側消費者各自實作這條斷言。

**注意**:`roundTrip` 的 case 只有 `name` 與 `input`,沒有 `expect` 也沒有 `expect_throws`。既有的 `resolve_expectation` / `resolveExpectation` 會因「必須恰好有一種預期」而拋錯。所以 `roundTrip` **不要**走那個 helper,兩側消費者直接讀 `case["input"]` 並自行斷言;`parity_cases` / `parityCases` 仍照常使用(section 集合檢查與重複名稱檢查仍然要)。

- [ ] **Step 3: 寫 Python 側消費者**

建立 `tests/test_parity_shlex.py`:

```python
import shlex

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation

SECTIONS = ["split", "quote", "join", "roundTrip"]


@pytest.mark.parametrize("case", parity_cases("shlex", "split", SECTIONS))
def test_shlex_split_parity(case):
    expect, throws = resolve_expectation(case, "py")
    if throws:
        with pytest.raises(Exception):
            shlex.split(case["input"])
        return
    assert_subset({"value": shlex.split(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "quote", SECTIONS))
def test_shlex_quote_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "quote never raises"
    assert_subset({"value": shlex.quote(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "join", SECTIONS))
def test_shlex_join_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "join never raises"
    assert_subset({"value": shlex.join(case["input"])}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("shlex", "roundTrip", SECTIONS))
def test_shlex_round_trip_parity(case):
    # split(join(split(x))) == split(x) —— 對兩引擎都成立的不變量。
    # 這裡不用 resolve_expectation:roundTrip 的 case 刻意沒有 expect。
    parts = shlex.split(case["input"])
    assert shlex.split(shlex.join(parts)) == parts, case["name"]
```

- [ ] **Step 4: 跑 Python 側**

Run: `make test`
Expected: PASS(shlex parity 共 36 個 case)

- [ ] **Step 5: 寫 TS 側消費者**

建立 `plugins/dev-loop/src/parity.shlex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { shlexSplit, shlexJoin, shlexQuote } from "./shlex.js";

const SECTIONS = ["split", "quote", "join", "roundTrip"];

describe("parity: shlexSplit", () => {
  for (const c of parityCases("shlex", "split", SECTIONS)) {
    it(c.name, () => {
      const input = c.input as string;
      const { expect: want, throws } = resolveExpectation(c);
      if (throws) {
        expect(() => shlexSplit(input)).toThrow();
        return;
      }
      expectSubset({ value: shlexSplit(input) }, want!, c.name);
    });
  }
});

describe("parity: shlexQuote", () => {
  for (const c of parityCases("shlex", "quote", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "quote never raises").toBe(false);
      expectSubset({ value: shlexQuote(c.input as string) }, want!, c.name);
    });
  }
});

describe("parity: shlexJoin", () => {
  for (const c of parityCases("shlex", "join", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "join never raises").toBe(false);
      expectSubset({ value: shlexJoin(c.input as string[]) }, want!, c.name);
    });
  }
});

describe("parity: shlex round trip", () => {
  for (const c of parityCases("shlex", "roundTrip", SECTIONS)) {
    it(c.name, () => {
      // split(join(split(x))) === split(x)。roundTrip 的 case 刻意沒有 expect,
      // 所以不走 resolveExpectation。
      const parts = shlexSplit(c.input as string);
      expect(shlexSplit(shlexJoin(parts)), c.name).toEqual(parts);
    });
  }
});
```

- [ ] **Step 6: 寫 TS 單元測試**

建立 `plugins/dev-loop/src/shlex.test.ts`,補 fixture 表達不了的:

```typescript
import { describe, it, expect } from "vitest";
import { shlexSplit, shlexJoin, shlexQuote } from "./shlex.js";

describe("shlexQuote", () => {
  it("quotes non-ascii even though it contains no whitespace", () => {
    // 憑直覺寫的實作多半只對含空白的字串加引號。往返仍然成立,
    // 但 join 的輸出與 Python 不同字——而 join 的輸出會進 argv。
    expect(shlexQuote("中文")).toBe("'中文'");
    expect(shlexQuote("a")).toBe("a");
  });
});

describe("shlexSplit", () => {
  it("distinguishes an explicitly empty token from no token", () => {
    expect(shlexSplit("''")).toEqual([""]);
    expect(shlexSplit("")).toEqual([]);
    expect(shlexSplit("a '' b")).toEqual(["a", "", "b"]);
  });
  it("rejects a trailing lone backslash", () => {
    expect(() => shlexSplit("echo a\\")).toThrow();
  });
});

describe("shlexJoin", () => {
  it("is not a plain space join", () => {
    expect(shlexJoin(["a b"])).not.toBe("a b");
    expect(shlexJoin(["a b"])).toBe("'a b'");
  });
});
```

**在寫這些之前,先對 Python 確認三件事**,並把實測結果填進上面的斷言(若與此處不符,停下來回報):`shlex.split("''")`、`shlex.split("a '' b")`、`shlex.split("echo a\\")`。

- [ ] **Step 7: 兩側 manifest 加入 `shlex`**

`tests/test_parity_manifest.py` 與 `plugins/dev-loop/src/parity.manifest.test.ts` 的 `CONSUMED_MODULES` 都加 `shlex`。**兩邊都要改**——只改一邊會讓該側立刻變紅,那正是它的用途。

- [ ] **Step 8: 跑兩側 + lint**

Run: `make test`
Run(在 `plugins/dev-loop/`):`npm test && npm run lint`
Expected: 皆 PASS

- [ ] **Step 9: 驗證非空轉**

暫時把 `shlex.ts` 的 `SAFE` 正規表達式改成 `/^[^\s]+$/`(即「只要沒空白就算安全」——最可能的偷懶寫法),跑 `npx vitest run src/parity.shlex.test.ts`。
Expected: FAIL,且失敗的包含 `non-ascii is NOT safe and gets quoted`。
還原,確認回綠。

**這一步是本 task 的重點**:那個偷懶寫法能通過所有 roundTrip case,只有逐字比對的 quote/join case 抓得到。

- [ ] **Step 10: 確認 dist 未動 + Commit**

Run: `git status --porcelain plugins/dev-loop/dist`
Expected: 無輸出(`shlex.ts` 不在 `cli.ts` 的相依樹上)。

```bash
git add plugins/dev-loop/src/shlex.ts plugins/dev-loop/src/shlex.test.ts \
        plugins/dev-loop/src/parity.shlex.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/shlex.json tests/test_parity_shlex.py tests/test_parity_manifest.py
git commit -m "feat(ts): port shlex split, join and quote

The resume command goes through split, join, and split again before an
unattended background process runs it, and the gate splits each configured
command into argv the same way. Getting either wrong is silent: the watcher
runs the wrong thing forever with its output going only to a log nobody
reads, or the gate reports a tooling failure as a code failure and pushes the
loop into fix.

The case worth naming is quoting. Python's shlex.quote treats only
[a-zA-Z0-9_@%+=:,./-] as safe, so non-ascii gets quoted too — an
implementation that only quotes on whitespace passes every round-trip case
and still emits different bytes."
```

---

### Task 2: pypath + worktree

**Files:**
- Create: `plugins/dev-loop/src/pypath.ts`
- Create: `plugins/dev-loop/src/pypath.test.ts`
- Create: `plugins/dev-loop/src/worktree.ts`
- Create: `plugins/dev-loop/src/worktree.test.ts`
- Create: `fixtures/parity/worktree.json`
- Create: `tests/test_parity_worktree.py`
- Create: `plugins/dev-loop/src/parity.worktree.test.ts`
- Modify: 兩側 `CONSUMED_MODULES`

**Interfaces:**
- Consumes:Task 1 無;`node:child_process` 的 `spawnSync`
- Produces:
  - `pyResolve(p: string): string` —— Python `Path(p).resolve()` 的語意
  - `type GitRunner = (args: string[]) => { code: number; stdout: string; stderr: string }`
  - `parseWorktreePaths(porcelain: string, repoResolved: string): string[]` —— 純函式,fixture 就釘這個
  - `addWorktree(repo, path, branch, base, runner?): void`(失敗拋錯)
  - `mergeBranch(repo, branch, runner?): MergeResult`
  - `removeWorktree(repo, path, branch, runner?): void`
  - `listWorktreePaths(repo, runner?): string[]`
  - `worktreeExists(repo, path, runner?): boolean`
- Task 5(teardown)會用 `listWorktreePaths` 與 `pyResolve`。

- [ ] **Step 1: 寫 pypath**

建立 `plugins/dev-loop/src/pypath.ts`:

```typescript
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Python `Path(p).resolve()` parity(3.6+ 的預設 strict=False)。
 *
 * Python 的 resolve() 會解 symlink **而且路徑不存在也不拋錯**。Node 這邊兩個
 * 函式各只做一半:`resolve()` 不解 symlink,`realpathSync()` 解但路徑不存在
 * 就拋 ENOENT。
 *
 * 這個差異在 macOS 上是常態而非邊角:`/tmp` 是 `/private/tmp` 的 symlink,而
 * `git worktree list --porcelain` 印的已經是解過的實體路徑。用 `resolve()` 比對
 * 的話,使用者給的 `/tmp/x` 永遠比不到 git 印的 `/private/tmp/x`——於是
 * `worktreeExists` 恆為 false、`pruneOrphanWorktrees` 的前綴比對恆不成立。
 * 而它是**靜默無作為**不是崩潰:孤兒 worktree 永遠不會被清掉,沒有錯誤訊息。
 *
 * 不存在的路徑:退回逐層解析——把存在的前綴 realpath 掉,其餘接回去。這是
 * Python 的做法,也是唯一能讓「父目錄是 symlink 但檔案還沒建」正確的做法。
 */
export function pyResolve(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // 逐層往上找到存在的前綴
    const parts = abs.split("/");
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const head = parts.slice(0, i).join("/") || "/";
      try {
        const real = realpathSync(head);
        return [real, ...parts.slice(i)].join("/");
      } catch {
        continue;
      }
    }
    return abs;
  }
}
```

**實作前先對 Python 確認**(結果填進 `pypath.test.ts`,不符就停下回報):在一個 symlink 目錄下,`Path("/tmp/<不存在的檔>").resolve()` 回什麼;`Path("relative").resolve()` 是否等於 `cwd` 接上去。

- [ ] **Step 2: 寫 worktree 模組**

建立 `plugins/dev-loop/src/worktree.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { pyResolve } from "./pypath.js";

export interface MergeResult {
  ok: boolean;
  conflict: boolean;
  output: string;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 可注入以便測試。真實實作對應 Python 的 `subprocess.run(["git","-C",repo,...])`。 */
export type GitRunner = (repo: string, args: string[]) => GitResult;

export const defaultGitRunner: GitRunner = (repo, args) => {
  const proc = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (proc.error) {
    throw proc.error;
  }
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
};

export function addWorktree(
  repo: string, path: string, branch: string, base: string, git: GitRunner = defaultGitRunner,
): void {
  const r = git(repo, ["worktree", "add", "-b", branch, String(path), base]);
  if (r.code !== 0) {
    throw new Error(`worktree add failed: ${r.stderr || r.stdout}`);
  }
}

export function mergeBranch(
  repo: string, branch: string, git: GitRunner = defaultGitRunner,
): MergeResult {
  const r = git(repo, ["merge", "--no-ff", "-m", `merge ${branch}`, branch]);
  if (r.code === 0) {
    return { ok: true, conflict: false, output: r.stdout };
  }
  git(repo, ["merge", "--abort"]);
  return { ok: false, conflict: true, output: r.stdout + r.stderr };
}

export function removeWorktree(
  repo: string, path: string, branch: string, git: GitRunner = defaultGitRunner,
): void {
  git(repo, ["worktree", "remove", "--force", String(path)]);
  git(repo, ["branch", "-D", branch]);
}

/**
 * 解析 `git worktree list --porcelain`,回傳主 worktree 以外的路徑。
 *
 * 抽成純函式是為了讓 parity fixture 釘得到——這是兩個引擎最容易各自解讀出
 * 不同結果的地方,而 `repoResolved` 那個比較正是 pyResolve 存在的理由。
 */
export function parseWorktreePaths(porcelain: string, repoResolved: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      const p = pyResolve(line.slice("worktree ".length));
      if (p !== repoResolved) {
        paths.push(p);
      }
    }
  }
  return paths;
}

export function listWorktreePaths(repo: string, git: GitRunner = defaultGitRunner): string[] {
  const r = git(repo, ["worktree", "list", "--porcelain"]);
  return parseWorktreePaths(r.stdout, pyResolve(repo));
}

export function worktreeExists(
  repo: string, path: string, git: GitRunner = defaultGitRunner,
): boolean {
  return listWorktreePaths(repo, git).includes(pyResolve(path));
}
```

- [ ] **Step 3: 寫 worktree fixture**

建立 `fixtures/parity/worktree.json`。只有 `parseWorktreePaths` 進 fixture(其餘要真 git,走兩側各自的測試):

```json
{
  "parseWorktreePaths": [
    { "name": "no linked worktrees leaves only the main one",
      "porcelain": "worktree /repo\nHEAD abc\nbranch refs/heads/main\n",
      "repo_resolved": "/repo",
      "expect": { "value": [] } },
    { "name": "one linked worktree",
      "porcelain": "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.wt/a\nHEAD abc\nbranch refs/heads/a\n",
      "repo_resolved": "/repo",
      "expect": { "value": ["/repo/.wt/a"] } },
    { "name": "two linked worktrees keep their order",
      "porcelain": "worktree /repo\n\nworktree /repo/.wt/b\n\nworktree /repo/.wt/a\n",
      "repo_resolved": "/repo",
      "expect": { "value": ["/repo/.wt/b", "/repo/.wt/a"] } },
    { "name": "empty output yields nothing",
      "porcelain": "", "repo_resolved": "/repo",
      "expect": { "value": [] } },
    { "name": "lines that are not worktree lines are ignored",
      "porcelain": "worktree /repo\nHEAD abc\nbare\ndetached\n",
      "repo_resolved": "/repo",
      "expect": { "value": [] } },
    { "name": "a path with spaces survives",
      "porcelain": "worktree /repo\n\nworktree /repo/.wt/a b\n",
      "repo_resolved": "/repo",
      "expect": { "value": ["/repo/.wt/a b"] } }
  ]
}
```

**注意**:這些路徑都不存在於檔案系統上,所以 `pyResolve` 走的是「路徑不存在」那條分支,兩引擎都必須回原樣。這正是要釘的。

- [ ] **Step 4: 兩側消費者**

`tests/test_parity_worktree.py`:

```python
import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.worktree import list_worktree_paths  # noqa: F401  (確認模組可 import)

SECTIONS = ["parseWorktreePaths"]


def _parse_py(porcelain, repo_resolved):
    """Python 沒有把解析抽成函式,這裡照 list_worktree_paths 的迴圈重現。
    兩邊釘的是同一個演算法,不是同一個函式簽名。"""
    from pathlib import Path
    paths = []
    for line in porcelain.splitlines():
        if line.startswith("worktree "):
            p = str(Path(line[len("worktree "):]).resolve())
            if p != repo_resolved:
                paths.append(p)
    return paths


@pytest.mark.parametrize("case", parity_cases("worktree", "parseWorktreePaths", SECTIONS))
def test_parse_worktree_paths_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "parseWorktreePaths never raises"
    got = _parse_py(case["porcelain"], case["repo_resolved"])
    assert_subset({"value": got}, expect, case["name"])
```

`plugins/dev-loop/src/parity.worktree.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { parseWorktreePaths } from "./worktree.js";

const SECTIONS = ["parseWorktreePaths"];

describe("parity: parseWorktreePaths", () => {
  for (const c of parityCases("worktree", "parseWorktreePaths", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "parseWorktreePaths never raises").toBe(false);
      const got = parseWorktreePaths(c.porcelain as string, c.repo_resolved as string);
      expectSubset({ value: got }, want!, c.name);
    });
  }
});
```

**這裡有一個要在實作時裁決的事**:Python 側沒有把解析抽成獨立函式,所以測試重現了它的迴圈。這是「兩邊釘同一個演算法而非同一個函式」的情況。若審查認為重現有風險(Python 改了迴圈、測試沒跟著改),另一個選項是接受並在 fixture 註明——**不要**為此修改 Python 實作,本 plan 禁止。

- [ ] **Step 5: TS 側的真 git 測試**

建立 `plugins/dev-loop/src/worktree.test.ts`。用注入的 `GitRunner` 測分支邏輯,再用真 git 測一個端對端:

```typescript
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree, mergeBranch, listWorktreePaths, worktreeExists,
  type GitRunner,
} from "./worktree.js";

const okRunner: GitRunner = () => ({ code: 0, stdout: "", stderr: "" });

describe("addWorktree", () => {
  it("throws with git's stderr when the command fails", () => {
    const failing: GitRunner = () => ({ code: 1, stdout: "", stderr: "boom" });
    expect(() => addWorktree("/r", "/p", "b", "main", failing)).toThrow("boom");
  });
  it("falls back to stdout when stderr is empty", () => {
    const failing: GitRunner = () => ({ code: 1, stdout: "out-only", stderr: "" });
    expect(() => addWorktree("/r", "/p", "b", "main", failing)).toThrow("out-only");
  });
});

describe("mergeBranch", () => {
  it("aborts the merge on conflict and reports both streams", () => {
    const calls: string[][] = [];
    const conflicting: GitRunner = (_repo, args) => {
      calls.push(args);
      return args[0] === "merge" && args[1] === "--no-ff"
        ? { code: 1, stdout: "o", stderr: "e" }
        : { code: 0, stdout: "", stderr: "" };
    };
    const r = mergeBranch("/r", "b", conflicting);
    expect(r).toEqual({ ok: false, conflict: true, output: "oe" });
    expect(calls.some((a) => a[0] === "merge" && a[1] === "--abort")).toBe(true);
  });
  it("does not abort on success", () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repo, args) => { calls.push(args); return { code: 0, stdout: "done", stderr: "" }; };
    expect(mergeBranch("/r", "b", runner).ok).toBe(true);
    expect(calls.some((a) => a[1] === "--abort")).toBe(false);
  });
});

describe("worktreeExists against real git", () => {
  it("matches a path given through a symlinked parent", () => {
    // macOS 的 /tmp 是 /private/tmp 的 symlink,而 git porcelain 印實體路徑。
    // 用 resolve()(不解 symlink)實作的話這條會 false。
    const repo = mkdtempSync(join(tmpdir(), "wt-repo-"));
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "t@e"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a", "utf-8");
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "init"]);
    const wt = join(mkdtempSync(join(tmpdir(), "wt-out-")), "w");
    addWorktree(repo, wt, "feat", "HEAD");
    expect(listWorktreePaths(repo).length).toBe(1);
    expect(worktreeExists(repo, wt)).toBe(true);
  });
});

describe("okRunner is unused-guard", () => {
  it("exists so the import stays honest", () => {
    expect(okRunner("/r", []).code).toBe(0);
  });
});
```

最後那個 `okRunner` 守衛測試是湊數的——**寫實作時把它刪掉,並把 `okRunner` 一併刪掉**(它在上面的測試裡沒被用到)。這行註記留在 plan 裡是為了避免實作者照抄一個沒用的常數。

- [ ] **Step 6: 兩側 manifest 加入 `worktree`**

- [ ] **Step 7: 跑兩側 + lint + 驗證非空轉**

Run: `make test`;`npm test && npm run lint`
Expected: 皆 PASS

非空轉驗證:把 `worktree.ts` 的 `pyResolve` 換成 `node:path` 的 `resolve`,跑 `npx vitest run src/worktree.test.ts`。
Expected: FAIL —— `matches a path given through a symlinked parent` 變紅。
還原,確認回綠。

- [ ] **Step 8: 確認 dist 未動 + Commit**

```bash
git add plugins/dev-loop/src/pypath.ts plugins/dev-loop/src/pypath.test.ts \
        plugins/dev-loop/src/worktree.ts plugins/dev-loop/src/worktree.test.ts \
        plugins/dev-loop/src/parity.worktree.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/worktree.json tests/test_parity_worktree.py tests/test_parity_manifest.py
git commit -m "feat(ts): port the worktree module, and Python's resolve semantics with it

Path.resolve follows symlinks and tolerates missing paths; Node splits those
into two functions that each do half. On macOS /tmp is a symlink to
/private/tmp and git prints the resolved form, so comparing with node's
resolve never matches — and the failure is silence, not an error: orphan
worktrees simply never get pruned.

Splitting the porcelain parse into a pure function is what makes the fixture
possible. It is the place where two engines are most likely to read the same
external output differently."
```

---

### Task 3: gate

**Files:**
- Create: `plugins/dev-loop/src/gate.ts`
- Create: `plugins/dev-loop/src/gate.test.ts`
- Create: `fixtures/parity/gate.json`
- Create: `tests/test_parity_gate.py`
- Create: `plugins/dev-loop/src/parity.gate.test.ts`
- Modify: 兩側 `CONSUMED_MODULES`

**Interfaces:**
- Produces:
  - `interface GateResult { passed: boolean; failed_command: string[] | null; output: string }`
  - `type CommandRunner = (cmd: string[], cwd: string | undefined, timeout: number) => { code: number | null; stdout: string; stderr: string; timedOut: boolean }`
  - `runGate(commands: string[][], opts?: { cwd?: string; timeout?: number; runner?: CommandRunner }): GateResult`
- M2b-2b 的 `gate` 子命令會用。

- [ ] **Step 1: 寫 gate 模組**

```typescript
import { spawnSync } from "node:child_process";

export interface GateResult {
  passed: boolean;
  failed_command: string[] | null;
  output: string;
}

export interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 可注入以便測試。真實實作對應 Python 的 subprocess.run(capture_output, timeout)。 */
export type CommandRunner = (cmd: string[], cwd: string | undefined, timeout: number) => RunOutcome;

export const defaultRunner: CommandRunner = (cmd, cwd, timeout) => {
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, {
    cwd, encoding: "utf8", timeout: timeout * 1000,
  });
  // spawnSync 逾時會殺掉行程並把 error.code 設成 ETIMEDOUT;Python 那邊是
  // TimeoutExpired 例外。兩邊都必須表現成「該命令失敗」而非整個 gate 崩潰。
  const timedOut = (proc.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (proc.error && !timedOut) {
    throw proc.error;
  }
  return {
    code: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", timedOut,
  };
};

/**
 * 依序執行 commands;任一失敗即短路回報(規格 4)。
 *
 * 每個命令最多執行 timeout 秒;逾時視為該命令失敗,避免 hang 住的 gate 命令
 * 永久阻塞 loop。
 *
 * 注意空清單回 passed=true——模組層就是這個語意。封死「空清單假綠」是 CLI
 * 層的責任(Python 的 _resolve_gate_cmds 皆空時 exit 2),不要在這裡多加守門,
 * 那會讓兩個引擎的模組語意分家。
 */
export function runGate(
  commands: string[][],
  opts: { cwd?: string; timeout?: number; runner?: CommandRunner } = {},
): GateResult {
  const timeout = opts.timeout ?? 600;
  const run = opts.runner ?? defaultRunner;
  for (const cmd of commands) {
    const r = run(cmd, opts.cwd, timeout);
    if (r.timedOut) {
      return { passed: false, failed_command: cmd, output: `timeout after ${timeout}s` };
    }
    if (r.code !== 0) {
      return { passed: false, failed_command: cmd, output: r.stdout + r.stderr };
    }
  }
  return { passed: true, failed_command: null, output: "" };
}
```

- [ ] **Step 2: 寫 gate fixture**

`fixtures/parity/gate.json`。每個 case 給一串「注入 runner 會依序回傳的結果」:

```json
{
  "runGate": [
    { "name": "no commands passes vacuously",
      "commands": [], "outcomes": [], "timeout": 600,
      "expect": { "passed": true, "failed_command": null, "output": "" } },
    { "name": "all commands pass",
      "commands": [["a"], ["b"]],
      "outcomes": [{ "code": 0 }, { "code": 0 }], "timeout": 600,
      "expect": { "passed": true, "failed_command": null, "output": "" } },
    { "name": "the second command fails and short-circuits",
      "commands": [["a"], ["b"], ["c"]],
      "outcomes": [{ "code": 0 }, { "code": 1, "stdout": "out\n", "stderr": "err\n" }],
      "timeout": 600,
      "expect": { "passed": false, "failed_command": ["b"], "output": "out\nerr\n" } },
    { "name": "stdout comes before stderr in the reported output",
      "commands": [["a"]],
      "outcomes": [{ "code": 1, "stdout": "S", "stderr": "E" }], "timeout": 600,
      "expect": { "passed": false, "failed_command": ["a"], "output": "SE" } },
    { "name": "a timeout is a failure of that command, not a crash",
      "commands": [["slow"]],
      "outcomes": [{ "timed_out": true }], "timeout": 1,
      "expect": { "passed": false, "failed_command": ["slow"], "output": "timeout after 1s" } },
    { "name": "the timeout value appears in the message",
      "commands": [["slow"]],
      "outcomes": [{ "timed_out": true }], "timeout": 600,
      "expect": { "passed": false, "failed_command": ["slow"], "output": "timeout after 600s" } },
    { "name": "a later command is not run after a failure",
      "commands": [["a"], ["b"]],
      "outcomes": [{ "code": 2, "stdout": "", "stderr": "" }], "timeout": 600,
      "expect": { "passed": false, "failed_command": ["a"], "output": "" } }
  ]
}
```

最後一條的 `outcomes` 只有一個元素——若實作沒有短路,注入的 runner 會被要求提供第二個結果而爆掉。**這是短路行為的真正斷言**,比只看回傳值強。兩側消費者的 runner 都要在被多呼叫時拋錯。

- [ ] **Step 3-6: 兩側消費者、manifest、測試、非空轉驗證**

Python 側 `tests/test_parity_gate.py` 用 `run_fn` 不可行(Python 的 `run_gate` 沒有注入點)——**改用 monkeypatch `devloop.gate.subprocess.run`**,依 `outcomes` 依序回傳假的 CompletedProcess,並在超出長度時 `pytest.fail("short-circuit violated")`。timeout 的 case 則讓假的 run 拋 `subprocess.TimeoutExpired`。

TS 側直接注入 `runner`,同樣在超出長度時拋錯。

非空轉驗證:把 `runGate` 的短路 `return` 改成記下失敗後繼續跑完,`npx vitest run src/parity.gate.test.ts`。
Expected: FAIL 在 `a later command is not run after a failure`。

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ts): port the gate module

Timeout has to surface as a failure of the offending command rather than an
exception that takes the loop down; Python raises TimeoutExpired and catches
it, spawnSync reports ETIMEDOUT on the error object instead, and both have to
produce the same 'timeout after Ns' result.

The short-circuit is asserted by starving the injected runner: the fixture
supplies one fewer outcome than there are commands, so an implementation that
keeps going after a failure asks for a result that does not exist."
```

---

### Task 4: adapter

**Files:**
- Create: `plugins/dev-loop/src/adapter.ts`
- Create: `plugins/dev-loop/src/adapter.test.ts`
- Create: `fixtures/parity/adapter.json`
- Create: `tests/test_parity_adapter.py`
- Create: `plugins/dev-loop/src/parity.adapter.test.ts`
- Modify: 兩側 `CONSUMED_MODULES`

**Interfaces:**
- Produces:
  - `DEFAULT_HEARTBEAT = 1800`、`MAX_SLEEP_SECONDS = 3600`、`OUTPUT_TAIL_CHARS = 500`
  - `type RunFn = (cmd: string[]) => number | [number, string]`
  - `type SleepFn = (seconds: number) => void | Promise<void>`
  - `runWatcher(execCommand: string[], opts?: { heartbeat?: number; sleepFn?: SleepFn; runFn?: RunFn; logPath?: string }): Promise<number>`
- M2b-2b 的 `watch` 命令與 `watcher` 模組會用。

**已對 Python 實測的行為**(全部要進 fixture):`heartbeat` 夾到 `MAX_SLEEP_SECONDS`(傳 99999 實際睡 3600,**且 log 記的是夾過的值**);每次嘗試追加一行 `{ts, exit_code, output_tail, action, heartbeat}`,`action` 為 `retry`/`stop`;exit 0 即回 0 並停止,**成功那次不睡**;`run_fn` 可回 exit code 或 `(code, tail)`。

- [ ] **Step 1: 寫 adapter 模組**

建立 `plugins/dev-loop/src/adapter.ts`:

```typescript
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_HEARTBEAT = 1800; // 兩次重試間預設間隔(秒)
export const MAX_SLEEP_SECONDS = 3600; // 單次睡眠上限(harness wakeup 上限)
export const OUTPUT_TAIL_CHARS = 500; // log 保留的命令輸出尾巴長度

/** 回 exit code,或 [exit code, 輸出尾巴]。兩種形狀都要支援(Python 同此)。 */
export type RunFn = (cmd: string[]) => number | [number, string];
export type SleepFn = (seconds: number) => void | Promise<void>;

/**
 * 預設睡眠。Python 是同步的 time.sleep;Node 沒有同步 sleep,所以整個
 * runWatcher 是 async。
 *
 * **這個 async 會往上傳染**:M2b-2b 的 `watch` 子命令得 await 它,而 cli.ts 的
 * main() 目前是同步回 number。屆時要嘛讓 main 回 number | Promise<number>,
 * 要嘛讓 watch 走一條獨立的進入路徑。這裡先標記,不在本 task 解。
 */
const defaultSleep: SleepFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** best-effort 追加一行 JSON 到 watcher log;失敗靜默(不得反噬 watcher)。 */
function appendLog(logPath: string | undefined, entry: Record<string, unknown>): void {
  if (!logPath) {
    return;
  }
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // 靜默:log 是觀測資料,壞了不該讓 watcher 停擺
  }
}

/**
 * 無 reset 時間 · 週期重試的續跑 watcher(resume-trigger 規格)。
 *
 * 反覆執行 execCommand:回 0 即視為 loop 已被重新推進,停止並回 0;回非 0
 * 視為仍被限流,睡一個 heartbeat 後重試。heartbeat 夾到 MAX_SLEEP_SECONDS
 * (harness wakeup 上限),**log 記的是夾過的值**。
 */
export async function runWatcher(
  execCommand: string[],
  opts: { heartbeat?: number; sleepFn?: SleepFn; runFn?: RunFn; logPath?: string } = {},
): Promise<number> {
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const runFn = opts.runFn ?? defaultRun;
  const interval = Math.min(opts.heartbeat ?? DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS);
  for (;;) {
    const result = runFn(execCommand);
    const [code, tail] = Array.isArray(result) ? result : [result, ""];
    appendLog(opts.logPath, {
      ts: new Date().toISOString(),
      exit_code: code,
      output_tail: tail,
      action: code === 0 ? "stop" : "retry",
      heartbeat: interval,
    });
    if (code === 0) {
      return 0;
    }
    await sleepFn(interval);
  }
}
```

`defaultRun` 用 `spawnSync` 捕捉輸出並取尾巴:

```typescript
import { spawnSync } from "node:child_process";

/**
 * 執行續跑命令,回傳 [exit code, 輸出尾巴]。detached watcher 的 stdout 無人看,
 * 輸出改捕捉進 log 供排障。
 */
const defaultRun: RunFn = (cmd) => {
  const [head, ...rest] = cmd;
  const proc = spawnSync(head as string, rest, { encoding: "utf8" });
  const tail = ((proc.stdout ?? "") + (proc.stderr ?? "")).slice(-OUTPUT_TAIL_CHARS);
  return [proc.status ?? 1, tail];
};
```

(`defaultRun` 要宣告在 `runWatcher` 之前,或用 `function` 宣告以取得 hoisting。)

- [ ] **Step 2: 寫 adapter fixture**

建立 `fixtures/parity/adapter.json`。`outcomes` 是注入 `runFn` 依序回傳的東西,`expect` 的 `log` 陣列**不含 `ts`**(兩引擎時間戳文法不同,既有延後項;比照 checkpoint round trip 只斷言共通前綴,那部分在兩側消費者裡做):

```json
{
  "runWatcher": [
    {
      "name": "an immediate success stops without sleeping",
      "exec_command": ["x"], "heartbeat": 60,
      "outcomes": [[0, "done"]],
      "expect": {
        "returned": 0,
        "slept": [],
        "log": [{ "exit_code": 0, "output_tail": "done", "action": "stop", "heartbeat": 60 }]
      }
    },
    {
      "name": "two failures then success sleeps twice",
      "exec_command": ["x"], "heartbeat": 60,
      "outcomes": [[1, "a"], [1, "b"], [0, "c"]],
      "expect": {
        "returned": 0,
        "slept": [60, 60],
        "log": [
          { "exit_code": 1, "output_tail": "a", "action": "retry", "heartbeat": 60 },
          { "exit_code": 1, "output_tail": "b", "action": "retry", "heartbeat": 60 },
          { "exit_code": 0, "output_tail": "c", "action": "stop", "heartbeat": 60 }
        ]
      }
    },
    {
      "name": "heartbeat is clamped to the wakeup ceiling, and the log records the clamped value",
      "exec_command": ["x"], "heartbeat": 99999,
      "outcomes": [[1, ""], [0, ""]],
      "expect": {
        "returned": 0,
        "slept": [3600],
        "log": [
          { "exit_code": 1, "output_tail": "", "action": "retry", "heartbeat": 3600 },
          { "exit_code": 0, "output_tail": "", "action": "stop", "heartbeat": 3600 }
        ]
      }
    },
    {
      "name": "a bare exit code with no tail is accepted",
      "exec_command": ["x"], "heartbeat": 60,
      "outcomes": [0],
      "expect": {
        "returned": 0, "slept": [],
        "log": [{ "exit_code": 0, "output_tail": "", "action": "stop", "heartbeat": 60 }]
      }
    },
    {
      "name": "a heartbeat below the ceiling is used as given",
      "exec_command": ["x"], "heartbeat": 1,
      "outcomes": [[1, ""], [0, ""]],
      "expect": {
        "returned": 0, "slept": [1],
        "log": [
          { "exit_code": 1, "output_tail": "", "action": "retry", "heartbeat": 1 },
          { "exit_code": 0, "output_tail": "", "action": "stop", "heartbeat": 1 }
        ]
      }
    },
    {
      "name": "a non-zero exit that is not 1 still counts as retry",
      "exec_command": ["x"], "heartbeat": 60,
      "outcomes": [[42, "t"], [0, ""]],
      "expect": {
        "returned": 0, "slept": [60],
        "log": [
          { "exit_code": 42, "output_tail": "t", "action": "retry", "heartbeat": 60 },
          { "exit_code": 0, "output_tail": "", "action": "stop", "heartbeat": 60 }
        ]
      }
    }
  ],

  "noLogPath": [
    {
      "name": "omitting the log path writes nothing and does not raise",
      "exec_command": ["x"], "heartbeat": 60,
      "outcomes": [[0, "done"]],
      "expect": { "returned": 0, "slept": [] }
    }
  ]
}
```

`noLogPath` 獨立成一個 section,是因為它的斷言多一項「檔案沒被建出來」,而那不是 `expect` 表達得了的。

- [ ] **Step 3: 寫 Python 側消費者**

建立 `tests/test_parity_adapter.py`:

```python
import json

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop.adapter import run_watcher

SECTIONS = ["runWatcher", "noLogPath"]

TS_PREFIX_LEN = len("2026-08-01T00:00:00")


def _outcome(o):
    """fixture 的 outcome 是 [code, tail] 或裸 code。"""
    return tuple(o) if isinstance(o, list) else o


def _drive(case, log_path):
    """依 fixture 的 outcomes 驅動 run_watcher,回 (returned, slept, log_entries)。"""
    pending = [_outcome(o) for o in case["outcomes"]]
    slept = []

    def run_fn(cmd):
        assert cmd == case["exec_command"], "exec_command 沒有原樣傳給 run_fn"
        assert pending, "run_fn 被呼叫的次數超過 fixture 提供的 outcomes"
        return pending.pop(0)

    returned = run_watcher(
        case["exec_command"], heartbeat=case["heartbeat"],
        sleep_fn=slept.append, run_fn=run_fn, log_path=log_path,
    )
    entries = []
    if log_path is not None:
        from pathlib import Path
        p = Path(log_path)
        if p.exists():
            entries = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return returned, slept, entries


@pytest.mark.parametrize("case", parity_cases("adapter", "runWatcher", SECTIONS))
def test_run_watcher_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "runWatcher cases do not raise"
    log_path = tmp_path / "w.jsonl"
    returned, slept, entries = _drive(case, str(log_path))
    # ts 的文法兩引擎不同(既有延後項),不列入 expect;只斷言共通的秒級前綴存在
    for e in entries:
        assert len(e.pop("ts", "")) >= TS_PREFIX_LEN, case["name"]
    assert_subset({"returned": returned, "slept": slept, "log": entries}, expect, case["name"])


@pytest.mark.parametrize("case", parity_cases("adapter", "noLogPath", SECTIONS))
def test_run_watcher_without_log_parity(case, tmp_path):
    expect, _ = resolve_expectation(case, "py")
    returned, slept, _ = _drive(case, None)
    assert_subset({"returned": returned, "slept": slept}, expect, case["name"])
    assert not list(tmp_path.iterdir()), "log_path 為空時不該寫任何檔案"
```

- [ ] **Step 4: 寫 TS 側消費者**

建立 `plugins/dev-loop/src/parity.adapter.test.ts`,與 Python 側對稱。差別只在 `runWatcher` 是 async,所以每個 `it` 要 `await`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset, type ParityCase } from "./parityFixture.js";
import { runWatcher, type RunFn } from "./adapter.js";

const SECTIONS = ["runWatcher", "noLogPath"];
const TS_PREFIX_LEN = "2026-08-01T00:00:00".length;

async function drive(c: ParityCase, logPath: string | undefined) {
  const pending = [...(c.outcomes as unknown[])];
  const slept: number[] = [];
  const runFn: RunFn = (cmd) => {
    expect(cmd, "exec_command 沒有原樣傳給 runFn").toEqual(c.exec_command);
    expect(pending.length, "runFn 被呼叫的次數超過 fixture 提供的 outcomes").toBeGreaterThan(0);
    const o = pending.shift();
    return (Array.isArray(o) ? (o as [number, string]) : (o as number));
  };
  const returned = await runWatcher(c.exec_command as string[], {
    heartbeat: c.heartbeat as number,
    sleepFn: (s) => { slept.push(s); },
    runFn,
    logPath,
  });
  const entries: Record<string, unknown>[] = [];
  if (logPath !== undefined && existsSync(logPath)) {
    for (const ln of readFileSync(logPath, "utf-8").split("\n")) {
      if (ln.trim()) entries.push(JSON.parse(ln) as Record<string, unknown>);
    }
  }
  return { returned, slept, entries };
}

describe("parity: runWatcher", () => {
  for (const c of parityCases("adapter", "runWatcher", SECTIONS)) {
    it(c.name, async () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "runWatcher cases do not raise").toBe(false);
      const logPath = join(mkdtempSync(join(tmpdir(), "adapter-")), "w.jsonl");
      const { returned, slept, entries } = await drive(c, logPath);
      for (const e of entries) {
        expect(String(e.ts ?? "").length, c.name).toBeGreaterThanOrEqual(TS_PREFIX_LEN);
        delete e.ts;
      }
      expectSubset({ returned, slept, log: entries }, want!, c.name);
    });
  }
});

describe("parity: runWatcher without a log path", () => {
  for (const c of parityCases("adapter", "noLogPath", SECTIONS)) {
    it(c.name, async () => {
      const { expect: want } = resolveExpectation(c);
      const dir = mkdtempSync(join(tmpdir(), "adapter-"));
      const { returned, slept } = await drive(c, undefined);
      expectSubset({ returned, slept }, want!, c.name);
      expect(readdirSync(dir), "logPath 為空時不該寫任何檔案").toEqual([]);
    });
  }
});
```

- [ ] **Step 5: 寫 TS 單元測試**

建立 `plugins/dev-loop/src/adapter.test.ts`,補 fixture 表達不了的:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS, OUTPUT_TAIL_CHARS, runWatcher } from "./adapter.js";

describe("adapter constants", () => {
  it("matches the Python values", () => {
    expect(DEFAULT_HEARTBEAT).toBe(1800);
    expect(MAX_SLEEP_SECONDS).toBe(3600);
    expect(OUTPUT_TAIL_CHARS).toBe(500);
  });
});

describe("runWatcher log failures", () => {
  it("does not stop the watcher when the log cannot be written", () => {
    // log 是觀測資料。寫不進去(權限、磁碟滿)不得反噬 watcher——
    // 這裡把 logPath 指向一個不可能建立的路徑。
    const impossible = "/dev/null/nope/w.jsonl";
    return expect(runWatcher(["x"], {
      heartbeat: 1, runFn: () => 0, logPath: impossible,
    })).resolves.toBe(0);
  });
});

describe("runWatcher sleep", () => {
  it("awaits an async sleepFn before retrying", async () => {
    const order: string[] = [];
    let n = 0;
    await runWatcher(["x"], {
      heartbeat: 1,
      runFn: () => { order.push("run"); return n++ === 0 ? 1 : 0; },
      sleepFn: async () => { order.push("sleep-start"); await Promise.resolve(); order.push("sleep-end"); },
    });
    expect(order).toEqual(["run", "sleep-start", "sleep-end", "run"]);
  });
});
```

最後那條是 TS 專屬的:Python 的 `sleep_fn` 是同步的,TS 若忘了 `await`,重試會在睡眠完成前就發生。fixture 抓不到這個(注入的 `sleepFn` 同步回傳時順序仍對)。

- [ ] **Step 6: 兩側 manifest 加入 `adapter`**

- [ ] **Step 7: 跑兩側 + lint + 驗證非空轉**

Run: `make test`;`npm test && npm run lint`
Expected: 皆 PASS

非空轉驗證:把 `Math.min(opts.heartbeat ?? DEFAULT_HEARTBEAT, MAX_SLEEP_SECONDS)` 的 `Math.min` 拿掉(直接用傳入值),跑 `npx vitest run src/parity.adapter.test.ts`。
Expected: FAIL 在 `heartbeat is clamped to the wakeup ceiling...`。還原,確認回綠。

- [ ] **Step 8: 確認 dist 未動 + Commit**

```bash
git add plugins/dev-loop/src/adapter.ts plugins/dev-loop/src/adapter.test.ts \
        plugins/dev-loop/src/parity.adapter.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/adapter.json tests/test_parity_adapter.py tests/test_parity_manifest.py
git commit -m "feat(ts): port the watcher retry loop

Node has no synchronous sleep, so runWatcher is async — and that asynchrony
propagates: the watch subcommand will have to await it, and cli.ts's main()
currently returns a plain number. Flagged in the source for the milestone
that lands the command.

The clamp is the case worth pinning. A heartbeat above the harness wakeup
ceiling is capped at 3600, and the log records the capped value rather than
the requested one — so an implementation that clamps the sleep but logs the
input looks right until someone reads the log to work out why a watcher
retried when it did."
```

---

### Task 5: teardown

**Files:**
- Create: `plugins/dev-loop/src/teardown.ts`
- Create: `plugins/dev-loop/src/teardown.test.ts`
- Create: `fixtures/parity/teardown.json`
- Create: `tests/test_parity_teardown.py`
- Create: `plugins/dev-loop/src/parity.teardown.test.ts`
- Modify: 兩側 `CONSUMED_MODULES`

**Interfaces:**
- Consumes:Task 2 的 `listWorktreePaths`、`pyResolve`、`GitRunner`
- Produces:
  - `classifyBranchDeleteError(code: number, stderr: string): string` —— **純函式,fixture 釘這個**
  - `disarmWatcher(checkpointPath: string): "killed" | "absent"`
  - `pruneOrphanWorktrees(repo: string, wtRoot: string, git?: GitRunner): number`
  - `sweepChangeMeta(checkpointPath: string, changeId: string): boolean`
  - `deleteMergedBranch(repo: string, branch: string, git?: GitRunner): string`
- M2c 的 `teardown` 子命令會用。

**已用真 git 實測的分類**:已 merged → `deleted`;未 merged → `unmerged`;不存在 → `absent`;正被 checkout 或被其他 worktree 佔用 → `checked_out`。

- [ ] **Step 1: 寫 teardown 模組**

建立 `plugins/dev-loop/src/teardown.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { pyResolve } from "./pypath.js";
import { defaultGitRunner, listWorktreePaths, type GitRunner } from "./worktree.js";

/**
 * 終態不再需要 watcher:程序活著就 SIGTERM,再刪 watcher.pid。
 * 回 "killed"(有活程序被送訊號)/ "absent"(無 pid 檔、內容非法或已死)。
 * idempotent:無檔即 "absent",刪檔用「不存在也不炸」的語意。
 */
export function disarmWatcher(checkpointPath: string): "killed" | "absent" {
  const pidPath = join(dirname(checkpointPath), "watcher.pid");
  if (!existsSync(pidPath)) {
    return "absent";
  }
  let result: "killed" | "absent" = "absent";
  let pid: number | null = null;
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    const n = Number.parseInt(raw, 10);
    // Python 的 int() 對 "12abc" 會 ValueError,Number.parseInt 卻回 12。
    // 用完整字串比對把語意對齊:非純十進位整數一律當非法。
    pid = /^[+-]?\d+$/.test(raw) && Number.isFinite(n) ? n : null;
  } catch {
    pid = null;
  }
  if (pid !== null) {
    try {
      process.kill(pid, "SIGTERM");
      result = "killed";
    } catch {
      result = "absent"; // 行程已死或無權限
    }
  }
  try {
    unlinkSync(pidPath);
  } catch {
    // missing_ok 的語意:刪不掉也不影響結果
  }
  return result;
}

/**
 * git worktree prune + 移除 wtRoot 底下殘留的 worktree(crash 兜底)。
 * 回實際移除數;wtRoot 不存在則僅 prune 回 0。目錄清空後收掉。idempotent。
 */
export function pruneOrphanWorktrees(
  repo: string, wtRoot: string, git: GitRunner = defaultGitRunner,
): number {
  git(repo, ["worktree", "prune"]);
  if (!existsSync(wtRoot)) {
    return 0;
  }
  // pyResolve 的第二個用武之地:wtRoot 若含 symlink(macOS 的 /tmp 是常態),
  // 未解析的前綴永遠比不到 git 印出的實體路徑,前綴比對恆不成立——
  // 而那是靜默無作為,孤兒 worktree 永遠不會被清掉。
  const prefix = pyResolve(wtRoot) + sep;
  let removed = 0;
  for (const p of listWorktreePaths(repo, git)) {
    if (p.startsWith(prefix)) {
      const r = git(repo, ["worktree", "remove", "--force", p]);
      if (r.code === 0) {
        removed += 1;
      }
    }
  }
  try {
    if (existsSync(wtRoot) && readdirSync(wtRoot).length === 0) {
      rmdirSync(wtRoot);
    }
  } catch {
    // 清不掉不影響結果
  }
  return removed;
}

/**
 * 補收 archiveWorkfiles 漏網的 changes/<id>.json → archive/<id>/。
 * 回是否有搬動;不存在回 false。idempotent。
 */
export function sweepChangeMeta(checkpointPath: string, changeId: string): boolean {
  const root = dirname(checkpointPath);
  const meta = join(root, "changes", `${changeId}.json`);
  if (!existsSync(meta)) {
    return false;
  }
  const dest = join(root, "archive", String(changeId));
  mkdirSync(dest, { recursive: true });
  try {
    renameSync(meta, join(dest, `${changeId}.json`));
  } catch {
    // Python 只捕 FileNotFoundError(TOCTOU:剛剛還在,現在沒了)
    return false;
  }
  return true;
}

/**
 * `git branch -d` 的結果分類。抽成純函式讓 parity fixture 釘得到——
 * 這是「解析外部工具輸出」的典型,兩個引擎最容易各自解讀出不同結果。
 *
 * 文案隨 git 版本變動時保守歸 "unmerged"——訊息 less 精確但不誤導。
 */
export function classifyBranchDeleteError(code: number, stderr: string): string {
  if (code === 0) {
    return "deleted";
  }
  const err = stderr.toLowerCase();
  if (err.includes("checked out") || err.includes("used by worktree")) {
    return "checked_out";
  }
  if (err.includes("not found")) {
    return "absent";
  }
  return "unmerged";
}

/** git branch -d(safe delete:僅已 merged 才刪)。非致命。 */
export function deleteMergedBranch(
  repo: string, branch: string, git: GitRunner = defaultGitRunner,
): string {
  const r = git(repo, ["branch", "-d", branch]);
  return classifyBranchDeleteError(r.code, r.stderr);
}
```

**實作前先對 Python 確認兩件事**(不符就停下回報):`disarm_watcher` 對 `watcher.pid` 內容為 `"12abc"` 的處理(Python 的 `int()` 會 ValueError → pid=None → 回 `absent` 且仍刪檔);`sweep_change_meta` 對 `changes/<id>.json` 存在但 `archive/` 不存在時是否會建目錄。

- [ ] **Step 2: 寫 teardown fixture**

建立 `fixtures/parity/teardown.json`。只有 `classifyBranchDeleteError` 進 fixture,其餘碰檔案系統與行程,走兩側各自的測試:

```json
{
  "classifyBranchDeleteError": [
    { "name": "exit zero is a deletion regardless of stderr",
      "code": 0, "stderr": "warning: something",
      "expect": { "value": "deleted" } },
    { "name": "checked out in the current worktree",
      "code": 1, "stderr": "error: Cannot delete branch 'b' checked out at '/repo'\n",
      "expect": { "value": "checked_out" } },
    { "name": "used by another worktree",
      "code": 1, "stderr": "error: cannot delete branch 'b' used by worktree at '/repo/.wt/a'\n",
      "expect": { "value": "checked_out" } },
    { "name": "branch not found",
      "code": 1, "stderr": "error: branch 'b' not found.\n",
      "expect": { "value": "absent" } },
    { "name": "not fully merged",
      "code": 1, "stderr": "error: The branch 'b' is not fully merged.\n",
      "expect": { "value": "unmerged" } },
    { "name": "an unrecognised message is conservatively unmerged",
      "code": 1, "stderr": "error: something nobody has seen before\n",
      "expect": { "value": "unmerged" } },
    { "name": "empty stderr with a non-zero code is conservatively unmerged",
      "code": 1, "stderr": "",
      "expect": { "value": "unmerged" } },
    { "name": "matching is case-insensitive",
      "code": 1, "stderr": "error: Branch 'b' NOT FOUND.\n",
      "expect": { "value": "absent" } },
    { "name": "checked out is matched before not found when both appear",
      "code": 1, "stderr": "error: checked out at '/x'; ref not found\n",
      "expect": { "value": "checked_out" } }
  ]
}
```

最後一條釘的是**判斷順序**:`checked out` 的分支在 `not found` 之前。兩個子字串同時出現時的結果,是一個對調兩個 `if` 就會改變、而其他 case 都抓不到的行為。

- [ ] **Step 3: 兩側消費者**

`tests/test_parity_teardown.py`:

```python
import pytest

from conftest import assert_subset, parity_cases, resolve_expectation

SECTIONS = ["classifyBranchDeleteError"]


def _classify_py(code, stderr):
    """Python 沒有把分類抽成函式,這裡照 delete_merged_branch 的判斷重現。
    兩邊釘的是同一個演算法,不是同一個函式簽名(同 worktree 的處理)。"""
    if code == 0:
        return "deleted"
    err = stderr.lower()
    if "checked out" in err or "used by worktree" in err:
        return "checked_out"
    if "not found" in err:
        return "absent"
    return "unmerged"


@pytest.mark.parametrize("case", parity_cases("teardown", "classifyBranchDeleteError", SECTIONS))
def test_classify_branch_delete_error_parity(case):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "classification never raises"
    got = _classify_py(case["code"], case["stderr"])
    assert_subset({"value": got}, expect, case["name"])
```

`plugins/dev-loop/src/parity.teardown.test.ts` 與之對稱,直接呼叫 `classifyBranchDeleteError`。

**與 Task 2 同一個要裁決的事**:Python 側沒有抽出這個函式,測試重現了它的判斷。若審查認為重現有風險,選項是接受並在 fixture 註明——**不要**為此修改 Python 實作。

- [ ] **Step 4: 寫 TS 側的檔案系統與行程測試**

建立 `plugins/dev-loop/src/teardown.test.ts`。先讀 `tests/test_teardown.py`,確認情境涵蓋一致,缺的補上(**這是本 plan 唯一允許新增 Python 測試的地方**,且只能改測試不能改實作):

```typescript
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disarmWatcher, sweepChangeMeta, pruneOrphanWorktrees, classifyBranchDeleteError } from "./teardown.js";
import type { GitRunner } from "./worktree.js";

function devloopDir(): string {
  const d = join(mkdtempSync(join(tmpdir(), "td-")), ".devloop");
  mkdirSync(join(d, "changes"), { recursive: true });
  return d;
}

describe("disarmWatcher", () => {
  it("reports absent when there is no pid file", () => {
    const d = devloopDir();
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
  });
  it("treats a malformed pid as absent and still removes the file", () => {
    // Python 的 int("12abc") 拋 ValueError;Number.parseInt 回 12,會去 kill
    // 一個無關的行程。這條就是釘住那個差異。
    const d = devloopDir();
    const pid = join(d, "watcher.pid");
    writeFileSync(pid, "12abc", "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
    expect(existsSync(pid)).toBe(false);
  });
  it("treats a dead pid as absent and still removes the file", () => {
    const d = devloopDir();
    const pid = join(d, "watcher.pid");
    // 極高機率不存在的 pid
    writeFileSync(pid, "2147483646", "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
    expect(existsSync(pid)).toBe(false);
  });
});

describe("sweepChangeMeta", () => {
  it("moves the meta and creates the archive directory", () => {
    const d = devloopDir();
    writeFileSync(join(d, "changes", "c1.json"), "{}", "utf-8");
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "c1")).toBe(true);
    expect(existsSync(join(d, "archive", "c1", "c1.json"))).toBe(true);
    expect(existsSync(join(d, "changes", "c1.json"))).toBe(false);
  });
  it("is idempotent", () => {
    const d = devloopDir();
    writeFileSync(join(d, "changes", "c1.json"), "{}", "utf-8");
    sweepChangeMeta(join(d, "checkpoint.json"), "c1");
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "c1")).toBe(false);
  });
  it("returns false when there is no meta", () => {
    const d = devloopDir();
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "nope")).toBe(false);
  });
});

describe("pruneOrphanWorktrees", () => {
  it("prunes and returns zero when the worktree root does not exist", () => {
    const calls: string[][] = [];
    const git: GitRunner = (_r, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; };
    expect(pruneOrphanWorktrees("/repo", "/nope", git)).toBe(0);
    expect(calls[0]).toEqual(["worktree", "prune"]);
  });
  it("only removes worktrees under the root", () => {
    const root = mkdtempSync(join(tmpdir(), "wtroot-"));
    const inside = join(root, "a");
    const git: GitRunner = (_r, args) => {
      if (args[0] === "worktree" && args[1] === "list") {
        return { code: 0, stdout: `worktree /repo\n\nworktree ${inside}\n\nworktree /elsewhere/b\n`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(pruneOrphanWorktrees("/repo", root, git)).toBe(1);
  });
});

describe("classifyBranchDeleteError order", () => {
  it("prefers checked_out over absent when both substrings appear", () => {
    expect(classifyBranchDeleteError(1, "checked out at '/x'; ref not found")).toBe("checked_out");
  });
});
```

- [ ] **Step 5: 兩側 manifest 加入 `teardown`**

- [ ] **Step 6: 跑兩側 + lint + 驗證非空轉**

Run: `make test`;`npm test && npm run lint`
Expected: 皆 PASS

非空轉驗證兩項:
1. 把 `classifyBranchDeleteError` 的 `used by worktree` 條件拿掉,跑 parity 測試 → `used by another worktree` 變紅。
2. 把 `pruneOrphanWorktrees` 的 `pyResolve(wtRoot)` 換成 `wtRoot` 原樣,在 `/tmp` 底下(macOS 的 symlink)跑 `only removes worktrees under the root` → 應變紅。**若沒變紅**,表示該測試沒有真的經過 symlink 路徑,要調整測試讓它經過,否則這條防護是假的。

- [ ] **Step 7: 確認 dist 未動 + Commit**

```bash
git add plugins/dev-loop/src/teardown.ts plugins/dev-loop/src/teardown.test.ts \
        plugins/dev-loop/src/parity.teardown.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/teardown.json tests/test_parity_teardown.py tests/test_parity_manifest.py \
        tests/test_teardown.py
git commit -m "feat(ts): port the teardown module

Splitting the branch-delete classification into a pure function is what makes
it testable across engines: it reads git's stderr, which is exactly the kind
of external output two implementations drift on. The fixture pins the
ordering too — 'checked out' is matched before 'not found', and a message
containing both would classify differently if the two branches were swapped.

Two Python semantics do not survive a naive port. int('12abc') raises where
Number.parseInt returns 12, so a malformed pid file would have this send
SIGTERM to an unrelated process. And the orphan-worktree prefix match needs
Python's resolve, or on macOS it silently matches nothing and prunes nothing."
```

---

## Self-Review

**1. Spec coverage**

| Spec 要求 | 對應 |
|---|---|
| shlex 移植 + 逐字元 fixture | Task 1 |
| `Path.resolve` 語意的第四個 helper | Task 2 Step 1 |
| worktree 移植 + porcelain 解析 fixture | Task 2 |
| gate 移植 + 注入 runner 的 fixture | Task 3 |
| adapter 移植 + log 條目 fixture(`ts` 不列入 expect) | Task 4 |
| teardown 移植 + stderr 分類 fixture | Task 5 |
| 不接任何 CLI | 全 plan;Global Constraints 明列 dist 不該變動 |

**與 spec 的一處範圍調整**:spec 的 M2b-2 含 `watcher` 模組、CLI backbone 與六個命令。本 plan 只做五個純模組,其餘進 M2b-2b。理由:一份 plan 寫完全部會超過 3000 行,review 面過寬;而五個模組彼此獨立、各自可測,是天然的切點。`watcher` 歸 B 是因為 `ensureArmed`、`watch` 命令、`arm-local` 是同一個單元。

**2. Placeholder scan** —— 五個 task 都給了完整程式碼與完整 fixture 內容。初稿的 Task 4、5 只給了「實作要點 + 行為表」,自審時判定那是 plan failure(writing-plans 明文:描述要做什麼卻不給程式碼)並補齊。無 TBD、無「類似 Task N」。

Task 3 的 Step 3-6 仍以敘述形式交代兩側消費者(monkeypatch 策略與注入策略),而非逐行程式碼——那一段的內容取決於 `outcomes` 的驅動方式,已把兩側各自的關鍵約束(超出長度即失敗)寫明。實作時若發現敘述不足以動手,停下來回報而不是自行發明。

**3. Type consistency** —— `GitRunner` 在 Task 2 定義,Task 5 的 `pruneOrphanWorktrees` 消費;`pyResolve` 在 Task 2 定義,Task 2、5 使用;`shlexSplit` 在 Task 1 定義,Task 3 的 gate 命令(M2b-2b)與 watcher(M2b-2b)使用。

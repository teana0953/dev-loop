# L1 里程碑 M1:TS 地基 + 純確定性核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 立起 TypeScript 引擎地基(專案骨架、node wrapper、vitest、CI 切換),把兩個純確定性模組(checkpoint、statemachine)以 TS 重寫,並讓 `devloop status` 子命令在 node 上跑通——證明整條鏈(node wrapper → TS CLI → dist/ → vitest → CI)通。

**Architecture:** 這是四個里程碑的第一個(M1 地基 → M2 移植子程序模組 → M3 eval 合流 → M4 可選整合)。M1 只碰純邏輯核心與工具鏈,不碰任何子程序(git/pytest/openspec)呼叫。現有 Python 引擎原地保留、CI 暫時雙軌(Python + TS 並存),直到 M2 把 loop 跑通後才移除 Python。M1 結束時 Python 引擎仍是生產路徑,TS 只是通了地基。

**Tech Stack:** TypeScript(tsc 編譯成 dist/)、Node ≥18、vitest、eslint。release 靠 CI(本里程碑只建 CI job,不改 release workflow)。

## Global Constraints

- 語言 TypeScript;runtime Node ≥18(本機驗證 node v24 可用)。
- 分發:`tsc` 編譯成 `dist/`;`dist/` **不進版控**(gitignore),CI 與本地各自 build。
- 測試:vitest;測試檔與被測模組同層或 `*.test.ts`。
- TS 專案根:`plugins/dev-loop/`(與現有 `devloop/` Python 並存,新程式碼放 `plugins/dev-loop/src/`,編譯輸出 `plugins/dev-loop/dist/`)。
- **不改任何 Python 檔**(`plugins/dev-loop/devloop/*.py`),不刪任何現有 Python 測試——M1 雙軌並存。
- checkpoint JSON schema **與現有 Python 版位元相容**(同欄位名、同預設、同向後相容行為),續跑相容性最單純。
- statemachine 行為**逐一對齊現有 Python** `transition()` 與 `next_hint()`(M1 不改流程,只換語言);M3 才動流程。
- tsconfig:`strict: true`、target ES2022、module NodeNext。
- **所有工具/依賴裝當下最新穩定版**(typescript、vitest、eslint 等),不 pin 過時號;plan 內出現的版本字串僅為佔位,以 `npm install -D` 實際解析到的為準。eslint 若為 9.x 走 flat config(見 Task 1 Step 6 caveat)。CI 的 `actions/setup-node` 用當下 LTS(node 20 或更新)。
- 每個 task 收尾 commit。

---

### Task 1: TS 專案骨架 + 工具鏈

**Files:**
- Create: `plugins/dev-loop/package.json`
- Create: `plugins/dev-loop/tsconfig.json`
- Create: `plugins/dev-loop/.eslintrc.json`
- Create: `plugins/dev-loop/src/index.ts`(暫時的 smoke 進入點)
- Create: `plugins/dev-loop/src/index.test.ts`
- Modify: `.gitignore`(加 `plugins/dev-loop/dist/`、`plugins/dev-loop/node_modules/`)

**Interfaces:**
- Consumes: 無(第一個 task)
- Produces: 可 `npm install`、`npm run build`(tsc→dist/)、`npm test`(vitest)、`npm run lint`(eslint)的 TS 專案。後續所有 task 依賴這套腳本。

- [ ] **Step 1: 建 package.json**

`plugins/dev-loop/package.json`:

```json
{
  "name": "@dev-loop/engine",
  "version": "0.6.0",
  "private": true,
  "type": "module",
  "bin": { "devloop": "./dist/cli.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint src --ext .ts"
  },
  "devDependencies": {}
}
```

**devDependencies 留空,由 Step 6 的 `npm install -D` 裝最新穩定版**——不手寫版號(npm 會寫入解析後的實際版本)。裝的套件:`typescript`、`vitest`、`eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`。

- [ ] **Step 2: 建 tsconfig.json**

`plugins/dev-loop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: 建 eslint 設定**

`plugins/dev-loop/.eslintrc.json`:

```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended"],
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "env": { "node": true, "es2022": true },
  "rules": {}
}
```

- [ ] **Step 4: 建 smoke 進入點 + 測試**

`plugins/dev-loop/src/index.ts`:

```typescript
export function engineVersion(): string {
  return "0.6.0";
}
```

`plugins/dev-loop/src/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { engineVersion } from "./index.js";

describe("engineVersion", () => {
  it("returns the engine version string", () => {
    expect(engineVersion()).toBe("0.6.0");
  });
});
```

- [ ] **Step 5: 改 .gitignore**

在 `.gitignore` 追加:

```
plugins/dev-loop/dist/
plugins/dev-loop/node_modules/
```

- [ ] **Step 6: 裝最新穩定版並驗證工具鏈**

裝 devDeps(每個抓當下 latest stable,npm 自動寫回 package.json 的解析版號):
```bash
cd plugins/dev-loop && npm install -D typescript vitest eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**eslint 版本 caveat**:若裝到的 eslint 是 9.x,預設吃 flat config(`eslint.config.js`)而非 `.eslintrc.json`。裝完先確認 major 版:
```bash
npx eslint --version
```
- eslint 8.x → 保留 Task 1 Step 3 的 `.eslintrc.json`。
- eslint 9.x → 改用 flat config:刪 `.eslintrc.json`,建 `eslint.config.js`:
```javascript
import tseslint from "typescript-eslint";
export default tseslint.config(...tseslint.configs.recommended);
```
並改裝 `typescript-eslint`(單一 meta 套件)取代分開的 parser/plugin:`npm install -D typescript-eslint`。lint script 改 `"lint": "eslint src"`(flat config 自動認 .ts,不需 `--ext`)。

驗證整套:
```bash
npm run build && npm test && npm run lint
```
Expected: `tsc` 產出 `dist/index.js`;vitest 1 passed;eslint 無錯。

- [ ] **Step 7: Commit**

```bash
# eslint 設定檔名依 Step 6 結果:8.x 用 .eslintrc.json,9.x 用 eslint.config.js。
git add plugins/dev-loop/package.json plugins/dev-loop/package-lock.json plugins/dev-loop/tsconfig.json plugins/dev-loop/.eslintrc.json plugins/dev-loop/eslint.config.js plugins/dev-loop/src/index.ts plugins/dev-loop/src/index.test.ts .gitignore 2>/dev/null; git add -A plugins/dev-loop
git commit -m "feat(ts): scaffold TypeScript engine project (tsc + vitest + eslint)"
```

---

### Task 2: checkpoint 模組(TS 重寫)

**Files:**
- Create: `plugins/dev-loop/src/checkpoint.ts`
- Create: `plugins/dev-loop/src/checkpoint.test.ts`

**Interfaces:**
- Consumes: Task 1 的 TS 工具鏈。
- Produces: `Checkpoint` 型別 + `saveCheckpoint(cp, path)` / `loadCheckpoint(path)`。JSON schema 與 Python 版位元相容(同欄位名、缺鍵走預設)。statemachine hint 與後續 CLI 依賴這些。

介面契約(對齊 Python `Checkpoint` dataclass 欄位):

```typescript
export interface Checkpoint {
  phase: string;
  change_id: string;
  branch: string;
  iteration: number;          // default 0
  last_artifact: string;      // default ""
  non_blocking: string[];     // default []
  updated_at: string;         // default ""; save 時設 ISO8601
  resume_exec: string | null; // default null
  units: unknown[];           // default []
  review_legs: unknown[];     // default []
  propose_attempts: number;   // default 0
  gate_failures: number;      // default 0
  finish_mode: string | null; // default null
  flow_profile: string;       // default "full"
  needs_uiux: boolean;        // default false
}
```

- [ ] **Step 1: 寫失敗測試**

`plugins/dev-loop/src/checkpoint.test.ts`(對齊 Python `test_checkpoint.py` 的行為):

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCheckpoint, saveCheckpoint, loadCheckpoint } from "./checkpoint.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cp-"));
}

describe("checkpoint", () => {
  it("save then load roundtrip", () => {
    const p = join(tmp(), "checkpoint.json");
    const cp = makeCheckpoint({
      phase: "apply", change_id: "add-foo", branch: "loop/add-foo",
      iteration: 2, last_artifact: "docs/review-1.md",
      non_blocking: ["rename x", "add docstring"],
    });
    saveCheckpoint(cp, p);
    const loaded = loadCheckpoint(p);
    expect(loaded.phase).toBe("apply");
    expect(loaded.change_id).toBe("add-foo");
    expect(loaded.iteration).toBe(2);
    expect(loaded.non_blocking).toEqual(["rename x", "add docstring"]);
  });

  it("save sets updated_at", () => {
    const p = join(tmp(), "checkpoint.json");
    const cp = makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" });
    expect(cp.updated_at).toBe("");
    saveCheckpoint(cp, p);
    expect(loadCheckpoint(p).updated_at).not.toBe("");
  });

  it("applies defaults", () => {
    const cp = makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" });
    expect(cp.iteration).toBe(0);
    expect(cp.non_blocking).toEqual([]);
    expect(cp.resume_exec).toBeNull();
    expect(cp.flow_profile).toBe("full");
    expect(cp.needs_uiux).toBe(false);
  });

  it("creates missing parent dirs on save", () => {
    const p = join(tmp(), ".devloop", "checkpoint.json");
    saveCheckpoint(makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" }), p);
    expect(loadCheckpoint(p).phase).toBe("apply");
  });

  it("loads legacy checkpoint missing newer keys via defaults", () => {
    const p = join(tmp(), "legacy.json");
    writeFileSync(p, JSON.stringify({
      phase: "apply", change_id: "c", branch: "b",
      iteration: 0, last_artifact: "", non_blocking: [],
      updated_at: "", resume_exec: null,
    }), "utf-8");
    const loaded = loadCheckpoint(p);
    expect(loaded.units).toEqual([]);
    expect(loaded.review_legs).toEqual([]);
    expect(loaded.propose_attempts).toBe(0);
    expect(loaded.gate_failures).toBe(0);
    expect(loaded.finish_mode).toBeNull();
    expect(loaded.flow_profile).toBe("full");
    expect(loaded.needs_uiux).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/checkpoint.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 寫 checkpoint.ts**

```typescript
export interface Checkpoint {
  phase: string;
  change_id: string;
  branch: string;
  iteration: number;
  last_artifact: string;
  non_blocking: string[];
  updated_at: string;
  resume_exec: string | null;
  units: unknown[];
  review_legs: unknown[];
  propose_attempts: number;
  gate_failures: number;
  finish_mode: string | null;
  flow_profile: string;
  needs_uiux: boolean;
}

const DEFAULTS: Omit<Checkpoint, "phase" | "change_id" | "branch"> = {
  iteration: 0,
  last_artifact: "",
  non_blocking: [],
  updated_at: "",
  resume_exec: null,
  units: [],
  review_legs: [],
  propose_attempts: 0,
  gate_failures: 0,
  finish_mode: null,
  flow_profile: "full",
  needs_uiux: false,
};

export function makeCheckpoint(
  partial: Pick<Checkpoint, "phase" | "change_id" | "branch"> & Partial<Checkpoint>,
): Checkpoint {
  return { ...DEFAULTS, ...partial };
}

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function saveCheckpoint(cp: Checkpoint, path: string): void {
  cp.updated_at = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cp, null, 2), "utf-8");
}

export function loadCheckpoint(path: string): Checkpoint {
  const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<Checkpoint>;
  return makeCheckpoint(data as Pick<Checkpoint, "phase" | "change_id" | "branch"> & Partial<Checkpoint>);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/checkpoint.test.ts`
Expected: PASS(5 項)

- [ ] **Step 5: build + lint 不回歸**

Run: `cd plugins/dev-loop && npm run build && npm run lint`
Expected: tsc 無錯、eslint 無錯。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/src/checkpoint.ts plugins/dev-loop/src/checkpoint.test.ts
git commit -m "feat(ts): port checkpoint module (schema-compatible with Python)"
```

---

### Task 3: statemachine transition(TS 重寫)

**Files:**
- Create: `plugins/dev-loop/src/statemachine.ts`
- Create: `plugins/dev-loop/src/statemachine.test.ts`

**Interfaces:**
- Consumes: Task 1 工具鏈。
- Produces: `PHASES` 常數、事件常數、`transition(phase, iteration, event, maxIterations?)` 純函式回 `[newPhase, newIteration]`、`InvalidTransition` error。逐一對齊現有 Python `transition()`(M1 不改流程)。Task 4 的 next_hint 與後續 CLI 依賴這些。

M1 保留現有 phase 鏈(含 gate/qa 分開)——**不套用 M3 的 eval 合流**。事件與轉移逐條照現有 Python `statemachine.py`。

- [ ] **Step 1: 寫失敗測試**

`plugins/dev-loop/src/statemachine.test.ts`(對齊 Python `test_statemachine.py` 的轉移斷言):

```typescript
import { describe, it, expect } from "vitest";
import {
  transition, InvalidTransition,
  APPLY_DONE, GATE_PASS, GATE_FAIL, QA_PASS, QA_FAIL, QA_SKIP,
  REVIEW_NO_BLOCKING, REVIEW_BLOCKING_CODE, REVIEW_BLOCKING_PROPOSAL,
  FIX_DONE, FINISH_DONE, PROPOSE_DONE, TEARDOWN_DONE,
  PROPOSE_CLEAN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_BLOCKING_DESIGN,
  PROPOSE_RETRY_EXCEEDED, GATE_RETRY_EXCEEDED,
  HUMAN_RESUME_PROPOSE, HUMAN_RESUME_FIX,
} from "./statemachine.js";

describe("transition", () => {
  it("apply_done goes to gate", () => {
    expect(transition("apply", 0, APPLY_DONE)).toEqual(["gate", 0]);
  });
  it("gate_pass enters qa and increments iteration", () => {
    expect(transition("gate", 0, GATE_PASS)).toEqual(["qa", 1]);
  });
  it("gate_pass beyond max iterations escalates", () => {
    expect(transition("gate", 3, GATE_PASS, 3)).toEqual(["escalated", 4]);
  });
  it("gate_fail goes to fix without incrementing", () => {
    expect(transition("gate", 1, GATE_FAIL)).toEqual(["fix", 1]);
  });
  it("qa_pass goes to review", () => {
    expect(transition("qa", 1, QA_PASS)).toEqual(["review", 1]);
  });
  it("qa_skip goes to review", () => {
    expect(transition("qa", 1, QA_SKIP)).toEqual(["review", 1]);
  });
  it("qa_fail goes to fix", () => {
    expect(transition("qa", 1, QA_FAIL)).toEqual(["fix", 1]);
  });
  it("review_no_blocking goes to merge", () => {
    expect(transition("review", 1, REVIEW_NO_BLOCKING)).toEqual(["merge", 1]);
  });
  it("review_blocking_code goes to fix", () => {
    expect(transition("review", 1, REVIEW_BLOCKING_CODE)).toEqual(["fix", 1]);
  });
  it("review_blocking_proposal goes to propose", () => {
    expect(transition("review", 1, REVIEW_BLOCKING_PROPOSAL)).toEqual(["propose", 1]);
  });
  it("fix_done goes to gate", () => {
    expect(transition("fix", 1, FIX_DONE)).toEqual(["gate", 1]);
  });
  it("merge finish_done goes to teardown", () => {
    expect(transition("merge", 1, FINISH_DONE)).toEqual(["teardown", 1]);
  });
  it("teardown_done goes to done", () => {
    expect(transition("teardown", 1, TEARDOWN_DONE)).toEqual(["done", 1]);
  });
  it("propose_clean goes to apply", () => {
    expect(transition("proposal_review", 0, PROPOSE_CLEAN)).toEqual(["apply", 0]);
  });
  it("propose_blocking_proposal goes to propose", () => {
    expect(transition("proposal_review", 0, PROPOSE_BLOCKING_PROPOSAL)).toEqual(["propose", 0]);
  });
  it("propose_blocking_design escalates", () => {
    expect(transition("proposal_review", 0, PROPOSE_BLOCKING_DESIGN)).toEqual(["escalated", 0]);
  });
  it("propose_done goes to proposal_review", () => {
    expect(transition("propose", 0, PROPOSE_DONE)).toEqual(["proposal_review", 0]);
  });
  it("propose_retry_exceeded escalates", () => {
    expect(transition("proposal_review", 0, PROPOSE_RETRY_EXCEEDED)).toEqual(["escalated", 0]);
  });
  it("gate_retry_exceeded escalates", () => {
    expect(transition("gate", 1, GATE_RETRY_EXCEEDED)).toEqual(["escalated", 1]);
  });
  it("human_resume_propose from escalated goes to propose", () => {
    expect(transition("escalated", 0, HUMAN_RESUME_PROPOSE)).toEqual(["propose", 0]);
  });
  it("human_resume_fix from escalated goes to fix", () => {
    expect(transition("escalated", 0, HUMAN_RESUME_FIX)).toEqual(["fix", 1]);
  });
  it("invalid transition throws", () => {
    expect(() => transition("apply", 0, GATE_PASS)).toThrow(InvalidTransition);
  });
});
```

注意:`human_resume_*` 在 Python 版會歸零計數器,轉移本身回 iteration 不變或依現行為——實作前**先讀 Python `transition()` 對 `HUMAN_RESUME_FIX` 的確切回值**校準本測試的 `[fix, 1]` 斷言(若 Python 是 `(fix, iteration)` 不 +1,改成 `[fix, 0]`)。以 Python 現行為為準。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/statemachine.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 寫 statemachine.ts**

逐條移植 Python `statemachine.py` 的 `transition()`。骨架:

```typescript
export const PHASES = [
  "brainstorm", "propose", "proposal_review", "apply", "gate", "qa",
  "review", "fix", "merge", "teardown", "escalated", "done",
] as const;

export const APPLY_DONE = "apply_done";
export const PROPOSE_CLEAN = "propose_clean";
export const PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal";
export const PROPOSE_BLOCKING_DESIGN = "propose_blocking_design";
export const GATE_PASS = "gate_pass";
export const GATE_FAIL = "gate_fail";
export const QA_PASS = "qa_pass";
export const QA_FAIL = "qa_fail";
export const QA_SKIP = "qa_skip";
export const REVIEW_NO_BLOCKING = "review_no_blocking";
export const REVIEW_BLOCKING_CODE = "review_blocking_code";
export const REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal";
export const FIX_DONE = "fix_done";
export const FINISH_DONE = "finish_done";
export const PROPOSE_DONE = "propose_done";
export const TEARDOWN_DONE = "teardown_done";
export const PROPOSE_RETRY_EXCEEDED = "propose_retry_exceeded";
export const GATE_RETRY_EXCEEDED = "gate_retry_exceeded";
export const HUMAN_RESUME_PROPOSE = "human_resume_propose";
export const HUMAN_RESUME_FIX = "human_resume_fix";

export const DEFAULT_MAX_ITERATIONS = 3;

export class InvalidTransition extends Error {}

export function transition(
  phase: string, iteration: number, event: string,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): [string, number] {
  if (phase === "proposal_review" && event === PROPOSE_CLEAN) return ["apply", iteration];
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_PROPOSAL) return ["propose", iteration];
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_DESIGN) return ["escalated", iteration];
  if (phase === "apply" && event === APPLY_DONE) return ["gate", iteration];
  if (phase === "gate" && event === GATE_PASS) {
    const next = iteration + 1;
    return next > maxIterations ? ["escalated", next] : ["qa", next];
  }
  if (phase === "qa" && event === QA_PASS) return ["review", iteration];
  if (phase === "qa" && event === QA_SKIP) return ["review", iteration];
  if (phase === "qa" && event === QA_FAIL) return ["fix", iteration];
  if (phase === "gate" && event === GATE_FAIL) return ["fix", iteration];
  if (phase === "review" && event === REVIEW_NO_BLOCKING) return ["merge", iteration];
  if (phase === "review" && event === REVIEW_BLOCKING_CODE) return ["fix", iteration];
  if (phase === "review" && event === REVIEW_BLOCKING_PROPOSAL) return ["propose", iteration];
  if (phase === "fix" && event === FIX_DONE) return ["gate", iteration];
  if (phase === "merge" && event === FINISH_DONE) return ["teardown", iteration];
  if (phase === "teardown" && event === TEARDOWN_DONE) return ["done", iteration];
  if (phase === "propose" && event === PROPOSE_DONE) return ["proposal_review", iteration];
  if (phase === "proposal_review" && event === PROPOSE_RETRY_EXCEEDED) return ["escalated", iteration];
  if (phase === "gate" && event === GATE_RETRY_EXCEEDED) return ["escalated", iteration];
  if (phase === "escalated" && event === HUMAN_RESUME_PROPOSE) return ["propose", iteration];
  if (phase === "escalated" && event === HUMAN_RESUME_FIX) return ["fix", iteration];
  throw new InvalidTransition(`no transition from ${phase} on ${event}`);
}
```

**實作前先讀 `plugins/dev-loop/devloop/statemachine.py` 的 `transition()`**,逐條核對回值(尤其 `HUMAN_RESUME_FIX` 是否 +1),不一致以 Python 為準並同步修正 Step 1 測試。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/statemachine.test.ts`
Expected: PASS(全項)

- [ ] **Step 5: build + lint**

Run: `cd plugins/dev-loop && npm run build && npm run lint`
Expected: 無錯。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/src/statemachine.ts plugins/dev-loop/src/statemachine.test.ts
git commit -m "feat(ts): port statemachine transition (behavior-matched to Python)"
```

---

### Task 4: next_hint(TS 重寫)

**Files:**
- Modify: `plugins/dev-loop/src/statemachine.ts`(加 `nextHint`)
- Create: `plugins/dev-loop/src/statemachine.hint.test.ts`

**Interfaces:**
- Consumes: Task 3 的 PHASES/常數。
- Produces: `nextHint(phase, checkpointPath, opts?)` 回恆以 `next: ` 開頭的字串。對齊 Python `next_hint()`。Task 5 的 CLI `status` 用它。

M1 保留現有 hint 行為(gate/qa 分開)。`opts` 含 `units`、`reviewLegs`、`gateCmds`、`finishMode`、`flowProfile`、`needsUiux`,對齊 Python 簽名。

- [ ] **Step 1: 寫失敗測試**

`plugins/dev-loop/src/statemachine.hint.test.ts`(挑 Python `next_hint` 的代表分支;實作前讀 Python 版核對每個字串前綴):

```typescript
import { describe, it, expect } from "vitest";
import { nextHint } from "./statemachine.js";

describe("nextHint", () => {
  it("always starts with 'next: '", () => {
    expect(nextHint("apply", ".devloop/cp.json")).toMatch(/^next: /);
  });
  it("done is terminal", () => {
    expect(nextHint("done", "f")).toContain("(done)");
  });
  it("gate with configured gate_cmds gives runnable command", () => {
    const h = nextHint("gate", "f", { gateCmds: ["pytest"] });
    expect(h).toContain("devloop gate --file f");
    expect(h).not.toContain("<test-cmd>");
  });
  it("gate without gate_cmds gives skeleton", () => {
    expect(nextHint("gate", "f")).toContain("<test-cmd>");
  });
  it("qa light non-uiux hints qa_skip", () => {
    const h = nextHint("qa", "f", { flowProfile: "light", needsUiux: false });
    expect(h).toContain("--event qa_skip");
  });
  it("qa light+uiux does NOT skip", () => {
    const h = nextHint("qa", "f", { flowProfile: "light", needsUiux: true });
    expect(h).not.toContain("qa_skip");
  });
  it("teardown with finish_mode gives runnable mode", () => {
    const h = nextHint("teardown", "f", { finishMode: "merge" });
    expect(h).toContain("--mode merge");
  });
  it("pending units surface first", () => {
    const h = nextHint("apply", "f", { units: [{ id: "g1", status: "pending" }] });
    expect(h).toContain("units pending: g1");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/statemachine.hint.test.ts`
Expected: FAIL(`nextHint` 未匯出)

- [ ] **Step 3: 加 nextHint 到 statemachine.ts**

移植 Python `next_hint()` 的分支順序(qa_skip guard → gate w/ cmds → teardown → pending units → pending legs → terminal → deterministic → judgment)。**實作前讀 Python `next_hint()`** 逐字對齊每個 hint 字串。骨架:

```typescript
interface HintOpts {
  units?: Array<{ id: string; status?: string }>;
  reviewLegs?: Array<{ kind: string; status?: string }>;
  gateCmds?: string[];
  finishMode?: string | null;
  flowProfile?: string | null;
  needsUiux?: boolean | null;
}

export function nextHint(phase: string, checkpointPath: string, opts: HintOpts = {}): string {
  const { units, reviewLegs, gateCmds, finishMode, flowProfile, needsUiux } = opts;
  if (phase === "qa" && flowProfile === "light" && !needsUiux)
    return `next: devloop event --file ${checkpointPath} --event qa_skip`;
  if (phase === "gate" && gateCmds && gateCmds.length)
    return `next: devloop gate --file ${checkpointPath}`;
  if (phase === "teardown") {
    const mode = finishMode || "<merge|pr>";
    return `next: devloop teardown --file ${checkpointPath} --repo . --mode ${mode}`;
  }
  if ((phase === "apply" || phase === "fix") && units) {
    const pending = units.filter(u => u.status === "pending" || u.status === "in_progress").map(u => u.id);
    if (pending.length)
      return `next: units pending: ${pending.join(",")} -> devloop units-status --file ${checkpointPath}`;
  }
  if (phase === "review" && reviewLegs) {
    const pending = reviewLegs.filter(l => l.status !== "collected").map(l => l.kind);
    if (pending.length)
      return `next: legs pending: ${pending.join(",")} -> devloop leg-done --file ${checkpointPath} --kind <kind> --report <report.json>`;
  }
  // terminal / deterministic / judgment hints — 逐字對齊 Python next_hint()
  // (done, escalated, proposal_review, gate skeleton, qa, review, merge,
  //  brainstorm, propose, apply, fix)
  // ...實作時補齊,字串照 Python 版
  throw new Error(`no next hint for phase ${phase}`);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/statemachine.hint.test.ts`
Expected: PASS(全項)

- [ ] **Step 5: build + lint**

Run: `cd plugins/dev-loop && npm run build && npm run lint`
Expected: 無錯。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/src/statemachine.ts plugins/dev-loop/src/statemachine.hint.test.ts
git commit -m "feat(ts): port next_hint (behavior-matched to Python)"
```

---

### Task 5: CLI status 子命令 + node wrapper 跑通

**Files:**
- Create: `plugins/dev-loop/src/cli.ts`
- Create: `plugins/dev-loop/src/cli.test.ts`
- Create: `plugins/dev-loop/bin/devloop-ts`(暫時的 TS wrapper,不覆蓋現有 `bin/devloop`)

**Interfaces:**
- Consumes: checkpoint + statemachine(Task 2/3/4)。
- Produces: `devloop status --file <path>` 印兩行(第一行 phase 摘要、第二行 `next:` hint),行為對齊 Python `status`。證明 node wrapper → TS CLI → dist/ 整條鏈通。

M1 只實作 `status` 一個子命令(唯讀、不碰子程序),作為鏈路貫通的證明。其餘子命令 M2 補。

- [ ] **Step 1: 寫失敗測試**

`plugins/dev-loop/src/cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function runStatus(cpPath: string): string {
  return execFileSync("node", [CLI, "status", "--file", cpPath], { encoding: "utf-8" });
}

describe("cli status", () => {
  it("prints phase summary and next hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    const p = join(dir, "cp.json");
    writeFileSync(p, JSON.stringify({
      phase: "gate", change_id: "c", branch: "b",
      iteration: 1, gate_failures: 0,
    }), "utf-8");
    const out = runStatus(p);
    const lines = out.trim().split("\n");
    expect(lines[0]).toContain("gate");
    expect(lines[1]).toMatch(/^next: /);
  });
});
```

注意:此測試跑編譯後的 `dist/cli.js`,故測試前需 `npm run build`。在 vitest 設定或測試內 `beforeAll` 觸發 build,或於 Step 4 手動先 build 再跑。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npm run build 2>&1 | head; npx vitest run src/cli.test.ts`
Expected: FAIL(`dist/cli.js` 不存在或無 status)

- [ ] **Step 3: 寫 cli.ts**

```typescript
#!/usr/bin/env node
import { loadCheckpoint } from "./checkpoint.js";
import { nextHint } from "./statemachine.js";

function cmdStatus(file: string): number {
  const cp = loadCheckpoint(file);
  process.stdout.write(
    `phase=${cp.phase} change_id=${cp.change_id} iteration=${cp.iteration}\n`,
  );
  process.stdout.write(
    nextHint(cp.phase, file, {
      units: cp.units as Array<{ id: string; status?: string }>,
      reviewLegs: cp.review_legs as Array<{ kind: string; status?: string }>,
      finishMode: cp.finish_mode,
      flowProfile: cp.flow_profile,
      needsUiux: cp.needs_uiux,
    }) + "\n",
  );
  return 0;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === "status") {
    const i = rest.indexOf("--file");
    if (i === -1 || !rest[i + 1]) {
      process.stderr.write("status requires --file\n");
      return 2;
    }
    return cmdStatus(rest[i + 1]);
  }
  process.stderr.write(`unknown command: ${cmd}\n`);
  return 2;
}

process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npm run build && npx vitest run src/cli.test.ts`
Expected: PASS

- [ ] **Step 5: 建 node wrapper 並手動驗證**

`plugins/dev-loop/bin/devloop-ts`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/dist/cli.js" "$@"
```

Run:
```bash
chmod +x plugins/dev-loop/bin/devloop-ts
printf '{"phase":"gate","change_id":"c","branch":"b","iteration":1}' > /tmp/cp-smoke.json
plugins/dev-loop/bin/devloop-ts status --file /tmp/cp-smoke.json
rm /tmp/cp-smoke.json
```
Expected: 印兩行,第一行含 `gate`,第二行 `next: ` 開頭。

- [ ] **Step 6: 全 TS 測試 + lint 綠**

Run: `cd plugins/dev-loop && npm test && npm run lint`
Expected: 全 passed、eslint 無錯。

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts plugins/dev-loop/bin/devloop-ts
git commit -m "feat(ts): status subcommand + node wrapper (chain proven end-to-end)"
```

---

### Task 6: CI 加 TS job(雙軌)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1 的 npm scripts(build/test/lint)。
- Produces: CI 新增 `ts` job(node build + vitest + eslint),與現有 Python job 並存。M1 不移除 Python job——雙軌直到 M2 loop 跑通。

- [ ] **Step 1: 加 ts job 到 ci.yml**

在 `.github/workflows/ci.yml` 的 `jobs:` 下追加(保留現有 `lint`、`test` Python jobs 不動):

```yaml
  ts:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: plugins/dev-loop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"   # 當下 LTS(≥20)
      - run: npm ci
      - run: npm run build
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 2: 本地模擬 CI 步驟**

Run:
```bash
cd plugins/dev-loop && npm ci && npm run build && npm run lint && npm test
```
Expected: 全綠(等同 CI ts job 會做的)。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add TypeScript job (build + vitest + eslint), dual-track with Python"
```

- [ ] **Step 4: push 後確認 CI 綠(交 controller 處理)**

M1 收尾:push 分支、確認 CI 的 Python jobs 與新 ts job 皆綠。(此步由執行者在 finishing-a-development-branch 階段做,plan 內不 push。)

---

## Self-Review

**Spec coverage(對照 L1 spec 的技術選型段):**
- TS/Node ≥18 → Task 1 tsconfig/package.json ✅
- tsc→dist/、release 靠 CI → Task 1 build script + Task 6 CI ✅
- vitest → Task 1 devDeps + 全測試 ✅
- 純 node 前置 → M1 不動 check-deps(那是 M2/M4 的事,M1 雙軌並存,前置切換延後);**本 plan 範圍不含 check-deps 改動**,已在里程碑分解註明。
- checkpoint schema 相容 → Task 2 ✅
- statemachine 對齊 Python → Task 3/4 ✅

**里程碑邊界:** M1 只碰純邏輯 + 工具鏈 + status 唯讀命令,不碰任何子程序呼叫(git/pytest/openspec)——那些是 M2。eval 合流是 M3。check-deps/README/前置切換分散在 M2(loop 跑通後)與 M4。此邊界刻意,確保 M1 是最小可運作可測地基。

**Placeholder scan:** Task 3/4 有兩處「實作前讀 Python 版核對」——這不是 placeholder,是明確的校準指示(Python 是行為真相來源,TS 逐條對齊)。Task 4 Step 3 骨架末的 terminal/deterministic/judgment hints 標「實作時補齊,字串照 Python 版」——這是唯一接近 placeholder 處,但已給明確來源(Python `next_hint`)與對齊要求,執行者照抄即可。

**型別一致:** `Checkpoint` 介面(Task 2)、`transition` 回 `[string, number]`(Task 3)、`nextHint` 簽名(Task 4)、cli 消費(Task 5)一致。

**未決(交執行時):** Task 3 的 `HUMAN_RESUME_FIX` 是否 +1 —— plan 明示以 Python 現行為為準、實作前讀原始碼校準測試,不是含糊。

# L1 里程碑 M2a:交付路徑 + 純函式模組 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 TypeScript 引擎的交付路徑(esbuild bundle 單檔進版控),並把五個低副作用模組(`config`、`history`、`changemeta`、`finish`、`openspec`)移植到 TypeScript。

**Architecture:** M2 因規模過大(1508 行引擎 + 1726 行 CLI 測試)拆成三個子里程碑:**M2a**(本 plan)做交付路徑與純函式模組;M2b 做子程序與檔案系統模組(`gate`/`review`/`worktree`/`units`/`housekeeping`/`teardown`/`adapter`/`watcher`);M2c 做 CLI 全表面(24 個子命令)並移除 Python。M2a 結束時交付路徑已通、五個模組雙軌並存,Python 仍是生產路徑。

**Tech Stack:** TypeScript(tsc 型別檢查 + esbuild 打包)、Node ≥18、vitest。

## Global Constraints

- **交付路徑決策(已定案)**:用 esbuild 把 TS 打包成單一 `plugins/dev-loop/dist/cli.js` 並 **commit 進版控**。使用者靠 git checkout 裝 plugin,所以 bundle 必須在 repo 裡;`node_modules/` 維持 gitignore。
- 這解決 M1 final review 的 Finding 4(阻斷點):目前 `dist/` 被 gitignore 且 release 只打 tag,M2c 移除 Python 時 plugin 會無法交付。M2a 必須先關掉這個洞。
- Bundle 必須與原始碼同步。CI 要能抓到「改了 src 但沒重新 bundle」——在 `ts` job 加一步重新 bundle 後 `git diff --exit-code dist/`。
- Python 原始碼(`plugins/dev-loop/devloop/*.py`)是所有移植的**行為真理來源**。plan 內的預期值若與 Python 不符,以 Python 為準並回報。
- 不得修改 `plugins/dev-loop/devloop/` 下任何檔案,不得改動任何 Python 測試。Python 382 測試須維持全綠(雙軌)。
- TS 現有 57 測試不得回歸;`npm run build`、`npm run lint` 須乾淨。
- ESM + NodeNext:相對 import 帶 `.js` 副檔名;`strict: true`。
- 每個 task 收尾 commit。

---

### Task 1: esbuild 打包 + bundle 進版控(關掉交付阻斷點)

**Files:**
- Modify: `plugins/dev-loop/package.json`(加 esbuild devDep 與 bundle script)
- Modify: `.gitignore`(取消忽略 `dist/`)
- Modify: `.github/workflows/ci.yml`(ts job 加 bundle 同步檢查)
- Create: `plugins/dev-loop/dist/cli.js`(打包產物,進版控)

**Interfaces:**
- Consumes: M1 既有的 `src/cli.ts` 進入點與 npm scripts。
- Produces: `npm run bundle` 產生單檔 `dist/cli.js`(無外部 runtime 依賴);`bin/devloop-ts` 執行它即可運作,無需 `npm install`。後續 task 每次改 src 都要重跑 bundle。

- [ ] **Step 1: 裝 esbuild(最新穩定版)**

Run:
```bash
cd plugins/dev-loop && npm install -D esbuild
```
不手寫版號,由 npm 解析最新穩定版。

- [ ] **Step 2: 加 bundle script**

在 `plugins/dev-loop/package.json` 的 `scripts` 加一行(保留既有 build/test/lint/pretest 不動):

```json
    "bundle": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist/cli.js"
```

- [ ] **Step 3: 取消 dist/ 的忽略**

`.gitignore` 現有 `plugins/dev-loop/dist/` 一行,**刪掉它**(保留 `plugins/dev-loop/node_modules/`)。

- [ ] **Step 4: 產生 bundle 並驗證可獨立執行**

Run:
```bash
cd plugins/dev-loop && npm run bundle
printf '{"phase":"gate","change_id":"c","branch":"b","iteration":1}' > /tmp/m2a-cp.json
node dist/cli.js status --file /tmp/m2a-cp.json
```
Expected: 印兩行,第一行 `phase=gate iteration=1 change_id=c branch=b`,第二行 `next: ` 開頭。

驗證 bundle 真的自足(這是本 task 的重點):
```bash
cd plugins/dev-loop && mv node_modules /tmp/nm-parked && node dist/cli.js status --file /tmp/m2a-cp.json; echo "exit=$?"; mv /tmp/nm-parked node_modules
```
Expected: 移走 `node_modules` 後仍正常輸出、`exit=0`。這證明 released plugin 只要 checkout 就能跑。

- [ ] **Step 5: CI 加 bundle 同步檢查**

`.github/workflows/ci.yml` 的 `ts` job,在 `- run: npm test` 之後追加:

```yaml
      - run: npm run bundle
      - name: Fail if dist/ is stale
        run: git diff --exit-code dist/
```

這樣「改了 src 卻忘記重新 bundle」會讓 CI 紅,而不是悄悄交付舊版。

- [ ] **Step 6: 本地模擬 CI 序列**

Run:
```bash
cd plugins/dev-loop && npm ci && npm run build && npm run lint && npm test && npm run bundle && git diff --exit-code dist/
```
Expected: 全部成功,最後一步無輸出(bundle 與 src 同步)。

- [ ] **Step 7: Commit**

```bash
rm -f /tmp/m2a-cp.json
git add plugins/dev-loop/package.json plugins/dev-loop/package-lock.json plugins/dev-loop/dist/cli.js .gitignore .github/workflows/ci.yml
git commit -m "build(ts): bundle engine to a committed single file, closing the delivery gap"
```

---

### Task 2: config 模組(TS 移植)

**Files:**
- Create: `plugins/dev-loop/src/config.ts`
- Create: `plugins/dev-loop/src/config.test.ts`

**Interfaces:**
- Consumes: Task 1 的工具鏈。
- Produces:
  - `interface Config { finish: string | null; auto_arm: boolean; gate_cmds: string[]; superpowers: boolean | null; auto_approve: boolean; model_profile: string | null; models: Record<string, string>; }`
  - `loadConfig(path: string): Config`(檔不存在回全預設)
  - `validateModelConfig(modelProfile: string | null, models: unknown): void`(非法拋 `Error`)
  - `resolveModel(stage: string, config: Config): string | null`
  - `validateGateCmds(gateCmds: unknown): string[]`(非法拋 `Error`)
  - `resolveFinish(config: Config, meta: ChangeMeta): string`(M2a Task 4 提供 `ChangeMeta`;本 task 先以結構型 `{ finish: string | null }` 定義參數以免循環依賴)
  - 常數:`VALID_MODEL_PROFILES`、`VALID_MODEL_STAGES`、`VALID_MODEL_ALIASES`、`VALID_FINISH_VALUES`

Python 原始碼在 `plugins/dev-loop/devloop/config.py`——**實作前完整讀過**,逐條對齊。

- [ ] **Step 1: 寫失敗測試**

建立 `plugins/dev-loop/src/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, resolveModel, resolveFinish, validateGateCmds, validateModelConfig,
} from "./config.js";

function tmpFile(content: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.json");
  writeFileSync(p, JSON.stringify(content), "utf-8");
  return p;
}

describe("loadConfig", () => {
  it("returns defaults when the file does not exist", () => {
    const c = loadConfig(join(mkdtempSync(join(tmpdir(), "cfg-")), "missing.json"));
    expect(c.finish).toBeNull();
    expect(c.auto_arm).toBe(true);
    expect(c.gate_cmds).toEqual([]);
    expect(c.superpowers).toBeNull();
    expect(c.auto_approve).toBe(false);
    expect(c.model_profile).toBeNull();
    expect(c.models).toEqual({});
  });

  it("reads values from the file", () => {
    const c = loadConfig(tmpFile({ finish: "merge", auto_arm: false, gate_cmds: ["pytest"] }));
    expect(c.finish).toBe("merge");
    expect(c.auto_arm).toBe(false);
    expect(c.gate_cmds).toEqual(["pytest"]);
  });

  it("treats auto_approve as true only for JSON true", () => {
    expect(loadConfig(tmpFile({ auto_approve: true })).auto_approve).toBe(true);
    expect(loadConfig(tmpFile({ auto_approve: "yes" })).auto_approve).toBe(false);
    expect(loadConfig(tmpFile({ auto_approve: 1 })).auto_approve).toBe(false);
  });

  it("throws on an invalid model_profile at load time", () => {
    expect(() => loadConfig(tmpFile({ model_profile: "cheap" }))).toThrow();
  });
});

describe("validateModelConfig", () => {
  it("accepts valid profiles and stage aliases", () => {
    expect(() => validateModelConfig("budget", { apply: "sonnet" })).not.toThrow();
    expect(() => validateModelConfig(null, {})).not.toThrow();
  });
  it("rejects an unknown stage key", () => {
    expect(() => validateModelConfig(null, { deploy: "sonnet" })).toThrow();
  });
  it("rejects a full model id instead of an alias", () => {
    expect(() => validateModelConfig(null, { apply: "claude-sonnet-5" })).toThrow();
  });
  it("rejects a non-object models value", () => {
    expect(() => validateModelConfig(null, ["sonnet"])).toThrow();
  });
});

describe("resolveModel", () => {
  const base = { finish: null, auto_arm: true, gate_cmds: [], superpowers: null,
                 auto_approve: false, model_profile: null, models: {} };
  it("returns null when nothing is configured (inherit session model)", () => {
    expect(resolveModel("apply", base)).toBeNull();
  });
  it("prefers an explicit per-stage override", () => {
    expect(resolveModel("apply", { ...base, models: { apply: "opus" } })).toBe("opus");
  });
  it("routes apply and fix to sonnet under the budget profile", () => {
    const budget = { ...base, model_profile: "budget" };
    expect(resolveModel("apply", budget)).toBe("sonnet");
    expect(resolveModel("fix", budget)).toBe("sonnet");
  });
  it("leaves gatekeeping stages inheriting under the budget profile", () => {
    const budget = { ...base, model_profile: "budget" };
    expect(resolveModel("brainstorm", budget)).toBeNull();
    expect(resolveModel("review", budget)).toBeNull();
  });
  it("throws for an unknown stage", () => {
    expect(() => resolveModel("deploy", base)).toThrow();
  });
});

describe("validateGateCmds", () => {
  it("accepts a list of non-empty strings", () => {
    expect(validateGateCmds(["pytest", "ruff check"])).toEqual(["pytest", "ruff check"]);
  });
  it("rejects a non-list, an empty string, and a non-string element", () => {
    expect(() => validateGateCmds("pytest")).toThrow();
    expect(() => validateGateCmds([""])).toThrow();
    expect(() => validateGateCmds(["  "])).toThrow();
    expect(() => validateGateCmds([1])).toThrow();
  });
});

describe("resolveFinish", () => {
  const cfg = (finish: string | null) => ({ finish, auto_arm: true, gate_cmds: [],
    superpowers: null, auto_approve: false, model_profile: null, models: {} });
  it("defaults to ask when neither source sets it", () => {
    expect(resolveFinish(cfg(null), { finish: null })).toBe("ask");
  });
  it("lets change metadata override the global config", () => {
    expect(resolveFinish(cfg("merge"), { finish: "pr" })).toBe("pr");
  });
  it("falls back to the config value when metadata is unset", () => {
    expect(resolveFinish(cfg("merge"), { finish: null })).toBe("merge");
  });
  it("throws on an invalid value even when it would be overridden", () => {
    expect(() => resolveFinish(cfg("bogus"), { finish: "merge" })).toThrow();
    expect(() => resolveFinish(cfg("merge"), { finish: "bogus" })).toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/config.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 寫 config.ts**

逐條移植 `devloop/config.py`。要點:
- `loadConfig` 在檔案不存在時回全預設,不拋錯。
- 載入時就呼叫 `validateModelConfig`(設定壞掉要在 loop 開頭炸,不是跑到 apply 才發現)。
- `auto_approve` 只認 JSON `true`(`data.get("auto_approve", False) is True` 的等價寫法:`data.auto_approve === true`),因為它管的是「略過人工」,解析錯誤必須朝保守方向退化。
- `auto_arm` 用 `Boolean()` 轉換(Python 是 `bool(...)`)。
- `resolveModel` 決議順序:`models` override → `budget` 查表(`{apply: "sonnet", fix: "sonnet"}`)→ `null`。
- `resolveFinish` 對 `config.finish` 與 `meta.finish` **各自獨立驗證**,即使會被 override 也要驗(typo 不得靜默吞掉),錯誤訊息含來源與值。

`resolveFinish` 的 meta 參數用結構型別宣告以免與 Task 4 循環依賴:

```typescript
export function resolveFinish(config: Config, meta: { finish: string | null }): string
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/config.test.ts`
Expected: PASS(全項)

- [ ] **Step 5: 跨實作比對驗證**

寫一支暫存腳本,對同一組 config JSON(涵蓋:空檔、只設 finish、budget profile、models override、非法 model_profile、非法 gate_cmds)分別跑 Python 與 TS,比對 `loadConfig` 各欄位與 `resolveModel` 四個 stage 的結果、以及哪些輸入會拋錯。全部須一致。

Python 側呼叫方式(從 repo 根):
```bash
PYTHONPATH=plugins/dev-loop python3 -c "from devloop.config import load_config, resolve_model; ..."
```

回報比對組數與結果。腳本在 commit 前刪除。

- [ ] **Step 6: build + lint + 全測試 + 重新 bundle**

Run:
```bash
cd plugins/dev-loop && npm run build && npm run lint && npm test && npm run bundle
```
Expected: 全綠。(`config.ts` 尚未被 `cli.ts` 匯入,bundle 內容可能不變,但仍要跑以維持同步。)

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-loop/src/config.ts plugins/dev-loop/src/config.test.ts plugins/dev-loop/dist/cli.js
git commit -m "feat(ts): port config module (behavior-matched to Python)"
```

---

### Task 3: history 模組(TS 移植)

**Files:**
- Create: `plugins/dev-loop/src/history.ts`
- Create: `plugins/dev-loop/src/history.test.ts`

**Interfaces:**
- Consumes: Task 1 工具鏈。
- Produces:
  - `historyPath(checkpointPath: string): string`(與 checkpoint 同目錄的 `history.jsonl`)
  - `appendHistory(checkpointPath: string, event: string, fromPhase: string, toPhase: string, iteration: number): void`

Python 原始碼:`plugins/dev-loop/devloop/history.py`。每筆記錄的欄位是 `ts`/`event`/`from`/`to`/`iteration`——注意 `from` 與 `to` 是保留字風格的鍵名,JSON 鍵必須完全一致。

- [ ] **Step 1: 寫失敗測試**

建立 `plugins/dev-loop/src/history.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPath, appendHistory } from "./history.js";

describe("history", () => {
  it("places history.jsonl beside the checkpoint", () => {
    expect(historyPath("/a/b/.devloop/checkpoint.json")).toBe("/a/b/.devloop/history.jsonl");
  });

  it("appends one JSON object per line with the exact Python key names", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const cp = join(dir, "checkpoint.json");
    appendHistory(cp, "apply_done", "apply", "gate", 0);
    appendHistory(cp, "gate_pass", "gate", "qa", 1);
    const lines = readFileSync(join(dir, "history.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(Object.keys(first).sort()).toEqual(["event", "from", "iteration", "to", "ts"]);
    expect(first.event).toBe("apply_done");
    expect(first.from).toBe("apply");
    expect(first.to).toBe("gate");
    expect(first.iteration).toBe(0);
    expect(typeof first.ts).toBe("string");
    expect(JSON.parse(lines[1]).to).toBe("qa");
  });

  it("creates the parent directory when it does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const cp = join(dir, "nested", "checkpoint.json");
    appendHistory(cp, "apply_done", "apply", "gate", 0);
    expect(readFileSync(join(dir, "nested", "history.jsonl"), "utf-8")).toContain("apply_done");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/history.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 寫 history.ts**

移植 `devloop/history.py`。要點:
- append-only,一行一個 JSON,行尾換行。
- 父目錄不存在要自動建立(`mkdirSync(..., { recursive: true })`)。
- 時間戳用 ISO8601。注意:Python 用 `datetime.now(timezone.utc).isoformat()` 產生 `+00:00` 尾綴與微秒,TS 的 `toISOString()` 產生 `Z` 尾綴與毫秒。M1 已就 checkpoint 的同一差異做過裁定(兩者皆合法 ISO8601,現無任何程式解析此欄位),**沿用同一裁定,不特別處理**,但在報告中註明。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/history.test.ts`
Expected: PASS(3 項)

- [ ] **Step 5: 跨實作驗證**

用 Python 的 `append_history` 寫兩筆到某個 checkpoint 目錄,再用 TS 的 `appendHistory` 追加兩筆到**同一個檔**,確認:四行都是合法 JSON、鍵名集合一致、Python 之後仍能正常讀取(用 `python3 -c` 逐行 `json.loads`)。回報結果。

- [ ] **Step 6: build + lint + 全測試 + bundle**

Run: `cd plugins/dev-loop && npm run build && npm run lint && npm test && npm run bundle`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-loop/src/history.ts plugins/dev-loop/src/history.test.ts plugins/dev-loop/dist/cli.js
git commit -m "feat(ts): port history module (append-only JSONL)"
```

---

### Task 4: changemeta 與 finish 模組(TS 移植)

**Files:**
- Create: `plugins/dev-loop/src/changemeta.ts`
- Create: `plugins/dev-loop/src/changemeta.test.ts`
- Create: `plugins/dev-loop/src/finish.ts`
- Create: `plugins/dev-loop/src/finish.test.ts`

**Interfaces:**
- Consumes: Task 1 工具鏈。Task 2 的 `resolveFinish` 以結構型別 `{ finish: string | null }` 接收本 task 的 `ChangeMeta`,兩者相容。
- Produces:
  - `interface ChangeMeta { parallel_groups: unknown[]; needs_uiux: boolean; finish: string | null; flow_profile: string | null; }`
  - `loadChangeMeta(path: string): ChangeMeta`(檔不存在回全預設;非法 `flow_profile` 拋錯)
  - `isSerial(meta: ChangeMeta): boolean`
  - `VALID_FLOW_PROFILES`
  - `renderFollowup(notes: string[]): string`
  - `writeFollowup(path: string, notes: string[]): void`

兩個模組都小,合為一個 task(各自仍是獨立檔案)。Python 原始碼:`devloop/changemeta.py`、`devloop/finish.py`。

- [ ] **Step 1: 寫失敗測試(changemeta)**

建立 `plugins/dev-loop/src/changemeta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChangeMeta, isSerial } from "./changemeta.js";

function tmpMeta(content: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "meta-")), "meta.json");
  writeFileSync(p, JSON.stringify(content), "utf-8");
  return p;
}

describe("loadChangeMeta", () => {
  it("returns defaults when the file does not exist", () => {
    const m = loadChangeMeta(join(mkdtempSync(join(tmpdir(), "meta-")), "missing.json"));
    expect(m.parallel_groups).toEqual([]);
    expect(m.needs_uiux).toBe(false);
    expect(m.finish).toBeNull();
    expect(m.flow_profile).toBeNull();
  });

  it("reads the two orthogonal flow axes", () => {
    const m = loadChangeMeta(tmpMeta({ flow_profile: "light", needs_uiux: true }));
    expect(m.flow_profile).toBe("light");
    expect(m.needs_uiux).toBe(true);
  });

  it("throws on an invalid flow_profile at load time", () => {
    expect(() => loadChangeMeta(tmpMeta({ flow_profile: "medium" }))).toThrow();
  });
});

describe("isSerial", () => {
  it("treats zero or one parallel group as serial", () => {
    expect(isSerial({ parallel_groups: [], needs_uiux: false, finish: null, flow_profile: null })).toBe(true);
    expect(isSerial({ parallel_groups: ["g1"], needs_uiux: false, finish: null, flow_profile: null })).toBe(true);
  });
  it("treats two or more groups as parallel", () => {
    expect(isSerial({ parallel_groups: ["g1", "g2"], needs_uiux: false, finish: null, flow_profile: null })).toBe(false);
  });
});
```

- [ ] **Step 2: 寫失敗測試(finish)**

建立 `plugins/dev-loop/src/finish.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFollowup, writeFollowup } from "./finish.js";

describe("renderFollowup", () => {
  it("renders an empty string when there are no notes", () => {
    expect(renderFollowup([])).toBe("");
  });
  it("renders a heading, a blank line, and one bullet per note", () => {
    expect(renderFollowup(["rename x", "add docstring"]))
      .toBe("## Follow-up(non-blocking)\n\n- rename x\n- add docstring\n");
  });
});

describe("writeFollowup", () => {
  it("writes the rendered content to disk", () => {
    const p = join(mkdtempSync(join(tmpdir(), "fu-")), "followup.md");
    writeFollowup(p, ["note one"]);
    expect(readFileSync(p, "utf-8")).toBe("## Follow-up(non-blocking)\n\n- note one\n");
  });
  it("writes an empty file when there are no notes", () => {
    const p = join(mkdtempSync(join(tmpdir(), "fu-")), "followup.md");
    writeFollowup(p, []);
    expect(readFileSync(p, "utf-8")).toBe("");
  });
});
```

注意 `## Follow-up(non-blocking)` 使用的是全形括號,與 Python 原始碼一致——**實作前讀 `devloop/finish.py` 確認該字串逐字相同**,包含括號型別。

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/changemeta.test.ts src/finish.test.ts`
Expected: FAIL(兩個模組皆不存在)

- [ ] **Step 4: 寫 changemeta.ts 與 finish.ts**

移植對應 Python 模組。`loadChangeMeta` 的驗證與 `loadConfig` 同精神:壞設定在 start 就炸,不是跑到 qa 才發現。`renderFollowup` 的輸出格式逐字對齊 Python(標題行、空行、每筆 `- ` 前綴、結尾換行)。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/changemeta.test.ts src/finish.test.ts`
Expected: PASS(全項)

- [ ] **Step 6: 跨實作比對**

對 `renderFollowup` 用同一組 notes(空、單筆、多筆、含中文與特殊字元)分別跑 Python 與 TS,**逐位元組比對輸出**(這是會寫進 PR body 的文字,格式差異會被看見)。對 `loadChangeMeta` 比對三種輸入(空檔、合法 light、非法 profile)的結果與拋錯行為。回報結果。

- [ ] **Step 7: build + lint + 全測試 + bundle**

Run: `cd plugins/dev-loop && npm run build && npm run lint && npm test && npm run bundle`
Expected: 全綠。

- [ ] **Step 8: Commit**

```bash
git add plugins/dev-loop/src/changemeta.ts plugins/dev-loop/src/changemeta.test.ts plugins/dev-loop/src/finish.ts plugins/dev-loop/src/finish.test.ts plugins/dev-loop/dist/cli.js
git commit -m "feat(ts): port changemeta and finish modules"
```

---

### Task 5: openspec 模組(TS 移植)

**Files:**
- Create: `plugins/dev-loop/src/openspec.ts`
- Create: `plugins/dev-loop/src/openspec.test.ts`

**Interfaces:**
- Consumes: Task 1 工具鏈。
- Produces:
  - `interface OpenSpecResult { ok: boolean; command: string[]; output: string; }`
  - `type Runner = (cmd: string[]) => [number, string]`
  - `defaultRunner: Runner`(匯出,讓子程序分支可被直接測試——見 Step 5)
  - `validateChange(changeId: string, runner?: Runner): OpenSpecResult`
  - `archiveChange(changeId: string, runner?: Runner): OpenSpecResult`

這是 M2a 唯一會呼叫外部子程序的模組,但它的設計已經可注入 runner——**測試一律注入假 runner,不真的呼叫 `openspec`**,所以測試不需要環境裝有該 CLI。

Python 原始碼:`devloop/openspec.py`。命令列參數必須逐字一致(`validate <id> --strict --no-interactive`、`archive <id> --yes`)——這些是外部 CLI 契約,寫錯會在真實環境炸掉而測試抓不到。

- [ ] **Step 1: 寫失敗測試**

建立 `plugins/dev-loop/src/openspec.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateChange, archiveChange } from "./openspec.js";

describe("validateChange", () => {
  it("issues the exact openspec validate command", () => {
    let seen: string[] = [];
    validateChange("add-foo", (cmd) => { seen = cmd; return [0, ""]; });
    expect(seen).toEqual(["openspec", "validate", "add-foo", "--strict", "--no-interactive"]);
  });
  it("reports ok on exit code zero", () => {
    const r = validateChange("add-foo", () => [0, "fine"]);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("fine");
  });
  it("reports not ok on a non-zero exit code and keeps the output", () => {
    const r = validateChange("add-foo", () => [1, "spec broken"]);
    expect(r.ok).toBe(false);
    expect(r.output).toBe("spec broken");
    expect(r.command).toEqual(["openspec", "validate", "add-foo", "--strict", "--no-interactive"]);
  });
});

describe("archiveChange", () => {
  it("issues the exact openspec archive command", () => {
    let seen: string[] = [];
    archiveChange("add-foo", (cmd) => { seen = cmd; return [0, ""]; });
    expect(seen).toEqual(["openspec", "archive", "add-foo", "--yes"]);
  });
  it("reports not ok on a non-zero exit code", () => {
    expect(archiveChange("add-foo", () => [2, "boom"]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd plugins/dev-loop && npx vitest run src/openspec.test.ts`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 寫 openspec.ts**

移植 `devloop/openspec.py`。預設 runner 用 `node:child_process` 的 `spawnSync`,擷取 stdout 與 stderr 並串接(Python 是 `(proc.stdout or "") + (proc.stderr or "")`),回 `[returncode, output]`。`ok` 判定為 `code === 0`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd plugins/dev-loop && npx vitest run src/openspec.test.ts`
Expected: PASS(5 項)

- [ ] **Step 5: 驗證預設 runner 真的能跑子程序**

假 runner 證明不了預設路徑可用——所有測試都注入 runner,預設的 `spawnSync` 分支等於沒被執行過。

把預設 runner 匯出(命名 `defaultRunner`)讓它可被直接驗證,然後寫一支暫存腳本對一個必定存在的命令實測:

```bash
cd plugins/dev-loop && cat > /tmp/runner-check.mjs <<'EOF'
import { defaultRunner } from "./dist/openspec.js";
const [code, out] = defaultRunner(["node", "-e",
  "process.stdout.write('o'); process.stderr.write('e'); process.exit(3)"]);
console.log("code=" + code, "output=" + JSON.stringify(out));
EOF
node /tmp/runner-check.mjs; rm /tmp/runner-check.mjs
```

Expected: `code=3 output="oe"` —— 證明 exit code 正確傳遞、stdout 與 stderr 依 Python 的順序串接。回報實際輸出。

(若 `dist/openspec.js` 尚未存在,先 `npm run build`;此處讀的是 tsc 輸出而非 bundle。)

- [ ] **Step 6: build + lint + 全測試 + bundle**

Run: `cd plugins/dev-loop && npm run build && npm run lint && npm test && npm run bundle`
Expected: 全綠。

- [ ] **Step 7: Commit**

```bash
git add plugins/dev-loop/src/openspec.ts plugins/dev-loop/src/openspec.test.ts plugins/dev-loop/dist/cli.js
git commit -m "feat(ts): port openspec module (injectable runner)"
```

---

## 實作後驗收

M2a 全部完成後應成立:

- `npm test` 全綠(M1 的 57 + 本里程碑新增)、`npm run build`、`npm run lint` 乾淨。
- `python3 -m pytest -q` 仍 382 passed(雙軌未破)。
- `npm run bundle && git diff --exit-code dist/` 無輸出(bundle 與 src 同步)。
- **交付阻斷點已關**:移走 `node_modules/` 後 `node plugins/dev-loop/dist/cli.js status --file <cp>` 仍正常運作。
- `plugins/dev-loop/devloop/` 下無任何檔案被改動(`git diff --stat` 驗證)。

## 不在本 plan 範圍(M2b / M2c)

- M2b:`gate`、`review`、`worktree`、`units`、`housekeeping`、`teardown`、`adapter`、`watcher` 移植。
- M2c:24 個 CLI 子命令與 `units_cli` 移植;刪除 Python 引擎與其 382 個測試;`bin/devloop` 改指向 TS;check-deps 前置從 `python3` 改 `node`;README/command doc 同步。
- M1 final review 遺留的 deferred 項(`main()` 的 error→exit-code 契約、`loadCheckpoint` 未驗證轉型、key order、`process.exit()` 截斷、測試檔未型別檢查、`engineVersion()` 版號漂移)——多數屬 M2c 的 CLI 範圍,在該 plan 一併處理。

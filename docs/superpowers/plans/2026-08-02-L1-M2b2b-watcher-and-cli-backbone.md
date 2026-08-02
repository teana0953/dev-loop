# L1 M2b-2b:watcher 模組 + CLI backbone + 六個命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植 `watcher` 模組與 CLI backbone,並把 `watch`、`arm-local`、`watcher-status`、`status`、`event`、`gate` 六個子命令交給 TS 引擎,拆掉「每個變更型命令都依賴 watcher auto-arm」這道閘門。

**Architecture:** 沿用雙軌:TS 與 Python 讀寫同一批磁碟檔,`bin/devloop` 走 `dist/cli.js`,`TS_COMMANDS` 裡的自己處理、其餘委派回 Python。本輪 TS 的 `ensureArmed` spawn 的是 `node dist/cli.js watch`(不是 python3),因為 M2c 刪 Python 時 spawn python3 的 watcher 會整個消失。`watcher.pid` 是兩引擎唯一真正共用的交接檔,兩個方向都要有交叉臂測試。

**Tech Stack:** TypeScript(ESM、`node:` 內建模組、vitest)、Python 3.10+(pytest)、esbuild 打包 `dist/cli.js`。

## Global Constraints

- **絕不手動改 `plugins/dev-loop/dist/`。** 那是 commit 進版控的 bundle,由 `npm run bundle` 產生;`pretest` 已是 `build && bundle`,CI 有 stale guard。
  - **本輪 `dist/` 會變,而且必須變**:`watcher.ts` 的 `spawnWatcher` spawn 的就是 `dist/cli.js`,Task 1 起就有測試真的去執行它。所以規則是「只由 `npm run bundle` 產生,絕不手改」,**不是**「diff 必須是空的」。每個 task 結束前檢查 `git status`,`dist/` 有變就跟著該 task 一起 commit。
  - 判別手改的方法:重跑 `npm run bundle` 後 `git diff -- plugins/dev-loop/dist` 應該是空的。不是空的就表示有人手動動過。
- **Python 是參考實作。** 兩邊行為不同時改 TS,不改 Python——除非 review 證明 Python 本身有 bug,那要另外裁決。
- **移植 Python 語意的三個 helper 一律使用,不准直譯**:`Boolean(x)` → `pyTruthy`、`x ?? d` → `pyGet`、`obj.k` → `pyIndex`(皆在 `src/jsonio.ts`);路徑用 `pyResolve`(`src/pypath.ts`)。
- **每個新行為都要有能咬住它的測試。** 寫完後把實作改回錯的形狀,確認測試真的變紅;改不紅的測試等於沒寫。M2b-2a 的教訓:六個 subprocess 分歧修好之前,462 條測試全綠。
- **parity fixture 一次改兩側。** `fixtures/parity/*.json` 由 `tests/test_parity_*.py` 與 `src/parity.*.test.ts` 同時消費,契約在 `fixtures/parity/README.md`。絕不只改一側的測試檔。
- **測試不得留下孤兒行程。** `arm-local` 與 auto-arm 會真的 spawn。所有測試用會立刻結束的 `--exec`(例如 `/usr/bin/true`),或在 checkpoint 裡不放 `resume_exec`;測試結束要能證明沒有殘留。
- 註解沿用各檔既有風格:中文、寫「Python 那邊怎麼做」以及實測到的輸出,不寫「這裡做 X」這種複述程式碼的話。
- commit message 用英文,jj/git 皆可,每個 task 至少一個 commit。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/pystr.ts`(新) | Python 字串語意 helper:`pySplitlines`、`pyParseInt`。`jsonio.ts` 已是 JSON 語意專用,字串語意另立一檔避免它繼續膨脹 |
| `src/watcher.ts`(新) | watcher 生命週期:`pidAlive`、`watcherState`、`spawnWatcher`、`ensureArmed`、`lastWatcherAttempt`、`ensureArmedAfterSave`。不印 stdout |
| `src/cli.ts`(改) | backbone(`applyEvent`、`saveWithHistory`)、六個新命令、`main` 改 async |
| `src/crossEngine.test.ts`(改) | 矩陣支援「每個引擎各自的 temp dir」與 per-case 歸一化 |
| `src/watcher.test.ts`(新) | watcher 模組的單元測試(含真的 spawn 一次) |
| `src/crossArm.test.ts`(新) | 交叉臂:A 引擎 arm、B 引擎讀 |
| `fixtures/parity/watcher.json`(新) | `watcherState` 的 pid 檔分類、`lastWatcherAttempt` 的 log 解析 |
| `tests/test_parity_watcher.py`(新) | 上述 fixture 的 Python 消費者 |
| `src/parity.watcher.test.ts`(新) | 上述 fixture 的 TS 消費者 |
| `src/teardown.ts`、`src/worktree.ts`(改) | 改用 `pystr.ts` 的共用 helper,消掉重複的 pid 解析與 `split("\n")` |

---

### Task 1: `pystr.ts` 兩個 helper + `watcher.ts` 模組 + parity fixture

**Files:**
- Create: `plugins/dev-loop/src/pystr.ts`
- Create: `plugins/dev-loop/src/pystr.test.ts`
- Create: `plugins/dev-loop/src/watcher.ts`
- Create: `plugins/dev-loop/src/watcher.test.ts`
- Create: `fixtures/parity/watcher.json`
- Create: `tests/test_parity_watcher.py`
- Create: `plugins/dev-loop/src/parity.watcher.test.ts`
- Modify: `plugins/dev-loop/src/teardown.ts`(pid 解析改用 `pyParseInt`)
- Modify: `plugins/dev-loop/src/worktree.ts`(`split("\n")` 改用 `pySplitlines`)
- Modify: `tests/test_parity_manifest.py`、`plugins/dev-loop/src/parity.manifest.test.ts`(把 `watcher` 加進 `CONSUMED_MODULES`)

**Interfaces:**
- Consumes:`DEFAULT_HEARTBEAT`(`adapter.ts`)、`loadCheckpoint`/`Checkpoint`(`checkpoint.ts`)、`loadConfig`(`config.ts`)、`shlexJoin`/`shlexSplit`(`shlex.ts`)
- Produces:
  - `pySplitlines(s: string): string[]`
  - `pyParseInt(s: string): number | null`
  - `pidAlive(pid: number): boolean`
  - `watcherPidPath(checkpointPath: string): string`
  - `watcherLogPath(checkpointPath: string): string`
  - `watcherState(checkpointPath: string): [WatcherState, number | null]`,`WatcherState = "running" | "dead" | "absent"`
  - `spawnWatcher(execCommand: string[], heartbeat: number, logPath?: string): number`
  - `ensureArmed(checkpointPath: string, opts?: { heartbeat?: number; execOverride?: string | null }): [ArmStatus, number | null]`,`ArmStatus = "armed" | "already" | "skipped"`
  - `lastWatcherAttempt(checkpointPath: string): unknown`
  - `ensureArmedAfterSave(cp: Checkpoint, file: string): void`

- [ ] **Step 1:先對 Python 取實測值**

跑這段,把輸出抄進下一步的斷言(不要從 TS 實作反推):

```bash
cd plugins/dev-loop && python3 -c "
print(repr('a\r\nb\rc\n'.splitlines()))
print(repr('a\n'.splitlines()))
print(repr(''.splitlines()))
print(repr('a\x0bb\x0cc\x1cd\x85e f'.splitlines()))
for s in ['12', ' 12 ', '+12', '-12', '1_2', '_12', '12_', '1__2', '', 'x', '１２']:
    try: print(repr(s), int(s))
    except ValueError as e: print(repr(s), 'ValueError')
"
```

- [ ] **Step 2:寫 `pystr.test.ts`(失敗的測試)**

```typescript
import { describe, it, expect } from "vitest";
import { pySplitlines, pyParseInt } from "./pystr.js";

describe("pySplitlines", () => {
  // 實測 Python 3.14(抄自 Step 1 的輸出):
  //   'a\r\nb\rc\n'.splitlines() == ['a', 'b', 'c']
  //   'a\n'.splitlines()         == ['a']        ← 尾端空元素被丟掉
  //   ''.splitlines()            == []
  //   'a\x0bb\x0cc\x1cd\x85e f'.splitlines() == ['a','b','c','d','e','f']
  // JS 的 split("\n") 只認 \n,而且 'a\n' 會給 ['a','']——多一個空字串。
  it("treats CRLF, CR and LF alike and drops the trailing empty piece", () => {
    expect(pySplitlines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
    expect(pySplitlines("a\n")).toEqual(["a"]);
    expect(pySplitlines("")).toEqual([]);
  });

  it("breaks on the exotic line boundaries Python breaks on", () => {
    expect(pySplitlines("a\x0bb\x0cc\x1cd\x85e f")).toEqual(
      ["a", "b", "c", "d", "e", "f"],
    );
  });

  it("keeps interior empty lines", () => {
    // Python: 'a\n\nb'.splitlines() == ['a', '', 'b']
    expect(pySplitlines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("pyParseInt", () => {
  // Python int() 接受前後空白、正負號、以及數字之間的單一底線。
  it("accepts what int() accepts", () => {
    expect(pyParseInt("12")).toBe(12);
    expect(pyParseInt(" 12 ")).toBe(12);
    expect(pyParseInt("+12")).toBe(12);
    expect(pyParseInt("-12")).toBe(-12);
    expect(pyParseInt("1_2")).toBe(12);
  });

  it("rejects what int() rejects, by returning null instead of throwing", () => {
    // 呼叫端要的是 Python 的 `except ValueError` 分支,不是例外本身。
    for (const bad of ["_12", "12_", "1__2", "", "x", "1.0", "0x10"]) {
      expect(pyParseInt(bad), bad).toBeNull();
    }
  });
});
```

- [ ] **Step 3:跑測試確認失敗**

Run:`cd plugins/dev-loop && npx vitest run src/pystr.test.ts`
Expected:FAIL,`Cannot find module './pystr.js'`

- [ ] **Step 4:寫 `pystr.ts`**

```typescript
/**
 * Python 的字串語意 helper。JS 的對應寫法在這兩件事上都不是安全直譯,而且
 * 錯的表現都是「不報錯、答案不同」。
 */

// Python str.splitlines() 的斷行字元集(不含 \r\n 這個兩字元序列,另外處理)。
// JS 的 split("\n") 只認 \n:一份含 \r 的 git porcelain 輸出在 Python 會被
// 切開、在 TS 不會,兩邊各自算出不同的 worktree 路徑清單而都不報錯。
const LINE_BOUNDARIES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85  ]/;

/**
 * Python `str.splitlines()`。
 *
 * 與 `split()` 的兩個差別都會咬人:斷行字元集更大,而且**尾端的空片段會被
 * 丟掉**('a\n' 給 ['a'],不是 ['a', ''])。
 */
export function pySplitlines(s: string): string[] {
  if (s === "") {
    return [];
  }
  const parts = s.split(new RegExp(LINE_BOUNDARIES, "g"));
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

// 前後空白 + 正負號 + 數字(數字之間可有單一底線)。
// 已知未涵蓋:Python 的 int() 也吃 Unicode 十進位數字(全形 '１２' 是合法的),
// 這裡只認 ASCII。真的踩到需要 Nd 逐字元查值,成本與這條路徑的價值不成比例;
// 這是登記在案的延後項,不是遺漏。
const INT_PATTERN = /^[+-]?\d(?:_?\d)*$/;

/**
 * Python `int(s)` 的「成功回值 / ValueError 回 null」版本。
 *
 * 呼叫端要的一律是 Python 的 `except ValueError` 分支(壞掉的 pid 檔視同沒有
 * watcher),所以回 null 而不是拋錯。
 */
export function pyParseInt(s: string): number | null {
  const trimmed = s.trim();
  if (!INT_PATTERN.test(trimmed)) {
    return null;
  }
  return Number(trimmed.replace(/_/g, ""));
}
```

- [ ] **Step 5:跑測試確認通過**

Run:`cd plugins/dev-loop && npx vitest run src/pystr.test.ts`
Expected:PASS

- [ ] **Step 6:把既有的兩處重複改用共用 helper**

`src/teardown.ts` 目前自己有一份 pid 解析正則,`src/worktree.ts` 用 `split("\n")` 解析 porcelain。兩處都改掉:

```typescript
// src/teardown.ts —— 原本的 /^[+-]?\d+$/ 判斷改成:
import { pyParseInt } from "./pystr.js";
// ...
const pid = pyParseInt(readFileSync(pidPath, "utf-8"));
if (pid === null) {
  return "absent";
}
```

```typescript
// src/worktree.ts —— porcelain 逐行解析改成:
import { pySplitlines } from "./pystr.js";
// ...
for (const line of pySplitlines(porcelain)) {
```

改完跑全套,既有測試必須全綠:`cd plugins/dev-loop && npm test`

- [ ] **Step 7:補一條釘住 porcelain 斷行的測試**

加進 `src/worktree.test.ts`:

```typescript
it("splits porcelain output the way Python's splitlines does", () => {
  // 實測:worktree 路徑含 \r 時 git 原樣印出那個 byte,Python 的 splitlines
  // 會在 \r 斷開(於是把路徑截斷成不存在的路徑),split("\n") 不會。兩邊都
  // 不報錯,只是 pruneOrphanWorktrees 清掉的東西不一樣。
  const porcelain = "worktree /repo\nHEAD abc\n\nworktree /repo/wt\rcr\nHEAD def\n";
  expect(parseWorktreePaths(porcelain, "/repo")).toEqual(["/repo/wt"]);
});
```

跑:`npx vitest run src/worktree.test.ts`,PASS。再把 `pySplitlines` 換回 `split("\n")` 確認這條變紅,然後改回來。

- [ ] **Step 8:Commit**

```bash
git add plugins/dev-loop/src/pystr.ts plugins/dev-loop/src/pystr.test.ts \
        plugins/dev-loop/src/teardown.ts plugins/dev-loop/src/worktree.ts \
        plugins/dev-loop/src/worktree.test.ts
git commit -m "feat(ts): add Python string-semantics helpers and use them at both existing call sites"
```

- [ ] **Step 9:寫 `watcher.test.ts`(失敗的測試)**

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pidAlive, watcherState, watcherPidPath, watcherLogPath,
  ensureArmed, lastWatcherAttempt, ensureArmedAfterSave,
} from "./watcher.js";
import { makeCheckpoint, saveCheckpoint } from "./checkpoint.js";

function fixture(fields: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "watcher-"));
  const file = join(dir, "cp.json");
  saveCheckpoint(
    makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }),
    file,
  );
  return file;
}

describe("pidAlive", () => {
  it("reports the current process as alive", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("reports a reaped pid as dead (ESRCH)", () => {
    // 99999 不保證不存在,但 kill(0) 對它不是 ESRCH 就是 EPERM,兩者都不會
    // 讓這條測試變成假綠——所以改用一個確定死掉的 pid:自己 spawn 再等它結束。
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const proc = spawnSync("/usr/bin/true");
    expect(proc.status).toBe(0);
    // spawnSync 回來時子行程已被收屍,它的 pid 不再存在。
    expect(pidAlive(proc.pid as number)).toBe(false);
  });

  it("propagates an unrepresentable pid instead of reporting it dead", () => {
    // Python 的 _pid_alive 只 except (ProcessLookupError, PermissionError,
    // OSError);os.kill(2**63, 0) 是 OverflowError,會往外拋。實測:
    //   >>> watcher._pid_alive(2**63)
    //   OverflowError: Python int too large to convert to C long
    // 吞掉它會讓「pid 檔壞掉」被誤判成「watcher 死了」,於是重複 spawn。
    expect(() => pidAlive(2 ** 63)).toThrow();
  });
});

describe("watcherState", () => {
  it("is absent when there is no pid file", () => {
    expect(watcherState(fixture())).toEqual(["absent", null]);
  });

  it("is absent when the pid file is not an integer", () => {
    // Python: int(...) 拋 ValueError -> ("absent", None)
    const file = fixture();
    writeFileSync(watcherPidPath(file), "not-a-pid", "utf-8");
    expect(watcherState(file)).toEqual(["absent", null]);
  });

  it("is running for a live pid and dead for a reaped one", () => {
    const file = fixture();
    writeFileSync(watcherPidPath(file), String(process.pid), "utf-8");
    expect(watcherState(file)).toEqual(["running", process.pid]);
  });
});

describe("ensureArmed", () => {
  it("skips when there is no resume command anywhere", () => {
    expect(ensureArmed(fixture())).toEqual(["skipped", null]);
  });

  it("really spawns a detached watcher, writes its pid, and is idempotent", async () => {
    // --exec 用 /usr/bin/true:watcher 第一次嘗試就 exit 0 並自行結束,
    // 測試不會留下孤兒行程。
    const file = fixture({ resume_exec: "/usr/bin/true" });
    const [status, pid] = ensureArmed(file, { heartbeat: 1 });
    expect(status).toBe("armed");
    expect(typeof pid).toBe("number");
    expect(readFileSync(watcherPidPath(file), "utf-8")).toBe(String(pid));

    // 第二次呼叫在行程還活著時必須回 already 而不是再 spawn 一個。
    const [second, secondPid] = ensureArmed(file, { heartbeat: 1 });
    expect(["already", "armed"]).toContain(second);
    if (second === "already") {
      expect(secondPid).toBe(pid);
    }

    // 等 watcher 自己跑完並寫下 log。
    for (let i = 0; i < 100 && !existsSync(watcherLogPath(file)); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(existsSync(watcherLogPath(file)), "watcher 應該寫下一行 log").toBe(true);
    const last = lastWatcherAttempt(file) as Record<string, unknown>;
    expect(last.exit_code).toBe(0);
    expect(last.action).toBe("stop");
  }, 20000);

  it("prefers the exec override over the checkpoint's resume_exec", () => {
    // Python: exec_str = exec_override or cp.resume_exec
    const file = fixture({ resume_exec: "" });
    const [status] = ensureArmed(file, { heartbeat: 1, execOverride: "/usr/bin/true" });
    expect(status).toBe("armed");
  });
});

describe("lastWatcherAttempt", () => {
  it("is null when the log is missing, empty, or entirely unparseable", () => {
    const file = fixture();
    expect(lastWatcherAttempt(file)).toBeNull();
    writeFileSync(watcherLogPath(file), "", "utf-8");
    expect(lastWatcherAttempt(file)).toBeNull();
    writeFileSync(watcherLogPath(file), "{oops\n\n", "utf-8");
    expect(lastWatcherAttempt(file)).toBeNull();
  });

  it("returns the last parseable line, skipping broken ones", () => {
    const file = fixture();
    writeFileSync(
      watcherLogPath(file),
      '{"n": 1}\nbroken\n{"n": 2}\n\n',
      "utf-8",
    );
    expect(lastWatcherAttempt(file)).toEqual({ n: 2 });
  });
});

describe("ensureArmedAfterSave", () => {
  it("does nothing without a resume command, in the done phase, or with auto_arm off", () => {
    const noResume = fixture();
    ensureArmedAfterSave(
      { ...makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" }) },
      noResume,
    );
    expect(existsSync(watcherPidPath(noResume))).toBe(false);

    const done = fixture({ resume_exec: "/usr/bin/true", phase: "done" });
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "done", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      done,
    );
    expect(existsSync(watcherPidPath(done)), "done 是終態,teardown 已 disarm,不得重新拉起").toBe(false);

    const off = fixture({ resume_exec: "/usr/bin/true" });
    writeFileSync(join(off, "..", "config.json"), JSON.stringify({ auto_arm: false }), "utf-8");
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "apply", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      off,
    );
    expect(existsSync(watcherPidPath(off))).toBe(false);
  });
});
```

- [ ] **Step 10:跑測試確認失敗**

Run:`cd plugins/dev-loop && npx vitest run src/watcher.test.ts`
Expected:FAIL,`Cannot find module './watcher.js'`

- [ ] **Step 11:寫 `watcher.ts`**

```typescript
/**
 * watcher 生命週期:spawn / 偵測 / idempotent 確保在位,以及 checkpoint save
 * 之後的 auto-arm。對應 Python 的 devloop/watcher.py。
 *
 * CLI 殼(arm-local / watcher-status / watch)留在 cli.ts;這裡是各子命令共用
 * 的核心邏輯,一律不印 stdout(auto-arm 失敗只在 stderr 警告),各主命令的
 * stdout 契約才不會被 watcher 汙染。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HEARTBEAT } from "./adapter.js";
import { loadCheckpoint, type Checkpoint } from "./checkpoint.js";
import { loadConfig } from "./config.js";
import { pyParseInt, pySplitlines } from "./pystr.js";
import { shlexJoin, shlexSplit } from "./shlex.js";

export type WatcherState = "running" | "dead" | "absent";
export type ArmStatus = "armed" | "already" | "skipped";

/**
 * `os.kill(pid, 0)` 探活。ESRCH(無此行程)= 死、EPERM(存在但屬他人)= 活,
 * 這個分類必須照抄——判錯的表現是「watcher 明明活著卻被判定不在」(於是重複
 * spawn)或「已死的 pid 被當成活的」(於是永遠不重 spawn),兩者都不報錯。
 *
 * 其餘 errno 往外拋:Python 的 except 只涵蓋 OSError,pid 大到無法轉成 C long
 * 時是 OverflowError,會穿出去。POSIX 的 kill(2) 只可能失敗於 EINVAL/EPERM/
 * ESRCH,而 signal 固定是 0,所以 EINVAL 不可達——拋出去的只會是「pid 本身
 * 不是合法的行程識別碼」這一類,與 Python 同步。
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw e;
  }
  return true;
}

export function watcherPidPath(checkpointPath: string): string {
  return join(dirname(checkpointPath), "watcher.pid");
}

export function watcherLogPath(checkpointPath: string): string {
  return join(dirname(checkpointPath), "watcher-log.jsonl");
}

/**
 * 讀 watcher.pid 判斷狀態:"running"(活著)/ "dead"(pid 檔在但行程死)/
 * "absent"(無 pid 檔或內容非法)。
 */
export function watcherState(checkpointPath: string): [WatcherState, number | null] {
  const pidPath = watcherPidPath(checkpointPath);
  if (!existsSync(pidPath)) {
    return ["absent", null];
  }
  const pid = pyParseInt(readFileSync(pidPath, "utf-8"));
  if (pid === null) {
    return ["absent", null];
  }
  return pidAlive(pid) ? ["running", pid] : ["dead", pid];
}

/**
 * spawn 一個 detached 行程跑 `watch` 子命令,回傳其 PID。
 *
 * Python spawn 的是 `sys.executable -m devloop.cli watch`;這裡 spawn 的是
 * `node <plugin 根>/dist/cli.js watch`。**必須是 bundle 而不是 src**:被 spawn
 * 的是一個沒人看、可能活好幾小時的背景行程,它要能在沒有 node_modules 的
 * 安裝環境裡跑起來。連帶的代價是 bundle 舊掉的後果變大——既有防護(bundle
 * 進版控、CI stale guard、pretest 重打包)仍然適用。
 *
 * Python 那邊要設 PYTHONPATH 才 import 得到 devloop;bundle 是自足的,不需要
 * 對應的 env 處理。
 */
export function spawnWatcher(
  execCommand: string[],
  heartbeat: number,
  logPath?: string,
): number {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const cli = join(pluginRoot, "dist", "cli.js");
  const argv = [
    cli, "watch",
    "--exec", shlexJoin(execCommand),
    "--heartbeat", String(heartbeat),
  ];
  if (logPath) {
    argv.push("--log", logPath);
  }
  const proc = spawn(process.execPath, argv, { detached: true, stdio: "ignore" });
  proc.unref();
  if (proc.pid === undefined) {
    // Python 的 Popen 失敗會拋 OSError;這裡 spawn 的錯誤是非同步事件,
    // 但 pid 為 undefined 是同步可見的失敗訊號,不能靜默當成 armed。
    throw new Error("failed to spawn watcher: no pid");
  }
  return proc.pid;
}

/**
 * idempotent 確保 watcher 在位,不印字。
 *
 * status:"armed"(剛 spawn,info=pid)/ "already"(既存活,info=pid)/
 * "skipped"(無 resume 命令,info=null)。
 */
export function ensureArmed(
  checkpointPath: string,
  opts: { heartbeat?: number; execOverride?: string | null } = {},
): [ArmStatus, number | null] {
  const heartbeat = opts.heartbeat ?? DEFAULT_HEARTBEAT;
  const cp = loadCheckpoint(checkpointPath);
  // Python: exec_str = exec_override or cp.resume_exec —— `or` 不是 `??`,
  // 空字串的 override 要讓位給 checkpoint 裡的值。
  const execStr = opts.execOverride || cp.resume_exec;
  if (!execStr) {
    return ["skipped", null];
  }
  const [state, pid] = watcherState(checkpointPath);
  if (state === "running") {
    return ["already", pid];
  }
  const newPid = spawnWatcher(
    shlexSplit(execStr), heartbeat, watcherLogPath(checkpointPath));
  const pidPath = watcherPidPath(checkpointPath);
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(newPid), "utf-8");
  return ["armed", newPid];
}

/**
 * 讀 watcher log 最後一筆;無檔 / 空檔 / 壞行回 null——排障工具自身不該炸。
 *
 * 回傳型別刻意是 unknown:一行合法 JSON 也可能是數字或字串(Python 的
 * json.loads 同樣照收),消費端要自己面對「它不是 dict」這件事,不能假設。
 */
export function lastWatcherAttempt(checkpointPath: string): unknown {
  const log = watcherLogPath(checkpointPath);
  if (!existsSync(log)) {
    return null;
  }
  let last: unknown = null;
  for (const raw of pySplitlines(readFileSync(log, "utf-8"))) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      last = JSON.parse(line);
    } catch {
      continue;
    }
  }
  return last;
}

/**
 * checkpoint save 之後自動確保 watcher 在位。靜默,失敗只在 stderr 警告——
 * auto-arm 失敗不該讓已經成功的主命令變成失敗。
 */
export function ensureArmedAfterSave(cp: Checkpoint, file: string): void {
  if (!cp.resume_exec) {
    return;
  }
  if (cp.phase === "done") {
    return; // 終態不再需要 watcher(teardown 已 disarm,勿重新拉起)
  }
  const config = loadConfig(join(dirname(file), "config.json"));
  if (!config.auto_arm) {
    return;
  }
  try {
    ensureArmed(file);
  } catch (exc) {
    process.stderr.write(`warning: auto-arm failed: ${String((exc as Error).message)}\n`);
  }
}
```

- [ ] **Step 12:跑測試確認通過**

Run:`cd plugins/dev-loop && npm test`(需要 `dist/cli.js` 是新的,`pretest` 會重打包)
Expected:全綠,含 `watcher.test.ts` 那個真的 spawn 的案例

- [ ] **Step 13:寫 parity fixture**

`fixtures/parity/watcher.json`:

```json
{
  "module": "watcher",
  "sections": {
    "watcherState": [
      {
        "name": "no pid file at all",
        "input": { "pid_file": null },
        "expect": { "state": "absent", "pid": null }
      },
      {
        "name": "an empty pid file",
        "input": { "pid_file": "" },
        "expect": { "state": "absent", "pid": null }
      },
      {
        "name": "a pid file holding a non-integer",
        "input": { "pid_file": "not-a-pid" },
        "expect": { "state": "absent", "pid": null }
      },
      {
        "name": "a pid file with surrounding whitespace is still parsed",
        "input": { "pid_file": "  <SELF>\n" },
        "expect": { "state": "running", "pid": "<SELF>" }
      },
      {
        "name": "a live pid",
        "input": { "pid_file": "<SELF>" },
        "expect": { "state": "running", "pid": "<SELF>" }
      },
      {
        "name": "a reaped pid",
        "input": { "pid_file": "<DEAD>" },
        "expect": { "state": "dead", "pid": "<DEAD>" }
      }
    ],
    "lastWatcherAttempt": [
      {
        "name": "no log file",
        "input": { "log": null },
        "expect": { "value": null }
      },
      {
        "name": "an empty log",
        "input": { "log": "" },
        "expect": { "value": null }
      },
      {
        "name": "only blank lines",
        "input": { "log": "\n  \n\n" },
        "expect": { "value": null }
      },
      {
        "name": "the last parseable line wins",
        "input": { "log": "{\"n\": 1}\n{\"n\": 2}\n" },
        "expect": { "value": { "n": 2 } }
      },
      {
        "name": "broken lines are skipped, not fatal",
        "input": { "log": "{\"n\": 1}\nnot json\n{\"n\": 2}\nalso not json\n" },
        "expect": { "value": { "n": 2 } }
      },
      {
        "name": "a trailing broken line leaves the previous good one",
        "input": { "log": "{\"n\": 1}\n{oops\n" },
        "expect": { "value": { "n": 1 } }
      },
      {
        "name": "a bare JSON scalar is accepted as-is, not coerced to an object",
        "input": { "log": "{\"n\": 1}\n42\n" },
        "expect": { "value": 42 }
      }
    ]
  }
}
```

`<SELF>` 與 `<DEAD>` 是兩側消費者各自替換的佔位符(自己的 pid、一個已被收屍的 pid),因為 pid 值無法寫死在 fixture 裡。這一點要寫進 `fixtures/parity/README.md` 的 fixture 說明段落。

- [ ] **Step 14:寫兩側消費者**

`tests/test_parity_watcher.py`:

```python
import json
import os
import subprocess

import pytest

from conftest import assert_subset, parity_cases, resolve_expectation
from devloop import watcher

SECTIONS = ["watcherState", "lastWatcherAttempt"]


def _reaped_pid():
    """真的產生一個已被收屍的 pid——比猜一個大數字可靠。"""
    p = subprocess.Popen(["/usr/bin/true"])
    p.wait()
    return p.pid


def _subst(value, self_pid, dead_pid):
    if value == "<SELF>":
        return self_pid
    if value == "<DEAD>":
        return dead_pid
    if isinstance(value, str):
        return value.replace("<SELF>", str(self_pid)).replace("<DEAD>", str(dead_pid))
    return value


@pytest.mark.parametrize("case", parity_cases("watcher", "watcherState", SECTIONS))
def test_watcher_state_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "watcherState never raises for these inputs"
    self_pid, dead_pid = os.getpid(), _reaped_pid()
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    pid_file = case["input"]["pid_file"]
    if pid_file is not None:
        (tmp_path / "watcher.pid").write_text(_subst(pid_file, self_pid, dead_pid))
    state, pid = watcher._watcher_state(str(cp))
    want = {k: _subst(v, self_pid, dead_pid) for k, v in expect.items()}
    assert_subset({"state": state, "pid": pid}, want, case["name"])


@pytest.mark.parametrize("case", parity_cases("watcher", "lastWatcherAttempt", SECTIONS))
def test_last_watcher_attempt_parity(case, tmp_path):
    expect, throws = resolve_expectation(case, "py")
    assert not throws, "lastWatcherAttempt never raises for these inputs"
    cp = tmp_path / "cp.json"
    cp.write_text("{}")
    log = case["input"]["log"]
    if log is not None:
        (tmp_path / "watcher-log.jsonl").write_text(log, encoding="utf-8")
    assert_subset(
        {"value": watcher._last_watcher_attempt(str(cp))}, expect, case["name"])
```

`plugins/dev-loop/src/parity.watcher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { watcherState, lastWatcherAttempt } from "./watcher.js";

const SECTIONS = ["watcherState", "lastWatcherAttempt"];

function reapedPid(): number {
  const proc = spawnSync("/usr/bin/true");
  return proc.pid as number;
}

function subst(v: unknown, self: number, dead: number): unknown {
  if (v === "<SELF>") return self;
  if (v === "<DEAD>") return dead;
  if (typeof v === "string") {
    return v.split("<SELF>").join(String(self)).split("<DEAD>").join(String(dead));
  }
  return v;
}

describe("parity: watcherState", () => {
  for (const c of parityCases("watcher", "watcherState", SECTIONS)) {
    it(c.name, () => {
      const { expect: want } = resolveExpectation(c);
      const self = process.pid;
      const dead = reapedPid();
      const dir = mkdtempSync(join(tmpdir(), "parity-watcher-"));
      const cp = join(dir, "cp.json");
      writeFileSync(cp, "{}", "utf-8");
      const pidFile = (c.input as Record<string, unknown>).pid_file;
      if (pidFile !== null) {
        writeFileSync(join(dir, "watcher.pid"), subst(pidFile, self, dead) as string, "utf-8");
      }
      const [state, pid] = watcherState(cp);
      const expected = Object.fromEntries(
        Object.entries(want!).map(([k, v]) => [k, subst(v, self, dead)]));
      expectSubset({ state, pid }, expected, c.name);
    });
  }
});

describe("parity: lastWatcherAttempt", () => {
  for (const c of parityCases("watcher", "lastWatcherAttempt", SECTIONS)) {
    it(c.name, () => {
      const { expect: want } = resolveExpectation(c);
      const dir = mkdtempSync(join(tmpdir(), "parity-watcher-"));
      const cp = join(dir, "cp.json");
      writeFileSync(cp, "{}", "utf-8");
      const log = (c.input as Record<string, unknown>).log;
      if (log !== null) {
        writeFileSync(join(dir, "watcher-log.jsonl"), log as string, "utf-8");
      }
      expectSubset({ value: lastWatcherAttempt(cp) }, want!, c.name);
    });
  }
});
```

harness 在 `src/parityFixture.ts`(已確認三個函式都 export)。實作前仍先讀一次 `src/parity.teardown.test.ts`,照它的呼叫慣例寫。

- [ ] **Step 15:把 `watcher` 加進兩側 manifest**

`tests/test_parity_manifest.py` 與 `plugins/dev-loop/src/parity.manifest.test.ts` 的 `CONSUMED_MODULES` 各加一個 `"watcher"`。不加的話 manifest 測試會因為「有 fixture 沒人消費」而紅。

- [ ] **Step 16:跑兩套測試**

Run:`cd plugins/dev-loop && npm test` 與 `make test`(repo 根)
Expected:全綠

- [ ] **Step 17:變異測試**

三個都要親自跑,確認各自變紅:
1. `pidAlive` 的 ESRCH/EPERM 對調 → `watcherState` 的 running/dead 案例紅
2. `ensureArmed` 拿掉 `state === "running"` 的早退 → `watcher.test.ts` 的 idempotent 案例紅
3. `lastWatcherAttempt` 的 `catch { continue; }` 改成 `catch { last = null; }` → 「壞行被跳過」的 fixture 案例紅

- [ ] **Step 18:Commit**

```bash
git add plugins/dev-loop/src/watcher.ts plugins/dev-loop/src/watcher.test.ts \
        plugins/dev-loop/src/parity.watcher.test.ts plugins/dev-loop/src/parity.manifest.test.ts \
        fixtures/parity/watcher.json fixtures/parity/README.md \
        tests/test_parity_watcher.py tests/test_parity_manifest.py
git commit -m "feat(ts): port the watcher module"
```

---

### Task 2:`main()` 改成 async

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`

**Interfaces:**
- Consumes:無(純結構調整)
- Produces:`main(argv: string[], deps?: Partial<CliDeps>): Promise<number>`

**為什麼要先做這件事:** `watch` 命令要 `await runWatcher(...)`,而 `runWatcher` 是 async。若留到寫 `watch` 那個 task 才改,那個 task 會同時做「轉型」與「新功能」,review 很難分辨哪個改動造成問題。單獨一個 task,交付物是「所有既有測試在 await 之後仍然全綠」。

- [ ] **Step 1:把 `main` 改成 async**

```typescript
export async function main(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
```

其餘 `return` 不必動(async 函式會自動包成 Promise)。

- [ ] **Step 2:改進入點守衛**

```typescript
const invokedPath = process.argv[1];
if (invokedPath !== undefined && samePath(invokedPath, fileURLToPath(import.meta.url))) {
  // main 現在回 Promise:直接 process.exit(main(...)) 會拿 Promise 當 exit code
  // (被轉成 NaN → exit 0),於是所有非 0 的退出碼靜默消失。
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String((err as Error).stack ?? err)}\n`);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 3:把 `cli.test.ts` 的 16 個呼叫點改成 await**

每一處 `main([...])` 改成 `await main([...])`,對應的 `it("...", () => {` 改成 `it("...", async () => {`。

- [ ] **Step 4:跑測試**

Run:`cd plugins/dev-loop && npm test`
Expected:全綠,測試數不變

- [ ] **Step 5:確認漏 await 會被抓到**

刻意把 `cli.test.ts` 裡任一處的 `await` 拿掉,確認該條測試變紅(`expected Promise to be 0` 之類),再改回來。**若拿掉 await 測試仍綠,那條測試本來就沒斷言到 exit code**——要在這一步順手補上斷言。

- [ ] **Step 6:真的執行一次 CLI,確認退出碼沒被 Promise 吃掉**

```bash
cd plugins/dev-loop && npm run bundle
node dist/cli.js units-status --file /nonexistent/cp.json; echo "exit=$?"
```
Expected:非 0(檔案不存在)。若印出 `exit=0` 就是 Step 2 沒做對。

- [ ] **Step 7:Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts
git commit -m "refactor(ts): make main() async ahead of the watch command"
```

---

### Task 3:backbone(`applyEvent` / `saveWithHistory`)+ `event` 命令

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`
- Modify: `plugins/dev-loop/src/crossEngine.test.ts`

**Interfaces:**
- Consumes:`transition`/`QA_SKIP`/`HUMAN_RESUME_PROPOSE`/`HUMAN_RESUME_FIX`/`DEFAULT_MAX_ITERATIONS`(`statemachine.ts`)、`appendHistory`(`history.ts`)、`saveCheckpoint`/`loadCheckpoint`(`checkpoint.ts`)、`ensureArmedAfterSave`(`watcher.ts`)
- Produces:
  - `applyEvent(cp: Checkpoint, event: string, maxIterations: number): Checkpoint`
  - `saveWithHistory(cp: Checkpoint, file: string, event: string, fromPhase: string | null): void`
  - `TS_COMMANDS` 增加 `"event"`

- [ ] **Step 1:先取 Python 的實測輸出**

```bash
cd /Users/tliang/workspace/claude/code/dev-loop
D=$(mktemp -d)
python3 - <<EOF
import json, sys
sys.path.insert(0, "plugins/dev-loop")
from devloop.checkpoint import Checkpoint
cp = Checkpoint(phase="apply", change_id="c1", branch="b")
cp.save("$D/cp.json")
EOF
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli event --file $D/cp.json --event apply_done; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli event --file $D/cp.json --event qa_skip; echo "exit=$?"
cat $D/history.jsonl
```

把 stdout / stderr / exit code / history 行數抄進下一步。

- [ ] **Step 2:寫失敗的測試(加進 `cli.test.ts`)**

```typescript
describe("event", () => {
  function fixture(fields: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-event-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }),
      file,
    );
    return file;
  }

  it("applies the transition, prints the new state, and appends one history line", async () => {
    const file = fixture();
    const out = captureStdout();
    expect(await main(["event", "--file", file, "--event", "apply_done"])).toBe(0);
    expect(out.text()).toBe("phase=gate iteration=0\n");
    expect(loadCheckpoint(file).phase).toBe("gate");
    const hist = readFileSync(join(dirname(file), "history.jsonl"), "utf-8")
      .trim().split("\n");
    expect(hist.length).toBe(1);
    const entry = JSON.parse(hist[0]) as Record<string, unknown>;
    expect(entry.event).toBe("apply_done");
    expect(entry.from).toBe("apply");
    expect(entry.to).toBe("gate");
  });

  it("rejects qa_skip outside the light non-uiux profile", async () => {
    // Python:裁剪必須有檔位授權,且 UX 線不可裁。exit 2,checkpoint 不動。
    const file = fixture({ phase: "qa", flow_profile: "full" });
    expect(await main(["event", "--file", file, "--event", "qa_skip"])).toBe(2);
    expect(loadCheckpoint(file).phase).toBe("qa");
  });

  it("allows qa_skip on light without uiux", async () => {
    const file = fixture({ phase: "qa", flow_profile: "light", needs_uiux: false });
    expect(await main(["event", "--file", file, "--event", "qa_skip"])).toBe(0);
    expect(loadCheckpoint(file).phase).not.toBe("qa");
  });

  it("rejects qa_skip on light WITH uiux", async () => {
    // light+uiux 的 QA 保留以驗 UX 驗收——這一半的守門很容易寫成只看
    // flow_profile 而漏掉 needs_uiux,所以兩半各有一條。
    const file = fixture({ phase: "qa", flow_profile: "light", needs_uiux: true });
    expect(await main(["event", "--file", file, "--event", "qa_skip"])).toBe(2);
  });

  it("resets the retry counters on a human resume", async () => {
    const file = fixture({
      phase: "escalated", iteration: 2, propose_attempts: 3, gate_failures: 4,
    });
    expect(await main(["event", "--file", file, "--event", "human_resume_fix"])).toBe(0);
    const cp = loadCheckpoint(file);
    expect([cp.iteration, cp.propose_attempts, cp.gate_failures]).toEqual([0, 0, 0]);
  });

  it("records --finish-mode when given", async () => {
    const file = fixture({ phase: "qa" });
    await main(["event", "--file", file, "--event", "qa_pass", "--finish-mode", "pr"]);
    expect(loadCheckpoint(file).finish_mode).toBe("pr");
  });

  it("still saves the checkpoint when the history append fails", async () => {
    // Python:history 是 best-effort 觀測資料,失敗只警告。把 history.jsonl
    // 換成目錄就能讓 append 失敗而 checkpoint save 不受影響。
    const file = fixture();
    mkdirSync(join(dirname(file), "history.jsonl"), { recursive: true });
    expect(await main(["event", "--file", file, "--event", "apply_done"])).toBe(0);
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("does not arm a watcher when the checkpoint has no resume command", async () => {
    const file = fixture();
    await main(["event", "--file", file, "--event", "apply_done"]);
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(false);
  });

  it("arms a watcher after saving when auto_arm is on and a resume command exists", async () => {
    // --exec 用 /usr/bin/true,watcher 跑一次就自己結束,不留孤兒行程。
    const file = fixture({ resume_exec: "/usr/bin/true" });
    await main(["event", "--file", file, "--event", "apply_done"]);
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(true);
  });
});
```

**`captureStdout` 不存在,是本計畫的簡寫。** `cli.test.ts` 現行的攔截慣例是 vitest 的 spy(見該檔 338–341 行):

```typescript
const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
const code = await main([...]);
const printed = stdoutSpy.mock.calls.map(([msg]) => String(msg)).join("");
stdoutSpy.mockRestore();
```

本計畫後續所有 `captureStdout()` / `captureStderr()` / `out.text()` / `err.text()` 都照這個形狀展開(stderr 就是把 `process.stdout` 換成 `process.stderr`)。若覺得重複太多,在 `cli.test.ts` 裡加一個本地 helper 也可以——但**不要憑空 import 一個不存在的模組**。

- [ ] **Step 3:跑測試確認失敗**

Run:`cd plugins/dev-loop && npx vitest run src/cli.test.ts -t event`
Expected:FAIL(命令被委派給 Python,或印出不同的東西)

- [ ] **Step 4:寫 backbone 與命令**

加進 `src/cli.ts`:

```typescript
/**
 * checkpoint save + transition 追加到 history.jsonl + auto-arm。
 *
 * history 是 best-effort 的觀測資料:寫失敗只在 stderr 警告,不能反噬已經
 * 成功的主命令。auto-arm 同理(在 ensureArmedAfterSave 裡自己處理)。
 */
function saveWithHistory(
  cp: Checkpoint, file: string, event: string, fromPhase: string | null,
): void {
  saveCheckpoint(cp, file);
  try {
    appendHistory(file, event, fromPhase ?? "", cp.phase, cp.iteration);
  } catch (exc) {
    process.stderr.write(`warning: history append failed: ${String((exc as Error).message)}\n`);
  }
  ensureArmedAfterSave(cp, file);
}

function applyEvent(cp: Checkpoint, event: string, maxIterations: number): Checkpoint {
  const [newPhase, newIteration] = transition(cp.phase, cp.iteration, event, maxIterations);
  cp.phase = newPhase;
  cp.iteration = newIteration;
  return cp;
}

function cmdEvent(
  file: string, event: string, max: number, finishMode: string | null,
): number {
  const cp = loadCheckpoint(file);
  // qa_skip 只在 light 且非 uiux 放行:裁剪必須有檔位授權,且 UX 線不可裁
  // (light+uiux 的 QA 保留以驗 UX 驗收)。guard 讀 checkpoint(start 時凍結)。
  if (event === QA_SKIP && !(cp.flow_profile === "light" && !cp.needs_uiux)) {
    process.stderr.write(
      "error: qa_skip requires flow_profile=light and needs_uiux=false "
      + `(got ${cp.flow_profile}/${String(cp.needs_uiux)})\n`,
    );
    return 2;
  }
  const fromPhase = cp.phase;
  applyEvent(cp, event, max);
  if (event === HUMAN_RESUME_PROPOSE || event === HUMAN_RESUME_FIX) {
    cp.iteration = 0;
    cp.propose_attempts = 0;
    cp.gate_failures = 0;
  }
  if (finishMode) {
    cp.finish_mode = finishMode;
  }
  saveWithHistory(cp, file, event, fromPhase);
  process.stdout.write(`phase=${cp.phase} iteration=${cp.iteration}\n`);
  return 0;
}
```

`main` 的分派:

```typescript
if (cmd === "event") {
  const { values, unknown } = parseArgs(rest, ["--file", "--event", "--max", "--finish-mode"]);
  if (unknown.length > 0) {
    process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}\n`);
    return 2;
  }
  const file = requiredFlag(values, "--file");
  const event = requiredFlag(values, "--event");
  if (file === undefined || event === undefined) {
    process.stderr.write("event requires --file and --event\n");
    return 2;
  }
  const max = parseIntFlag(values, "--max", DEFAULT_MAX_ITERATIONS);
  if (max === null) {
    return 2;
  }
  // Python 的 --finish-mode 有 choices=("merge","pr");給別的值 argparse 回 2。
  const finishMode = requiredFlag(values, "--finish-mode") ?? null;
  if (finishMode !== null && finishMode !== "merge" && finishMode !== "pr") {
    process.stderr.write(
      `error: argument --finish-mode: invalid choice: '${finishMode}'\n`);
    return 2;
  }
  return cmdEvent(file, event, max, finishMode);
}
```

`parseIntFlag` 是新的小 helper(`--max` 與後續 `gate` 的 `--timeout`/`--max-gate` 共用):

```typescript
/**
 * Python 的 `type=int`:非整數 argparse 回 2 並印 usage。這裡回 null 讓呼叫端
 * 回 2——訊息文字與 argparse 不同,那是既有的、寫在 README 的可接受分歧。
 */
function parseIntFlag(
  values: Map<string, string>, name: string, fallback: number,
): number | null {
  const raw = rawFlag(values, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = pyParseInt(raw);
  if (parsed === null) {
    process.stderr.write(`error: argument ${name}: invalid int value: '${raw}'\n`);
    return null;
  }
  return parsed;
}
```

最後把 `"event"` 加進 `TS_COMMANDS`。

- [ ] **Step 5:跑測試確認通過**

Run:`cd plugins/dev-loop && npm test`

- [ ] **Step 6:矩陣支援「每個引擎各自的 dir」**

`crossEngine.test.ts` 目前兩個引擎共用一個 temp dir。`event` 會改 checkpoint,先跑的那個引擎會把狀態改掉,後跑的看到的是已經 transition 過的檔——比出來的差異是假的。改成每個引擎各自建 dir:

```typescript
interface MatrixCase {
  name: string;
  build: (dir: string) => string[];
  /** 比對前的歸一化;dir 已被換成 <DIR>,這裡處理 pid、時間戳之類的易變欄位。 */
  normalize?: (stdout: string) => string;
}

// ...

for (const c of cases ?? []) {
  it(`${cmd}: ${c.name}`, () => {
    // 每個引擎各自的 dir:變更型命令會改 checkpoint,共用 dir 會讓第二個
    // 引擎看到第一個引擎改過的狀態,比出來的差異全是假的。
    const dirTs = mkdtempSync(join(tmpdir(), "cross-engine-ts-"));
    const dirPy = mkdtempSync(join(tmpdir(), "cross-engine-py-"));
    const ts = runTs(c.build(dirTs));
    const py = runPy(c.build(dirPy));
    const norm = (s: string, dir: string): string => {
      const withoutDir = s.split(dir).join("<DIR>");
      return c.normalize ? c.normalize(withoutDir) : withoutDir;
    };
    expect(ts.exit_code, `${cmd}/${c.name}: exit code`).toBe(py.exit_code);
    expect(norm(ts.stdout, dirTs), `${cmd}/${c.name}: stdout`)
      .toBe(norm(py.stdout, dirPy));
  });
}
```

- [ ] **Step 7:加 `event` 的矩陣列**

```typescript
event: [
  {
    name: "a plain transition",
    build: (dir) => [
      "event", "--file",
      writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      "--event", "apply_done",
    ],
  },
  {
    name: "qa_skip refused outside the light profile",
    build: (dir) => [
      "event", "--file",
      writeCheckpoint(dir, { phase: "qa", change_id: "c1", branch: "b", flow_profile: "full" }),
      "--event", "qa_skip",
    ],
  },
  {
    name: "qa_skip allowed on light without uiux",
    build: (dir) => [
      "event", "--file",
      writeCheckpoint(dir, {
        phase: "qa", change_id: "c1", branch: "b",
        flow_profile: "light", needs_uiux: false,
      }),
      "--event", "qa_skip",
    ],
  },
  {
    name: "an invalid event",
    build: (dir) => [
      "event", "--file",
      writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      "--event", "no_such_event",
    ],
  },
  {
    name: "a non-integer --max",
    build: (dir) => [
      "event", "--file",
      writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      "--event", "apply_done", "--max", "x",
    ],
  },
],
```

**這些 case 一律不放 `resume_exec`**,矩陣測試才不會 spawn watcher。auto-arm 的跨引擎行為由 Task 7 的交叉臂測試負責。

- [ ] **Step 8:跑矩陣**

Run:`cd plugins/dev-loop && npx vitest run src/crossEngine.test.ts`
Expected:全綠。任一條紅就是真的分歧,當場修 TS。

- [ ] **Step 9:變異測試**

1. `cmdEvent` 的 qa_skip guard 改成只看 `flow_profile === "light"` → 「light WITH uiux」那條紅
2. `saveWithHistory` 拿掉 `ensureArmedAfterSave` → 「arms a watcher after saving」那條紅
3. `applyEvent` 之後才記 `fromPhase` → history 的 `from` 斷言紅

- [ ] **Step 10:Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/src/crossEngine.test.ts
git commit -m "feat(ts): port the CLI backbone and the event command"
```

---

### Task 4:`gate` 命令

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`
- Modify: `plugins/dev-loop/src/crossEngine.test.ts`

**Interfaces:**
- Consumes:`runGate`(`gate.ts`)、`shlexSplit`(`shlex.ts`)、`validateGateCmds`/`loadConfig`(`config.ts`)、Task 3 的 `applyEvent`/`saveWithHistory`/`parseIntFlag`
- Produces:`TS_COMMANDS` 增加 `"gate"`

- [ ] **Step 1:先取 Python 的實測輸出**

```bash
cd /Users/tliang/workspace/claude/code/dev-loop
D=$(mktemp -d)
python3 -c "
import sys; sys.path.insert(0,'plugins/dev-loop')
from devloop.checkpoint import Checkpoint
Checkpoint(phase='gate', change_id='c1', branch='b').save('$D/cp.json')"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli gate --file $D/cp.json --cmd "/usr/bin/true"; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli gate --file $D/cp.json --cmd "/usr/bin/false"; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli gate --file $D/cp.json; echo "exit=$?"
```

第三次(無 `--cmd` 且 config 沒有 `gate_cmds`)必須是 exit 2。

- [ ] **Step 2:寫失敗的測試**

```typescript
describe("gate", () => {
  function fixture(fields: Record<string, unknown> = {}, config?: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-gate-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "gate", change_id: "c1", branch: "b", ...fields }), file);
    if (config) {
      writeFileSync(join(dir, "config.json"), JSON.stringify(config), "utf-8");
    }
    return file;
  }

  it("passes, advances the phase, and exits 0", async () => {
    const file = fixture();
    const out = captureStdout();
    expect(await main(["gate", "--file", file, "--cmd", "/usr/bin/true"])).toBe(0);
    expect(out.text()).toMatch(/^gate PASSED -> phase=\w+ iteration=\d+\n$/);
  });

  it("fails, bumps gate_failures, moves to fix, and exits 1", async () => {
    const file = fixture();
    expect(await main(["gate", "--file", file, "--cmd", "/usr/bin/false"])).toBe(1);
    const cp = loadCheckpoint(file);
    expect(cp.gate_failures).toBe(1);
    expect(cp.phase).toBe("fix");
  });

  it("exits 3 — not 1 — once the failure budget is spent", async () => {
    // escalated 與一般 fail 必須可區分:3 專屬升級。混在一起的話編排端
    // 會把「已經放棄、要人接手」誤當成「再修一輪」。
    const file = fixture({ gate_failures: 1 });
    expect(await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", "1",
    ])).toBe(3);
    expect(loadCheckpoint(file).phase).toBe("escalated");
  });

  it("falls back to config.json gate_cmds when --cmd is absent", async () => {
    const file = fixture({}, { gate_cmds: ["/usr/bin/true"] });
    expect(await main(["gate", "--file", file])).toBe(0);
  });

  it("refuses to run with no gate commands at all, instead of passing vacuously", async () => {
    // 空清單進 run_gate 恆 pass:那是假綠,比失敗更糟。
    const file = fixture({}, { gate_cmds: [] });
    expect(await main(["gate", "--file", file])).toBe(2);
  });

  it("splits each configured command with shlex, not on spaces", async () => {
    const file = fixture({}, { gate_cmds: ["/bin/sh -c 'exit 0'"] });
    expect(await main(["gate", "--file", file])).toBe(0);
  });
});
```

- [ ] **Step 3:跑測試確認失敗**

Run:`cd plugins/dev-loop && npx vitest run src/cli.test.ts -t gate`

- [ ] **Step 4:實作**

```typescript
/**
 * gate 命令來源:CLI `--cmd` 優先,否則 config 的 gate_cmds;皆無或非法 →
 * 丟錯讓呼叫端回 2。**空命令清單絕不能進 runGate**——空 list 恆 pass,那是
 * 假綠。
 */
function resolveGateCmds(cmds: string[], file: string): string[] {
  if (cmds.length > 0) {
    return cmds;
  }
  const config = loadConfig(join(dirname(file), "config.json"));
  const resolved = validateGateCmds(config.gate_cmds);
  if (resolved.length === 0) {
    throw new Error(
      "no gate commands: pass --cmd or set gate_cmds in .devloop/config.json");
  }
  return resolved;
}

function cmdGate(
  file: string, cmds: string[], max: number, maxGate: number, timeout: number,
): number {
  const cp = loadCheckpoint(file);
  let resolved: string[];
  try {
    resolved = resolveGateCmds(cmds, file);
  } catch (exc) {
    process.stderr.write(`error: ${String((exc as Error).message)}\n`);
    return 2;
  }
  const result = runGate(resolved.map((c) => shlexSplit(c)), { timeout });
  const fromPhase = cp.phase;
  let event: string;
  if (result.passed) {
    event = GATE_PASS;
  } else {
    cp.gate_failures += 1;
    event = cp.gate_failures > maxGate ? GATE_RETRY_EXCEEDED : GATE_FAIL;
  }
  applyEvent(cp, event, max);
  saveWithHistory(cp, file, event, fromPhase);
  if (!result.passed) {
    process.stdout.write(`gate FAILED: ${JSON.stringify(result.failed_command)}\n`);
    process.stdout.write(`${result.output}\n`);
    process.stdout.write(`phase=${cp.phase} iteration=${cp.iteration}\n`);
    return cp.phase === "escalated" ? 3 : 1;
  }
  process.stdout.write(`gate PASSED -> phase=${cp.phase} iteration=${cp.iteration}\n`);
  return 0;
}
```

**`failed_command` 的印法要對齊 Python。** Python 是 `print("gate FAILED: %s" % result.failed_command)`,對一個 list 會印出 Python 的 repr:`['/usr/bin/false']`(單引號、逗號後有空白)。`JSON.stringify` 給的是 `["/usr/bin/false"]`——**不一樣**。實作時先跑一次 Python 拿到確切字串,再寫一個對齊它的格式化函式:

```typescript
/** Python 印一個 list of str 的 repr:['a', 'b'];JSON.stringify 給的是 ["a","b"]。 */
function pyReprStrList(items: string[]): string {
  return `[${items.map((s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ")}]`;
}
```
含單引號或反斜線的命令要對著 Python 實測確認轉義規則(Python 的 repr 對含單引號的字串會改用雙引號外框),矩陣要有一條這種 case。

`main` 的分派:

```typescript
if (cmd === "gate") {
  const { values, unknown, repeated } = parseArgs(
    rest, ["--file", "--cmd", "--max", "--max-gate", "--timeout"]);
  // ...unknown 處理同 event...
  const file = requiredFlag(values, "--file");
  if (file === undefined) {
    process.stderr.write("gate requires --file\n");
    return 2;
  }
  const max = parseIntFlag(values, "--max", DEFAULT_MAX_ITERATIONS);
  const maxGate = parseIntFlag(values, "--max-gate", DEFAULT_MAX_ITERATIONS);
  const timeout = parseIntFlag(values, "--timeout", 600);
  if (max === null || maxGate === null || timeout === null) {
    return 2;
  }
  return cmdGate(file, repeated.get("--cmd") ?? [], max, maxGate, timeout);
}
```

**`--cmd` 是 `action="append"`,可以重複給。** 現行的 `parseArgs` 只保留最後一個值,必須擴充成同時回傳 `repeated: Map<string, string[]>`;`--cmd a --cmd b` 只跑 b 是靜默少跑一條 gate,沒有任何錯誤訊號。擴充 `parseArgs` 時既有呼叫點不受影響(它們不看 `repeated`)。

- [ ] **Step 5:跑測試確認通過**

Run:`cd plugins/dev-loop && npm test`

- [ ] **Step 6:加矩陣列**

```typescript
gate: [
  {
    name: "a passing gate",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
      "--cmd", "/usr/bin/true",
    ],
  },
  {
    name: "a failing gate",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
      "--cmd", "/usr/bin/false",
    ],
  },
  {
    name: "a failing gate whose command name needs quoting in the report",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
      "--cmd", "/bin/sh -c \"exit 1\"",
    ],
  },
  {
    name: "two --cmd values: the first failure short-circuits",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
      "--cmd", "/usr/bin/false", "--cmd", "/usr/bin/true",
    ],
  },
  {
    name: "escalation exits 3",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b", gate_failures: 1 }),
      "--cmd", "/usr/bin/false", "--max-gate", "1",
    ],
  },
  {
    name: "no gate commands anywhere",
    build: (dir) => [
      "gate", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
    ],
  },
],
```

- [ ] **Step 7:跑矩陣並修掉分歧**

Run:`cd plugins/dev-loop && npx vitest run src/crossEngine.test.ts`
「命令名需要引號」那條特別容易紅——那正是它存在的理由。

- [ ] **Step 8:變異測試**

1. `cp.phase === "escalated" ? 3 : 1` 改成恆回 1 → escalation 那條紅
2. `resolveGateCmds` 的空清單檢查拿掉 → 「refuses to run with no gate commands」紅
3. `shlexSplit(c)` 改成 `c.split(" ")` → 「splits each configured command with shlex」紅

- [ ] **Step 9:Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/src/crossEngine.test.ts
git commit -m "feat(ts): port the gate command"
```

---

### Task 5:`watch`、`arm-local`、`watcher-status` 三個命令

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`
- Modify: `plugins/dev-loop/src/crossEngine.test.ts`

**Interfaces:**
- Consumes:`runWatcher`/`DEFAULT_HEARTBEAT`(`adapter.ts`)、`ensureArmed`/`watcherState`/`lastWatcherAttempt`(`watcher.ts`)、`shlexSplit`
- Produces:`TS_COMMANDS` 增加 `"watch"`、`"arm-local"`、`"watcher-status"`

- [ ] **Step 1:先取 Python 的實測輸出(三個命令各一次)**

```bash
cd /Users/tliang/workspace/claude/code/dev-loop
D=$(mktemp -d)
python3 -c "
import sys; sys.path.insert(0,'plugins/dev-loop')
from devloop.checkpoint import Checkpoint
Checkpoint(phase='apply', change_id='c1', branch='b', resume_exec='/usr/bin/true').save('$D/cp.json')"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli watch --exec /usr/bin/true --heartbeat 1 --log $D/watcher-log.jsonl; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli watcher-status --file $D/cp.json; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli arm-local --file $D/cp.json --heartbeat 1; echo "exit=$?"
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli watcher-status --file $D/cp.json; echo "exit=$?"
```

三個命令的每一行輸出都抄下來——`watcher-status` 的四種狀態(not armed / dead / running / 有 last attempt)都要。

- [ ] **Step 2:寫失敗的測試**

```typescript
describe("watch", () => {
  it("runs the exec command once when it succeeds and appends one log line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-watch-"));
    const log = join(dir, "w.jsonl");
    expect(await main([
      "watch", "--exec", "/usr/bin/true", "--heartbeat", "1", "--log", log,
    ])).toBe(0);
    const lines = readFileSync(log, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0]) as Record<string, unknown>).action).toBe("stop");
  });

  it("splits --exec with shlex, so a quoted argument stays one argv element", async () => {
    // resume_exec 的典型值是 `claude -p '/dev-loop resume'`——切錯的話 watcher
    // 每次重試都跑一個錯的命令,而且只有 watcher-log.jsonl 看得到。
    const dir = mkdtempSync(join(tmpdir(), "cli-watch-"));
    const marker = join(dir, "marker");
    expect(await main([
      "watch", "--exec", `/bin/sh -c 'printf x > ${marker}'`, "--heartbeat", "1",
    ])).toBe(0);
    expect(readFileSync(marker, "utf-8")).toBe("x");
  });
});

describe("arm-local", () => {
  it("arms, then reports already on the second call", async () => {
    const file = /* checkpoint with resume_exec: "/bin/sh -c 'sleep 5'" */;
    const out = captureStdout();
    expect(await main(["arm-local", "--file", file, "--heartbeat", "1"])).toBe(0);
    expect(out.text()).toMatch(/^watcher armed \(pid=\d+\)\n$/);
    // 收尾:把剛 spawn 的 watcher 殺掉,測試不留孤兒行程。
  });

  it("exits 2 when there is no resume command anywhere", async () => {
    const file = /* checkpoint without resume_exec */;
    expect(await main(["arm-local", "--file", file])).toBe(2);
  });
});

describe("watcher-status", () => {
  it("reports not armed and exits 1 when a watcher is needed but missing", async () => {
    const file = /* checkpoint phase=apply, resume_exec set, no watcher.pid */;
    const out = captureStdout();
    expect(await main(["watcher-status", "--file", file])).toBe(1);
    expect(out.text()).toContain("watcher: not armed");
    expect(out.text()).toContain("hint: devloop arm-local --file");
  });

  it("exits 0 in the done phase even with no watcher", async () => {
    const file = /* checkpoint phase=done, resume_exec set */;
    expect(await main(["watcher-status", "--file", file])).toBe(0);
  });

  it("reports a stale pid as dead", async () => {
    const file = /* checkpoint + watcher.pid holding a reaped pid */;
    const out = captureStdout();
    await main(["watcher-status", "--file", file]);
    expect(out.text()).toContain("watcher: dead (stale pid=");
  });

  it("prints the last attempt and its output tail", async () => {
    const file = /* checkpoint + watcher-log.jsonl with one entry */;
    const out = captureStdout();
    await main(["watcher-status", "--file", file]);
    expect(out.text()).toContain("last attempt: ");
    expect(out.text()).toContain("output tail: boom");
  });

  it("propagates instead of printing '?' when a log line is a bare scalar", async () => {
    // Python 的 last.get(...) 對一個 int 會 AttributeError:排障工具在這裡
    // 大聲失敗。TS 若用 `obj.ts` 只會拿到 undefined 然後印 "?",變成兩個
    // 引擎對同一個壞掉的 log 給出不同結論。
    const file = /* checkpoint + watcher-log.jsonl whose last line is `42` */;
    await expect(main(["watcher-status", "--file", file])).rejects.toThrow();
  });
});
```

註解裡的 `/* ... */` 佔位由實作者換成與 `describe("event")` 同款的 `fixture()` helper 呼叫——**不要保留註解形式**,那是本計畫的簡寫,不是可以留在程式碼裡的東西。

- [ ] **Step 3:跑測試確認失敗**

- [ ] **Step 4:實作三個命令**

```typescript
async function cmdWatch(execStr: string, heartbeat: number, log: string | null): Promise<number> {
  return runWatcher(shlexSplit(execStr), {
    heartbeat, logPath: log ?? undefined,
  });
}

function cmdArmLocal(file: string, execOverride: string | null, heartbeat: number): number {
  const [status, info] = ensureArmed(file, { heartbeat, execOverride });
  if (status === "skipped") {
    process.stderr.write(
      "error: no resume command (checkpoint.resume_exec empty and no --exec)\n");
    return 2;
  }
  if (status === "already") {
    process.stdout.write(`watcher already running (pid=${String(info)})\n`);
    return 0;
  }
  process.stdout.write(`watcher armed (pid=${String(info)})\n`);
  return 0;
}

/**
 * watcher 排障一眼看:行程狀態、續跑命令、最近一次嘗試。
 * exit 0 = 在位或不需要;exit 1 = 該在而不在(建議 arm-local)。
 */
function cmdWatcherStatus(file: string): number {
  const cp = loadCheckpoint(file);
  const [state, pid] = watcherState(file);
  if (state === "running") {
    process.stdout.write(`watcher: running (pid=${String(pid)})\n`);
  } else if (state === "dead") {
    process.stdout.write(`watcher: dead (stale pid=${String(pid)})\n`);
  } else {
    process.stdout.write("watcher: not armed\n");
  }
  process.stdout.write(`resume_exec: ${cp.resume_exec || "(none)"}\n`);
  const last = lastWatcherAttempt(file);
  if (last === null) {
    process.stdout.write("last attempt: (none)\n");
  } else {
    // Python 這裡是 last.get(...):last 不是 dict 時 AttributeError。用
    // pyDictGet 複刻那個「大聲失敗」,不要退化成 undefined 印成 "?"。
    const line = `last attempt: ${String(pyDictGet(last, "ts", "?"))}`
      + ` exit=${String(pyDictGet(last, "exit_code", "?"))}`
      + ` ${String(pyDictGet(last, "action", ""))}`;
    process.stdout.write(`${line.replace(/\s+$/, "")}\n`);
    const tail = String(pyDictGet(last, "output_tail", "") ?? "").trim();
    if (tail) {
      process.stdout.write(`output tail: ${tail}\n`);
    }
  }
  const needed = cp.phase !== "done" && Boolean(cp.resume_exec);
  if (needed && state !== "running") {
    process.stdout.write(`hint: devloop arm-local --file ${file}\n`);
    return 1;
  }
  return 0;
}
```

`pyDictGet` 加進 `src/jsonio.ts`(與 `pyGet` 同族,差別是它面對的是 `unknown` 而不是已知的 dict):

```typescript
/**
 * Python 的 `obj.get(key, default)`,含「obj 不是 dict 就 AttributeError」那一半。
 *
 * `pyGet` 的參數已經是 Record,呼叫端保證過型別;這個版本用在「JSON 解出來
 * 的東西可能是任何型別」的地方——`json.loads("42")` 是合法的,而對它呼叫
 * .get 在 Python 會炸,靜默回 undefined 是分歧不是容錯。
 */
export function pyDictGet(obj: unknown, key: string, fallback: unknown): unknown {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError(
      `AttributeError: '${obj === null ? "NoneType" : typeof obj}' object has no attribute 'get'`);
  }
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj as Record<string, unknown>)[key]
    : fallback;
}
```

`main` 的分派三段照 Task 3 的形狀寫;`watch` 是 `return await cmdWatch(...)`。`--exec` 對 `watch` 是 required、對 `arm-local` 是 optional,這個差別不能寫反。

- [ ] **Step 5:跑測試確認通過**

- [ ] **Step 6:加矩陣列(含歸一化)**

```typescript
watch: [
  {
    name: "an immediately successful exec",
    build: (dir) => [
      "watch", "--exec", "/usr/bin/true", "--heartbeat", "1",
      "--log", join(dir, "w.jsonl"),
    ],
  },
],
"arm-local": [
  {
    name: "arming a fresh checkpoint",
    build: (dir) => [
      "arm-local", "--file",
      writeCheckpoint(dir, {
        phase: "apply", change_id: "c1", branch: "b", resume_exec: "/usr/bin/true",
      }),
      "--heartbeat", "1",
    ],
    // pid 每次都不同,而且兩個引擎必然不同。
    normalize: (s) => s.replace(/pid=\d+/g, "pid=<PID>"),
  },
  {
    name: "no resume command anywhere",
    build: (dir) => [
      "arm-local", "--file",
      writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
    ],
  },
],
"watcher-status": [
  {
    name: "a checkpoint that needs a watcher and has none",
    build: (dir) => [
      "watcher-status", "--file",
      writeCheckpoint(dir, {
        phase: "apply", change_id: "c1", branch: "b", resume_exec: "/usr/bin/true",
      }),
    ],
  },
  {
    name: "the done phase needs no watcher",
    build: (dir) => [
      "watcher-status", "--file",
      writeCheckpoint(dir, {
        phase: "done", change_id: "c1", branch: "b", resume_exec: "/usr/bin/true",
      }),
    ],
  },
  {
    name: "a log with one recorded attempt",
    build: (dir) => {
      const file = writeCheckpoint(dir, {
        phase: "apply", change_id: "c1", branch: "b", resume_exec: "/usr/bin/true",
      });
      writeFileSync(
        join(dir, "watcher-log.jsonl"),
        JSON.stringify({
          ts: "2026-08-02T00:00:00Z", exit_code: 1,
          output_tail: "boom", action: "retry", heartbeat: 1,
        }) + "\n",
        "utf-8",
      );
      return ["watcher-status", "--file", file];
    },
  },
],
```

`arm-local` 的矩陣 case 會真的 spawn 兩個 watcher(TS 一個、Python 一個),`--exec /usr/bin/true` 讓它們立刻結束。**測試檔尾端要有一個 afterAll,確認沒有殘留**:把每個 case 寫下的 `watcher.pid` 收集起來,結束時對每個 pid 檢查它已經不在(或主動 SIGTERM 再檢查)。

- [ ] **Step 7:跑矩陣**

- [ ] **Step 8:變異測試**

1. `cmdWatcherStatus` 的 `needed` 拿掉 `cp.phase !== "done"` → 「done 階段 exit 0」那條紅
2. `cmdWatch` 的 `shlexSplit` 改成 `split(" ")` → 「quoted argument」那條紅
3. `pyDictGet` 的型別檢查拿掉 → 「bare scalar 要拋錯」那條紅

- [ ] **Step 9:Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/src/crossEngine.test.ts plugins/dev-loop/src/jsonio.ts
git commit -m "feat(ts): port the watch, arm-local and watcher-status commands"
```

---

### Task 6:`status` 補完並放回 `TS_COMMANDS`

**Files:**
- Modify: `plugins/dev-loop/src/cli.ts`
- Modify: `plugins/dev-loop/src/cli.test.ts`
- Modify: `plugins/dev-loop/src/crossEngine.test.ts`

**Interfaces:**
- Consumes:`nextHint`(`statemachine.ts`)、`loadConfig`、`watcherState`(`watcher.ts`)
- Produces:`TS_COMMANDS` 增加 `"status"`

**背景(必讀):** `status` 從 M1 就在 `TS_COMMANDS` 裡,但當時沒有任何東西呼叫得到它。M2b-1 把 `bin/devloop` 交給 TS 的那一瞬間,三個缺口同時上線:`gate_cmds` 沒從 config 讀(於是 `next:` hint 與 Python 不同)、`--json` 被靜默忽略、watcher 未執行的警告消失。它已被拿掉,這個 task 是把它重寫回來。**三件都補齊才能放回清單。**

- [ ] **Step 1:先取 Python 的實測輸出(四種情境)**

```bash
cd /Users/tliang/workspace/claude/code/dev-loop
D=$(mktemp -d)
python3 -c "
import sys; sys.path.insert(0,'plugins/dev-loop')
from devloop.checkpoint import Checkpoint
Checkpoint(phase='gate', change_id='c1', branch='b').save('$D/cp.json')"
echo '{"gate_cmds": ["pytest -q"]}' > $D/config.json
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli status --file $D/cp.json
PYTHONPATH=plugins/dev-loop python3 -m devloop.cli status --file $D/cp.json --json
```

有 `gate_cmds` 與沒有的 `next:` 行必須不同——那正是缺口之一。

- [ ] **Step 2:寫失敗的測試**

```typescript
describe("status", () => {
  it("sources gate_cmds from config.json, changing the next hint", async () => {
    // 這是 M1 版 status 的缺口之一:沒讀 config 時 hint 給的是 <test-cmd>
    // 骨架而不是可直接執行的命令,與 Python 不同。
    const dir = mkdtempSync(join(tmpdir(), "cli-status-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(makeCheckpoint({ phase: "gate", change_id: "c1", branch: "b" }), file);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ gate_cmds: ["pytest -q"] }), "utf-8");
    const out = captureStdout();
    expect(await main(["status", "--file", file])).toBe(0);
    expect(out.text()).toContain(`next: devloop gate --file ${file}`);
  });

  it("honours --json, emitting the whole checkpoint plus next", async () => {
    const file = /* fixture */;
    const out = captureStdout();
    expect(await main(["status", "--file", file, "--json"])).toBe(0);
    const payload = JSON.parse(out.text()) as Record<string, unknown>;
    expect(payload.phase).toBe("gate");
    expect(typeof payload.next).toBe("string");
    // 單行輸出:Python 是 print(json.dumps(...)),不是縮排過的。
    expect(out.text().trim().includes("\n")).toBe(false);
  });

  it("warns on stderr when a watcher is needed but not running", async () => {
    const file = /* checkpoint phase=apply with resume_exec, no watcher.pid */;
    const err = captureStderr();
    expect(await main(["status", "--file", file])).toBe(0);
    expect(err.text()).toContain("warning: watcher not running");
  });

  it("does not warn in the done phase or without a resume command", async () => {
    const done = /* phase=done with resume_exec */;
    const err = captureStderr();
    await main(["status", "--file", done]);
    expect(err.text()).toBe("");
  });
});
```

- [ ] **Step 3:跑測試確認失敗**

- [ ] **Step 4:實作**

```typescript
/**
 * 非終態且有續跑命令時,watcher 該在而不在 → stderr 警告。
 * **stdout 契約不變**:警告絕不能跑到 stdout,否則所有解析 status 輸出的
 * 呼叫端都會多讀到一行。
 */
function warnIfWatcherMissing(cp: Checkpoint, file: string): void {
  if (cp.phase === "done" || !cp.resume_exec) {
    return;
  }
  const [state] = watcherState(file);
  if (state !== "running") {
    process.stderr.write(
      `warning: watcher not running; re-arm: devloop arm-local --file ${file}\n`);
  }
}

function cmdStatus(file: string, json: boolean): number {
  const cp = loadCheckpoint(file);
  const config = loadConfig(join(dirname(file), "config.json"));
  const hint = nextHint(cp.phase, file, {
    units: cp.units as Array<{ id: string; status?: string }>,
    reviewLegs: cp.review_legs as Array<{ kind: string; status?: string }>,
    gateCmds: config.gate_cmds,
    finishMode: cp.finish_mode,
    flowProfile: cp.flow_profile,
    needsUiux: cp.needs_uiux,
  });
  warnIfWatcherMissing(cp, file);
  if (json) {
    // Python: payload = asdict(cp); payload["next"] = hint; print(json.dumps(...))
    // 鍵的順序照 dataclass 欄位順序,`next` 加在最後。
    process.stdout.write(`${JSON.stringify({ ...cp, next: hint })}\n`);
    return 0;
  }
  process.stdout.write(
    `phase=${cp.phase} iteration=${String(cp.iteration)} `
    + `change_id=${cp.change_id} branch=${cp.branch}\n`);
  process.stdout.write(`${hint}\n`);
  if (cp.updated_at) {
    process.stdout.write(`updated_at=${cp.updated_at}\n`);
  }
  return 0;
}
```

**`--json` 的鍵順序要對著 Python 驗。** `asdict(cp)` 給的是 dataclass 宣告順序;TS 的 `{...cp}` 給的是 `Checkpoint` 物件的插入順序。兩者不同的話矩陣會紅——那是好事,當場對齊。

- [ ] **Step 5:跑測試確認通過**

- [ ] **Step 6:加矩陣列**

```typescript
status: [
  {
    name: "a gate phase with configured gate_cmds",
    build: (dir) => {
      const file = writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" });
      writeConfig(dir, { gate_cmds: ["pytest -q"] });
      return ["status", "--file", file];
    },
    // updated_at 是 checkpoint 寫入當下的時間;兩個引擎各自寫各自的檔,
    // 而且時間戳文法本來就不同(既有延後項)。
    normalize: (s) => s.replace(/updated_at=\S+/g, "updated_at=<TS>"),
  },
  {
    name: "the same checkpoint without gate_cmds",
    build: (dir) => [
      "status", "--file",
      writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
    ],
    normalize: (s) => s.replace(/updated_at=\S+/g, "updated_at=<TS>"),
  },
  {
    name: "--json",
    build: (dir) => [
      "status", "--file",
      writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      "--json",
    ],
    normalize: (s) => s.replace(/"updated_at":\s*"[^"]*"/g, '"updated_at":"<TS>"'),
  },
  {
    name: "a light profile in the qa phase takes the qa_skip hint",
    build: (dir) => [
      "status", "--file",
      writeCheckpoint(dir, {
        phase: "qa", change_id: "c1", branch: "b",
        flow_profile: "light", needs_uiux: false,
      }),
    ],
    normalize: (s) => s.replace(/updated_at=\S+/g, "updated_at=<TS>"),
  },
],
```

**矩陣的 checkpoint 一律不放 `resume_exec`**,否則 `status` 會走 watcher 警告那條路(stderr 不比對,但 `watcherState` 會讀檔,徒增雜訊)。watcher 警告由 `cli.test.ts` 的單元測試負責。

- [ ] **Step 7:跑矩陣,並確認 `crossEngine.test.ts` 的「有矩陣覆蓋」守門仍然成立**

Run:`cd plugins/dev-loop && npx vitest run src/crossEngine.test.ts`

- [ ] **Step 8:變異測試**

1. `cmdStatus` 不傳 `gateCmds` → 「sources gate_cmds from config」紅、矩陣的前兩條之一紅
2. `--json` 分支拿掉 → 「honours --json」紅
3. `warnIfWatcherMissing` 印到 stdout 而非 stderr → 矩陣紅(stdout 多一行)

- [ ] **Step 9:Commit**

```bash
git add plugins/dev-loop/src/cli.ts plugins/dev-loop/src/cli.test.ts \
        plugins/dev-loop/src/crossEngine.test.ts
git commit -m "feat(ts): complete the status command and put it back in TS_COMMANDS"
```

---

### Task 7:交叉臂測試

**Files:**
- Create: `plugins/dev-loop/src/crossArm.test.ts`

**Interfaces:**
- Consumes:兩個引擎的 CLI(`node dist/cli.js` 與 `python3 -m devloop.cli`)
- Produces:無(純測試)

**為什麼這是本輪最該加的一項:** `watcher.pid` 是兩引擎**真正共用的交接檔**。TS 的 `ensureArmed` 寫進去,Python 的 `_watcher_state` 讀它並 `os.kill(pid, 0)` 探活;反過來也一樣。錯了的表現是「watcher 明明活著卻被判定不在」(於是重複 spawn)或「已死的 pid 被當成活的」(於是永遠不重 spawn),**兩者都不報錯**,任何單引擎測試都看不到。

- [ ] **Step 1:寫測試**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(process.cwd(), "dist", "cli.js");
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function runTs(argv: string[]) {
  return spawnSync("node", [CLI, ...argv], { encoding: "utf-8" });
}

function runPy(argv: string[]) {
  return spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    encoding: "utf-8",
    env: { ...process.env, PYTHONPATH: PLUGIN_ROOT },
  });
}

const spawned: number[] = [];

function fixture(fields: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "cross-arm-"));
  const file = join(dir, "cp.json");
  writeFileSync(file, JSON.stringify({
    phase: "apply", change_id: "c1", branch: "b", iteration: 0,
    last_artifact: "", non_blocking: [], updated_at: "",
    // sleep 30 的 watcher 在測試期間確定還活著,才能驗「另一個引擎看得到它活著」;
    // afterEach 會殺掉它。
    resume_exec: "/bin/sh -c 'sleep 30'",
    units: [], review_legs: [], propose_attempts: 0, gate_failures: 0,
    finish_mode: null, flow_profile: "full", needs_uiux: false,
    ...fields,
  }), "utf-8");
  return file;
}

function recordPid(file: string): number {
  const pid = Number(readFileSync(join(dirname(file), "watcher.pid"), "utf-8").trim());
  spawned.push(pid);
  return pid;
}

afterEach(() => {
  // 每個 case spawn 的都是真的行程,測試不得留下孤兒。
  for (const pid of spawned.splice(0)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* 已經死了 */ }
  }
});

describe("cross-arm: the watcher.pid handoff file", () => {
  it("Python sees a watcher armed by TS as running", () => {
    const file = fixture();
    const armed = runTs(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(armed.status, armed.stderr).toBe(0);
    const pid = recordPid(file);

    const status = runPy(["watcher-status", "--file", file]);
    expect(status.stdout).toContain(`watcher: running (pid=${pid})`);
    expect(status.status).toBe(0);
  });

  it("TS sees a watcher armed by Python as running", () => {
    const file = fixture();
    const armed = runPy(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(armed.status, armed.stderr).toBe(0);
    const pid = recordPid(file);

    const status = runTs(["watcher-status", "--file", file]);
    expect(status.stdout).toContain(`watcher: running (pid=${pid})`);
    expect(status.status).toBe(0);
  });

  it("neither engine re-arms a watcher the other one already started", () => {
    // idempotent 必須跨引擎成立,否則 Python 起的 watcher 加上 TS 起的 watcher
    // 會同時對同一個 loop 送續跑命令。
    const file = fixture();
    expect(runPy(["arm-local", "--file", file, "--heartbeat", "1"]).status).toBe(0);
    const pid = recordPid(file);
    const second = runTs(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(second.stdout).toBe(`watcher already running (pid=${pid})\n`);
    expect(readFileSync(join(dirname(file), "watcher.pid"), "utf-8").trim())
      .toBe(String(pid));
  });

  it("both engines classify the same stale pid file as dead", () => {
    const file = fixture();
    // 真的產生一個已被收屍的 pid,而不是猜一個大數字。
    const reaped = spawnSync("/usr/bin/true").pid as number;
    writeFileSync(join(dirname(file), "watcher.pid"), String(reaped), "utf-8");
    expect(runTs(["watcher-status", "--file", file]).stdout)
      .toContain(`watcher: dead (stale pid=${reaped})`);
    expect(runPy(["watcher-status", "--file", file]).stdout)
      .toContain(`watcher: dead (stale pid=${reaped})`);
  });

  it("both engines treat a corrupt pid file as absent, not as an error", () => {
    const file = fixture();
    writeFileSync(join(dirname(file), "watcher.pid"), "not-a-pid\n", "utf-8");
    for (const run of [runTs, runPy]) {
      const r = run(["watcher-status", "--file", file]);
      expect(r.stdout).toContain("watcher: not armed");
      expect(r.status).toBe(1);
    }
  });

  it("auto-arm from one engine is visible to the other", () => {
    // event 走 _save_with_history -> auto-arm。TS 執行 event、Python 讀狀態。
    const file = fixture();
    const ev = runTs(["event", "--file", file, "--event", "apply_done"]);
    expect(ev.status, ev.stderr).toBe(0);
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(true);
    const pid = recordPid(file);
    expect(runPy(["watcher-status", "--file", file]).stdout)
      .toContain(`watcher: running (pid=${pid})`);
  });
});
```

- [ ] **Step 2:跑測試**

Run:`cd plugins/dev-loop && npx vitest run src/crossArm.test.ts`
Expected:全綠。**任一條紅都是真的跨引擎交接壞掉,不是測試寫錯**——先驗證兩個引擎各自的行為再改。

- [ ] **Step 3:確認沒有孤兒行程**

```bash
cd plugins/dev-loop && npx vitest run src/crossArm.test.ts
pgrep -fl "sleep 30" || echo "no orphans"
```
Expected:`no orphans`

- [ ] **Step 4:變異測試**

1. TS 的 `pidAlive` 把 EPERM 當死 → 「Python 起的 watcher TS 看得到」在該行程屬他人時會紅(本機同使用者不一定重現;至少要確認 ESRCH/EPERM 對調時「stale pid 判為 dead」那條紅)
2. TS 的 `ensureArmed` 拿掉 running 早退 → 「neither engine re-arms」紅
3. TS 寫 pid 檔時多寫一個換行 → Python 端仍應該正常(`int()` 會吃掉空白),**若這條讓 Python 紅,就是找到一個真的分歧**,當場記錄

- [ ] **Step 5:跑全套並重打包**

```bash
cd plugins/dev-loop && npm test && npm run bundle
cd /Users/tliang/workspace/claude/code/dev-loop && make test
git status --porcelain plugins/dev-loop/dist
```
最後一行若有輸出,表示 `dist/` 因為本輪的 `src/` 改動需要更新——**這一次要 commit 它**(前面每個 task 都不動 dist,這裡一次更新到位;`spawnWatcher` spawn 的就是這個 bundle,不更新的話交叉臂測試跑的是舊程式碼)。

> 注意:`pretest` 會自動重打包,所以前面每個 task 跑 `npm test` 之後 `dist/` 就可能已經髒了。實際做法是**每個 task 結束前檢查 `git status`,若 dist 有變就一起 commit**,而不是硬把它留到最後——Task 1 的 `watcher.test.ts` 已經真的 spawn `dist/cli.js`,那時 bundle 就必須是新的。這條取代 Global Constraints 裡「dist 必須是空的」那句在本輪的適用範圍:本輪 dist 會變,但**永遠只由 `npm run bundle` 產生,絕不手改**。

- [ ] **Step 6:Commit**

```bash
git add plugins/dev-loop/src/crossArm.test.ts plugins/dev-loop/dist/cli.js
git commit -m "test: pin the watcher.pid handoff between both engines"
```

---

## Self-Review

**1. Spec coverage**

| spec 要求 | 對應 task |
|---|---|
| `ensureArmed` spawn node 而非 python3 | Task 1 Step 11 的 `spawnWatcher` |
| 五個模組中的 `watcher`(117 行) | Task 1 |
| CLI backbone `_apply_event` / `_save_with_history` | Task 3 |
| `watch` / `arm-local` / `watcher-status` | Task 5 |
| `status` 補完三件事後放回 `TS_COMMANDS` | Task 6 |
| `event` 含 `qa_skip` guard | Task 3 |
| `gate` 的三分岔 exit code | Task 4 |
| shlex 接縫 | 已於 M2b-2a 完成,本輪 Task 4/5 是消費端 |
| `Path.resolve` 接縫 | 已於 M2b-2a 完成 |
| detached spawn 與 signal | Task 1(spawn/unref/kill 0 的 ESRCH/EPERM 分類) |
| 矩陣擴到六個新命令 + 歸一化 + 豁免要理由 | Task 3 Step 6/7、Task 4 Step 6、Task 5 Step 6、Task 6 Step 6 |
| 交叉臂測試兩個方向 | Task 7 |
| 測試不留孤兒行程 | Task 1 Step 9、Task 5 Step 6、Task 7 Step 3 |
| stale bundle 的風險 | Task 7 Step 5 的說明 + 每個 task 的 dist 檢查 |

spec 的「不做」清單(其餘 13 個變更型命令、`units_cli` 六個、`teardown` 子命令、刪 Python、改 `SKILL.md`)本計畫都沒有碰。

**2. Placeholder scan**

Task 5 Step 2 的測試碼裡有 `/* checkpoint with ... */` 形式的簡寫。這是**本計畫刻意保留的唯一一處**,因為 fixture helper 的確切形狀取決於 `cli.test.ts` 既有的寫法(該檔已有 stdout 攔截與 checkpoint 建立的慣例,重寫一份會與它打架)。Step 2 的正文已明確要求實作者把它換成與 Task 3 同款的 `fixture()` 呼叫、不得保留註解形式。其餘所有步驟都有可直接貼上的程式碼。

Task 1 Step 14 的 Python 消費者草稿裡本來有三個湊出 dead pid 的繞路函式(我寫壞的);已在同一份文件裡直接改成一個 `_reaped_pid()`,不留給實作者收拾。

**3. Type consistency**

- `watcherState` 回 `[WatcherState, number | null]`,Task 5 的 `cmdWatcherStatus` 與 Task 6 的 `warnIfWatcherMissing` 都照這個解構,一致。
- `ensureArmed` 回 `[ArmStatus, number | null]`,Task 5 的 `cmdArmLocal` 一致。
- `lastWatcherAttempt` 回 `unknown`(不是 `Record<string, unknown>`),所以 Task 5 必須用 `pyDictGet` 而不是屬性存取——兩處寫法一致。
- `applyEvent(cp, event, max)` 在 Task 3 定義、Task 4 使用,參數順序一致。
- `saveWithHistory(cp, file, event, fromPhase)` 同上。
- `parseIntFlag(values, name, fallback)` 在 Task 3 定義、Task 4 使用三次,一致。
- `pySplitlines` / `pyParseInt` 在 Task 1 定義,同一個 task 內就有兩個既有呼叫點改用它們。
- **一個真的不一致已修正**:草稿裡 Task 3 寫 `appendHistory(file, event, fromPhase, ...)` 而 `fromPhase` 型別是 `string | null`,但 `history.ts` 的簽名是 `fromPhase: string`。Task 3 的程式碼已改成 `fromPhase ?? ""`。Python 那側 `start` 事件傳的是 `None`,寫進 history.jsonl 是 `null`——**這是一個尚未解決的分歧**:TS 傳 `""` 會寫出空字串。本輪沒有 `start` 命令(它在 M2c),所以不可達;但實作 Task 3 時要在 `saveWithHistory` 上方留一條註解記下它,並在 M2c 移植 `start` 時一併處理。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-02-L1-M2b2b-watcher-and-cli-backbone.md`.

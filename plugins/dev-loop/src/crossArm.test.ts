import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 交叉臂測試:`watcher.pid` 是兩引擎真正共用的交接檔。TS 的 `ensureArmed`
 * 寫進去,Python 的 `_watcher_state` 讀它並 `os.kill(pid, 0)` 探活;反過來
 * 也一樣。錯了的表現是「watcher 明明活著卻被判定不在」(於是重複 spawn)
 * 或「已死的 pid 被當成活的」(於是永遠不重 spawn)——兩者都不報錯,任何
 * 單引擎測試都看不到。
 *
 * runTs/runPy、killProcessGroup、pidAlive 與 afterAll 的 leak guard 都與
 * src/crossEngine.test.ts 同款(同一份手寫邏輯,不是 import,因為 vitest
 * 對每個 *.test.ts 各自建一份模組圖——import 另一個 test 檔會把它的
 * describe/it 也在這裡重跑一遍)。
 */

const CLI = join(process.cwd(), "dist", "cli.js");
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// vitest 的 test timeout 不會殺掉 spawnSync 的子行程;沒有這個上限,一個
// 掛住的引擎會讓整支 suite 卡住並留下背景行程(前一個 task 曾卡 10 分鐘)。
const ENGINE_TIMEOUT_MS = 20_000;

interface EngineResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runTs(argv: string[]): EngineResult {
  const proc = spawnSync("node", [CLI, ...argv], {
    encoding: "utf-8", timeout: ENGINE_TIMEOUT_MS, killSignal: "SIGKILL",
  });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", status: proc.status };
}

function runPy(argv: string[]): EngineResult {
  const proc = spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    encoding: "utf-8",
    timeout: ENGINE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env: { ...process.env, PYTHONPATH: PLUGIN_ROOT },
  });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", status: proc.status };
}

function fixture(fields: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "cross-arm-"));
  const file = join(dir, "cp.json");
  writeFileSync(file, JSON.stringify({
    phase: "apply", change_id: "c1", branch: "b", iteration: 0,
    last_artifact: "", non_blocking: [], updated_at: "",
    // sleep 30 的 watcher 在測試期間確定還活著,才能驗「另一個引擎看得到它活著」;
    // afterAll 的 leak guard 會殺掉它整個 process group。
    resume_exec: "/bin/sh -c 'sleep 30'",
    units: [], review_legs: [], propose_attempts: 0, gate_failures: 0,
    finish_mode: null, flow_profile: "full", needs_uiux: false,
    ...fields,
  }), "utf-8");
  return file;
}

/**
 * spawn 過 watcher 的 pid 檔路徑,**在呼叫可能 spawn watcher 的指令之前**登記
 * ——一個掛住或拋錯的 case 走不到「呼叫之後」那行,leak guard 才不會因此
 * 對它視而不見(trap class 4)。
 */
const spawnedPidFiles: string[] = [];

function registerPidFile(file: string): string {
  const pidPath = join(dirname(file), "watcher.pid");
  spawnedPidFiles.push(pidPath);
  return pidPath;
}

function readPid(pidPath: string): number {
  return Number(readFileSync(pidPath, "utf-8").trim());
}

/**
 * 收掉一個 watcher 連同它的子孫(續跑命令)。兩個引擎 spawn 出來的 watcher
 * 都是 group leader(TS `detached: true`、Python `start_new_session=True`),
 * 所以對 `-pid` 送信號打得到整個 group;保險起見再對 pid 本身送一次。
 */
function killProcessGroup(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // 已經走了
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

afterAll(async () => {
  const leaked: string[] = [];
  for (const pidPath of spawnedPidFiles) {
    if (!existsSync(pidPath)) {
      continue;
    }
    const pid = readPid(pidPath);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    for (let i = 0; i < 40 && pidAlive(pid); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (pidAlive(pid)) {
      killProcessGroup(pid);
      leaked.push(`${pidPath} (pid=${String(pid)})`);
    } else {
      // 就算沒被判定活著,也保險殺一次整個 group,避免 zombie/孫行程漏網。
      killProcessGroup(pid);
    }
  }
  expect(leaked, "交叉臂測試留下了還活著的 watcher 行程").toEqual([]);
});

describe("cross-arm: the watcher.pid handoff file", () => {
  it("Python sees a watcher armed by TS as running", () => {
    const file = fixture();
    const pidPath = registerPidFile(file);
    const armed = runTs(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(armed.status, armed.stderr).toBe(0);
    const pid = readPid(pidPath);
    try {
      const status = runPy(["watcher-status", "--file", file]);
      expect(status.stdout).toContain(`watcher: running (pid=${String(pid)})`);
      expect(status.status).toBe(0);
    } finally {
      // sleep 30 還活著才驗得出「另一引擎看得到它活著」,測完立刻收屍,
      // 不留給 afterAll 的 leak guard 去等——那個 guard 只等 2 秒,
      // 30 秒的行程等不完,會被誤報成 leak。
      killProcessGroup(pid);
    }
  });

  it("TS sees a watcher armed by Python as running", () => {
    const file = fixture();
    const pidPath = registerPidFile(file);
    const armed = runPy(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(armed.status, armed.stderr).toBe(0);
    const pid = readPid(pidPath);
    try {
      const status = runTs(["watcher-status", "--file", file]);
      expect(status.stdout).toContain(`watcher: running (pid=${String(pid)})`);
      expect(status.status).toBe(0);
    } finally {
      killProcessGroup(pid);
    }
  });

  it("neither engine re-arms a watcher the other one already started", () => {
    // idempotent 必須跨引擎成立,否則 Python 起的 watcher 加上 TS 起的 watcher
    // 會同時對同一個 loop 送續跑命令。
    const file = fixture();
    const pidPath = registerPidFile(file);
    const first = runPy(["arm-local", "--file", file, "--heartbeat", "1"]);
    expect(first.status, first.stderr).toBe(0);
    const pid = readPid(pidPath);
    try {
      const second = runTs(["arm-local", "--file", file, "--heartbeat", "1"]);
      expect(second.stdout).toBe(`watcher already running (pid=${String(pid)})\n`);
      expect(readPid(pidPath)).toBe(pid);
    } finally {
      killProcessGroup(pid);
    }
  });

  it("both engines classify the same stale pid file as dead", () => {
    const file = fixture();
    // 真的產生一個已被收屍的 pid,而不是猜一個大數字。
    const reaped = spawnSync("/usr/bin/true").pid as number;
    writeFileSync(join(dirname(file), "watcher.pid"), String(reaped), "utf-8");
    expect(runTs(["watcher-status", "--file", file]).stdout)
      .toContain(`watcher: dead (stale pid=${String(reaped)})`);
    expect(runPy(["watcher-status", "--file", file]).stdout)
      .toContain(`watcher: dead (stale pid=${String(reaped)})`);
  });

  it("both engines classify a pid owned by another user (EPERM) as running", () => {
    // pid 1 是 launchd,root 持有、永遠在跑,非 root 呼叫者對它 kill(pid, 0)
    // 必得 EPERM——不需要真的起第二個使用者的行程就能考到 EPERM 分支。
    // 實測(本機、非 root):
    //   node -e 'process.kill(1,0)'  -> EPERM
    //   python3 -c 'os.kill(1,0)'    -> PermissionError(EPERM)
    // EPERM 分類錯的後果比 ESRCH 分類錯更糟:把「活著但屬他人」判成死,會讓
    // 兩個引擎對同一個其實還活著的 watcher 各自重新 spawn 一個。
    const file = fixture();
    writeFileSync(join(dirname(file), "watcher.pid"), "1", "utf-8");
    expect(runTs(["watcher-status", "--file", file]).stdout)
      .toContain("watcher: running (pid=1)");
    expect(runPy(["watcher-status", "--file", file]).stdout)
      .toContain("watcher: running (pid=1)");
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
    const pidPath = registerPidFile(file);
    const ev = runTs(["event", "--file", file, "--event", "apply_done"]);
    expect(ev.status, ev.stderr).toBe(0);
    expect(existsSync(pidPath)).toBe(true);
    const pid = readPid(pidPath);
    try {
      expect(runPy(["watcher-status", "--file", file]).stdout)
        .toContain(`watcher: running (pid=${String(pid)})`);
    } finally {
      killProcessGroup(pid);
    }
  });
});

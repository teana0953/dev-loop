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
import { pyTruthy } from "./jsonio.js";
import { pyParseInt, pySplitlines, pyStrip } from "./pystr.js";
import { shlexJoin, shlexSplit } from "./shlex.js";

export type WatcherState = "running" | "dead" | "absent";
export type ArmStatus = "armed" | "already" | "skipped";

/**
 * `os.kill(pid, 0)` 探活。ESRCH(無此行程)= 死、EPERM(存在但屬他人)= 活,
 * 這個分類必須照抄——判錯的表現是「watcher 明明活著卻被判定不在」(於是重複
 * spawn)或「已死的 pid 被當成活的」(於是永遠不重 spawn),兩者都不報錯。
 *
 * 其餘 errno 往外拋:Python 的 except 只涵蓋 OSError,pid 大到無法轉成 C int
 * 時是 OverflowError,會穿出去(實測 os.kill(2**63, 0) 即是)。POSIX 的
 * kill(2) 只可能失敗於 EINVAL/EPERM/ESRCH,而 signal 固定是 0,所以 EINVAL
 * 不可達——拋出去的只會是「pid 本身不是合法的行程識別碼」這一類,與 Python
 * 同步(Node 實測給的是 TypeError ERR_INVALID_ARG_TYPE)。
 * teardown.ts 的 disarmWatcher 出於同一個理由用同一個形狀。
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
  // Python 是 `int(pid_path.read_text().strip())` —— strip() 在前、int() 在後,
  // 兩個各自剝掉的空白集合不一樣(str.strip() 剝 \x1c-\x1f,int() 不剝),所以
  // 必須照著組合,不能只叫 pyParseInt。實測 watcher.pid 內容 "\x1c<活著的 pid>":
  //   PY  _watcher_state -> ('running', <pid>)
  //   TS(修前)          -> ["absent", null]
  const pid = pyParseInt(pyStrip(readFileSync(pidPath, "utf-8")));
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
 * 對應的 env 處理(dist/cli.js 自己在委派回 Python 時會設)。
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
  // 空字串的 override 要讓位給 checkpoint 裡的值。而「falsy」是 Python 的
  // falsy,不是 JS 的:loadCheckpoint 完全不做型別收斂,resume_exec 帶的是
  // 磁碟上 JSON 的原樣,`[]` / `{}` 在 Python 是 falsy、在 JS 是 truthy。
  // 實測 checkpoint {"resume_exec": []}:
  //   PY  ensure_armed -> ('skipped', None)
  //   TS(修前)        -> ["armed", <pid>],而且真的留下一個 detached 行程
  // 這與 config.ts 對 auto_arm 用 pyTruthy 擋下的是同一個坑。
  const override: unknown = opts.execOverride;
  const execStr: unknown = pyTruthy(override) ? override : (cp.resume_exec as unknown);
  if (!pyTruthy(execStr)) {
    return ["skipped", null];
  }
  const [state, pid] = watcherState(checkpointPath);
  if (state === "running") {
    return ["already", pid];
  }
  // Python 的 shlex.split() 對任何非字串都拒絕——實測每一種 JSON 型別:
  //   "cmd" / "" / " "  -> 正常切開
  //   [] [0] ["a"]      -> AttributeError: 'list' object has no attribute 'read'
  //   {} {"a":1}        -> AttributeError: 'dict' object has no attribute 'read'
  //   0 1               -> AttributeError: 'int' object has no attribute 'read'
  //   1.5               -> AttributeError: 'float' object has no attribute 'read'
  //   true false        -> AttributeError: 'bool' object has no attribute 'read'
  //   null              -> ValueError: s argument must not be None
  // 其中 falsy 的那些(""、[]、{}、0、false、null)根本走不到這裡,已在上面
  // 的 pyTruthy 閘門回 skipped;真正會炸的是 truthy 的非字串([0]、{"a":1}、
  // 1、1.5、true)。實測 ensure_armed 對 resume_exec=[0] 拋 AttributeError 且
  // **不寫 pid 檔**。
  //
  // 這個檢查的位置很重要:Python 是在 shlex.split 那一刻才炸,也就是在
  // watcherState 的 "already" 早退**之後**。實測 watcher 還活著時,
  // resume_exec=[0] 回的是 ('already', pid),不拋錯。所以守衛只能放在這裡,
  // 不能提前到函式開頭。
  //
  // 錯誤文字不必與 Python 一致(那個分歧已在 fixtures/parity/README.md 認可),
  // 但必須是「真的拋」而不是回一個狀態碼——Python 就是拋。
  if (typeof execStr !== "string") {
    throw new TypeError(
      `resume_exec must be a string, got ${Array.isArray(execStr) ? "array" : typeof execStr}`,
    );
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
    // Python 是 `line.strip()`,不是 trim():兩者的空白集合各差一組。實測
    // 一行 "\x1f{\"n\": 1}" → PY {'n': 1} / TS(修前) null;
    // 一行 "\ufeff{\"n\": 1}" → PY None / TS(修前) {"n": 1}。
    const line = pyStrip(raw);
    if (!line) {
      continue;
    }
    try {
      last = JSON.parse(line);
    } catch {
      // 壞行跳過,保留上一筆好的——Python 的 `except ValueError: continue`。
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
  // 同 ensureArmed:resume_exec 沒有經過任何型別收斂,`[]` / `{}` 在 Python
  // 是 falsy(實測 _ensure_armed_after_save 對 resume_exec=[] 不 arm),
  // 在 JS 是 truthy。
  if (!pyTruthy(cp.resume_exec)) {
    return;
  }
  if (cp.phase === "done") {
    return; // 終態不再需要 watcher(teardown 已 disarm,勿重新拉起)
  }
  // config.auto_arm 在 loadConfig 裡已經過 pyTruthy 收斂成 boolean,
  // 這裡再套一次 pyTruthy 是多餘的。
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

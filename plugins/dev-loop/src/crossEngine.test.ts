import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TS_COMMANDS } from "./cli.js";

/**
 * I7: cross-engine command matrix.
 *
 * Every command TS claims to own (TS_COMMANDS) must produce byte-identical
 * stdout and exit code to `python3 -m devloop.cli` for a small matrix of
 * inputs. C1 (status served incompletely), C2 (units-status KeyError vs.
 * `undefined`), and I3 (unrecognized flags silently accepted) would all have
 * been caught by a test like this one, had it existed before those
 * regressions shipped.
 *
 * The matrix is keyed by command and this file iterates TS_COMMANDS itself
 * (not a hardcoded list of command names), so a command promoted into
 * TS_COMMANDS in a later milestone is covered automatically — the "matrix
 * has coverage" assertion below fails loudly if nobody added rows for it,
 * rather than the new command silently going untested.
 *
 * stderr is intentionally not compared: argparse and this hand-written
 * parser word their errors differently (see fixtures/parity/README.md), and
 * that wording mismatch is an accepted, deliberate divergence, not a bug.
 */

const CLI = join(process.cwd(), "dist", "cli.js");
// src/ -> plugins/dev-loop/ is the plugin root delegateToPython also uses
// for PYTHONPATH.
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface EngineResult {
  stdout: string;
  exit_code: number;
}

/**
 * `watch` 進矩陣之後,被 spawn 的引擎可能是一個**不會自己結束**的重試迴圈
 * (續跑命令永遠失敗時就是這樣,而那正是某些變異體的表現)。沒有上限的
 * spawnSync 在那種情況下不是「這一列紅了」,是整支 suite 掛住並留下背景行程
 * ——vitest 的 test timeout 不會殺掉 spawnSync 的子行程。所以兩個引擎一律
 * 給同一個硬上限;正常的 case 都在數百毫秒內結束,離這個上限很遠。
 */
const ENGINE_TIMEOUT_MS = 20_000;

function runTs(argv: string[]): EngineResult {
  const proc = spawnSync("node", [CLI, ...argv], {
    encoding: "utf-8", timeout: ENGINE_TIMEOUT_MS, killSignal: "SIGKILL",
  });
  return { stdout: proc.stdout ?? "", exit_code: proc.status ?? 1 };
}

function runPy(argv: string[]): EngineResult {
  const proc = spawnSync("python3", ["-m", "devloop.cli", ...argv], {
    encoding: "utf-8",
    timeout: ENGINE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env: { ...process.env, PYTHONPATH: PLUGIN_ROOT },
  });
  return { stdout: proc.stdout ?? "", exit_code: proc.status ?? 1 };
}

const CHECKPOINT_DEFAULTS = {
  iteration: 0, last_artifact: "", non_blocking: [], updated_at: "",
  resume_exec: null, units: [], review_legs: [], propose_attempts: 0,
  gate_failures: 0, finish_mode: null, flow_profile: "full", needs_uiux: false,
};

function writeCheckpoint(dir: string, fields: Record<string, unknown>): string {
  const p = join(dir, "cp.json");
  writeFileSync(p, JSON.stringify({ ...CHECKPOINT_DEFAULTS, ...fields }), "utf-8");
  return p;
}

function writeConfig(dir: string, fields: Record<string, unknown>): string {
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(fields), "utf-8");
  return p;
}

interface MatrixCase {
  name: string;
  build: (dir: string) => string[];
  /** 比對前的歸一化;dir 已被換成 <DIR>,這裡處理 pid、時間戳之類的易變欄位。 */
  normalize?: (stdout: string) => string;
}

const MATRIX: Partial<Record<(typeof TS_COMMANDS)[number], MatrixCase[]>> = {
  "units-status": [
    {
      name: "a checkpoint with units",
      build: (dir) => [
        "units-status",
        "--file",
        writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b",
          units: [{ id: "g1", status: "pending" }, { id: "g2", status: "done" }],
        }),
      ],
    },
    {
      name: "a checkpoint with no units",
      build: (dir) => [
        "units-status",
        "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
      ],
    },
    {
      name: "the --flag=value form",
      build: (dir) => [
        "units-status",
        `--file=${writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b",
          units: [{ id: "g1", status: "pending" }],
        })}`,
      ],
    },
    {
      name: "--file left without a value",
      build: (dir) => {
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" });
        return ["units-status", "--file"];
      },
    },
  ],
  model: [
    {
      name: "a budget profile",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "budget" }),
      ],
    },
    {
      name: "an explicit models override",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "budget", models: { apply: "opus" } }),
      ],
    },
    {
      name: "a missing config file",
      build: (dir) => ["model", "--stage", "apply", "--config", join(dir, "absent.json")],
    },
    {
      name: "an invalid config",
      build: (dir) => [
        "model", "--stage", "apply", "--config",
        writeConfig(dir, { model_profile: "cheap" }),
      ],
    },
    {
      name: "the --flag=value form",
      build: (dir) => [
        "model", "--stage=apply",
        `--config=${writeConfig(dir, { model_profile: "budget" })}`,
      ],
    },
    {
      name: "--stage left without a value",
      build: () => ["model", "--stage"],
    },
  ],
  // 這些 case 一律不放 `resume_exec`,矩陣測試才不會 spawn watcher。
  // auto-arm 的跨引擎行為由後續的交叉臂測試負責。
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
      name: "a human resume that clears the counters",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, {
          phase: "escalated", change_id: "c1", branch: "b",
          iteration: 2, propose_attempts: 3, gate_failures: 4,
        }),
        "--event", "human_resume_fix",
      ],
    },
    {
      name: "a --finish-mode outside the choices",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "qa", change_id: "c1", branch: "b" }),
        "--event", "qa_pass", "--finish-mode", "zzz",
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
      // fix round 1 / F1:argparse 接受 --flag=value,舊的 parseArgs 不接受,
      // 於是 PY 推進 loop、TS 回 2 —— 一模一樣的命令列讓兩引擎狀態分岔。
      name: "the --flag=value form",
      build: (dir) => [
        "event",
        `--file=${writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" })}`,
        "--event=apply_done",
      ],
    },
    {
      // fix round 1 / F2:已知旗標在行尾沒有值。舊的 parseArgs 把它整個吞掉,
      // 命令帶著預設值繼續跑並真的寫了 checkpoint,PY 則什麼都不寫直接回 2。
      name: "a known flag left without a value",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done", "--max",
      ],
    },
    {
      name: "an unambiguous long-option abbreviation",
      build: (dir) => [
        "event", "--fil",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--even", "apply_done",
      ],
    },
    {
      name: "an ambiguous long-option abbreviation",
      build: (dir) => [
        "event", "--fi",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done",
      ],
    },
    {
      name: "a bare -- with nothing after it",
      build: (dir) => [
        "event", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--event", "apply_done", "--",
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
      // Python 印的是 list 的 repr(單引號、逗號後有空白),不是 JSON。
      name: "a failing gate whose command name needs quoting in the report",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/bin/sh -c \"exit 1\"",
      ],
    },
    {
      // repr 的引號切換規則:含 ' 不含 " 改用雙引號外框;兩種都有才轉義 ';
      // 反斜線一律轉義。sh 的多餘參數會落到 $0/$1 但照樣 exit 1。
      name: "a failing gate whose args contain quotes and backslashes",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/bin/sh -c \"exit 1\" \"it's\" 'a'\"'\"'b\"c' 'back\\slash' ",
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
      // 順序相反:若只保留最後一個 --cmd,這條會「通過」而上面那條也會通過,
      // 兩條合起來才釘死 append。
      name: "two --cmd values where only the second fails",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/usr/bin/true", "--cmd", "/usr/bin/false",
      ],
    },
    {
      name: "append across the abbreviation and --cmd=value forms",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--c", "/usr/bin/true", "--cmd=/usr/bin/false",
      ],
    },
    {
      // 邊界格:gate_failures 0 + --max-gate 1 -> +1 後 1 > 1 為假,留在 fix。
      // 原本的 escalation 那條用 (1, 1),`>` 與 `>=` 在那格同真,分不出來。
      name: "the failure that exactly spends the budget stays in fix",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b", gate_failures: 0 }),
        "--cmd", "/usr/bin/false", "--max-gate", "1",
      ],
    },
    {
      name: "the other boundary point: gate_failures 1 with --max-gate 2 stays in fix",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b", gate_failures: 1 }),
        "--cmd", "/usr/bin/false", "--max-gate", "2",
      ],
    },
    {
      // argparse 的 type=int 沒有下界;負數走 negative-number matcher,是值不是旗標。
      name: "a negative --max-gate escalates on the first failure",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b", gate_failures: 0 }),
        "--cmd", "/usr/bin/false", "--max-gate", "-1",
      ],
    },
    {
      // Python 的 except ValueError 不接 OSError:兩邊都是未捕捉的例外、
      // stdout 空、exit 1。矩陣只比 stdout 與 exit code,traceback 文字不比。
      name: "a config.json that is a directory blows up rather than exiting 2",
      build: (dir) => {
        const cp = writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" });
        mkdirSync(join(dir, "config.json"));
        return ["gate", "--file", cp];
      },
    },
    {
      // 另一半:JSONDecodeError 是 ValueError 的子類 -> 兩邊都 exit 2。
      name: "a corrupt config.json is exit 2, not a crash",
      build: (dir) => {
        const cp = writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" });
        writeFileSync(join(dir, "config.json"), "not json", "utf-8");
        return ["gate", "--file", cp];
      },
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
    {
      name: "gate_cmds from config.json, shlex-split",
      build: (dir) => {
        const cp = writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" });
        writeConfig(dir, { gate_cmds: ["/bin/sh -c 'exit 0'"] });
        return ["gate", "--file", cp];
      },
    },
    {
      name: "an empty gate_cmds list must not pass vacuously",
      build: (dir) => {
        const cp = writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" });
        writeConfig(dir, { gate_cmds: [] });
        return ["gate", "--file", cp];
      },
    },
    {
      // --max/--max-gate 同時存在,所以 --ma 是 ambiguous(event 那組沒有
      // --max-gate,量到的是不同答案)。
      name: "--ma is ambiguous because gate has both --max and --max-gate",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/usr/bin/true", "--ma", "1",
      ],
    },
    {
      name: "a non-integer --max-gate",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/usr/bin/false", "--max-gate", "abc",
      ],
    },
    {
      // Python 的 subprocess.run(timeout=0) 立刻 TimeoutExpired;stdout 第二行
      // 是 "timeout after 0s"。gate.ts 有對應的短路,這條把它接到 CLI 上。
      name: "a zero --timeout reports a timeout, not a pass",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "/usr/bin/true", "--timeout", "0",
      ],
    },
    {
      // 執行檔不存在:兩邊都是未捕捉的例外(PY FileNotFoundError、TS ENOENT),
      // stdout 空、exit 1。stderr 不比對,所以 traceback 文字差異無妨。
      name: "a gate command whose executable does not exist",
      build: (dir) => [
        "gate", "--file",
        writeCheckpoint(dir, { phase: "gate", change_id: "c1", branch: "b" }),
        "--cmd", "no-such-executable-xyz",
      ],
    },
  ],
  watch: [
    {
      // /usr/bin/true 立刻回 0,watcher 跑一輪就結束——矩陣不會留下背景行程。
      name: "an immediately successful exec",
      build: (dir) => [
        "watch", "--exec", "/usr/bin/true", "--heartbeat", "1",
        "--log", join(dir, "w.jsonl"),
      ],
    },
    {
      // shlex 切法。執行檔本身也加引號:切錯時 head 是 `'/bin/sh'`,兩個引擎
      // 都立刻 FileNotFoundError/ENOENT(exit 1),而不是進入「永遠失敗、每秒
      // 重試」的無窮迴圈——後者會讓這一列掛住而不是變紅(實測 10 分鐘沒結束)。
      name: "a quoted argument stays one argv element",
      build: (dir) => [
        "watch", "--exec", `'/bin/sh' -c 'printf x > ${join(dir, "marker")}'`,
        "--heartbeat", "1",
      ],
    },
    {
      // PY:shlex.split("") -> [] -> run_watcher 對 cmd[0] IndexError,exit 1。
      name: "an empty --exec dies instead of looping",
      build: () => ["watch", "--exec", "", "--heartbeat", "1"],
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
    {
      // --exec 對 arm-local 是 optional(對 watch 才是 required)。
      name: "--exec overrides an absent resume_exec",
      build: (dir) => [
        "arm-local", "--file",
        writeCheckpoint(dir, { phase: "apply", change_id: "c1", branch: "b" }),
        "--exec", "/usr/bin/true", "--heartbeat", "1",
      ],
      normalize: (s) => s.replace(/pid=\d+/g, "pid=<PID>"),
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
    {
      // 壞掉的 log(最後一行是純量)兩邊都要當場炸,不是印 "?" 繼續。
      // stdout 比對因此也涵蓋「炸之前印了哪幾行」。
      name: "a log line that is a bare scalar",
      build: (dir) => {
        const file = writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b", resume_exec: "/usr/bin/true",
        });
        writeFileSync(join(dir, "watcher-log.jsonl"), "42\n", "utf-8");
        return ["watcher-status", "--file", file];
      },
    },
    {
      // Python 的 bool([]) 是 False:resume_exec 印 "(none)"、exit 0。
      name: "an empty-container resume_exec counts as absent",
      build: (dir) => [
        "watcher-status", "--file",
        writeCheckpoint(dir, {
          phase: "apply", change_id: "c1", branch: "b", resume_exec: [],
        }),
      ],
    },
  ],
  archive: [
    {
      name: "archive fails identically for a nonexistent openspec change",
      // Both engines shell out to the same real `openspec archive` binary
      // with the same argv from the same cwd, so this is deterministic
      // without needing to inject a fake archiveChange.
      build: (dir) => [
        "archive", "--file",
        writeCheckpoint(dir, { phase: "merge", change_id: "cross-engine-no-such-change-xyz", branch: "b" }),
      ],
    },
  ],
};

/**
 * arm-local 的矩陣列會在**兩個引擎**各 spawn 一個真的 detached watcher。
 * `--exec /usr/bin/true` 讓它們跑一輪就結束,但「應該會結束」不是證據——
 * 每個 case 寫下的 watcher.pid 收進這裡,afterAll 逐一確認它真的不在了,
 * 殘留就讓整個 suite 紅,而不是靜靜地把孤兒行程留給下一個人。
 */
const spawnedPidFiles: string[] = [];

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
    const pid = Number(readFileSync(pidPath, "utf-8").trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    // spawn 與收屍之間有幾毫秒的空窗,所以給它一點時間再判定;仍在的話
    // 先送 SIGTERM(不留孤兒),再登記成失敗。
    for (let i = 0; i < 40 && pidAlive(pid); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 已經自己走了
      }
      leaked.push(`${pidPath} (pid=${String(pid)})`);
    }
  }
  expect(leaked, "矩陣留下了還活著的 watcher 行程").toEqual([]);
});

describe("cross-engine command matrix (I7)", () => {
  for (const cmd of TS_COMMANDS) {
    const cases = MATRIX[cmd];

    it(`${cmd}: has cross-engine matrix coverage`, () => {
      expect(
        cases,
        `"${cmd}" is in TS_COMMANDS but crossEngine.test.ts has no matrix rows for it — `
        + "add coverage instead of letting a promoted command go untested",
      ).toBeDefined();
      expect(cases?.length ?? 0).toBeGreaterThan(0);
    });

    for (const c of cases ?? []) {
      it(`${cmd}: ${c.name}`, () => {
        // 每個引擎各自的 dir:變更型命令(event 起)會改 checkpoint,共用 dir
        // 會讓第二個引擎看到第一個引擎改過的狀態,比出來的差異全是假的。
        const dirTs = mkdtempSync(join(tmpdir(), "cross-engine-ts-"));
        const dirPy = mkdtempSync(join(tmpdir(), "cross-engine-py-"));
        const ts = runTs(c.build(dirTs));
        const py = runPy(c.build(dirPy));
        spawnedPidFiles.push(join(dirTs, "watcher.pid"), join(dirPy, "watcher.pid"));
        const norm = (s: string, dir: string): string => {
          const withoutDir = s.split(dir).join("<DIR>");
          return c.normalize ? c.normalize(withoutDir) : withoutDir;
        };
        expect(ts.exit_code, `${cmd}/${c.name}: exit code`).toBe(py.exit_code);
        expect(norm(ts.stdout, dirTs), `${cmd}/${c.name}: stdout`)
          .toBe(norm(py.stdout, dirPy));
      });
    }
  }
});

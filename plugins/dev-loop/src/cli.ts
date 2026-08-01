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

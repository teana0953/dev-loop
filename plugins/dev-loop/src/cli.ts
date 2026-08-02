#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCheckpoint, saveCheckpoint, type Checkpoint } from "./checkpoint.js";
import { appendHistory } from "./history.js";
import {
  transition,
  InvalidTransition,
  QA_SKIP,
  HUMAN_RESUME_PROPOSE,
  HUMAN_RESUME_FIX,
  DEFAULT_MAX_ITERATIONS,
} from "./statemachine.js";
import { ensureArmedAfterSave } from "./watcher.js";
import { pyParseInt } from "./pystr.js";
import { archiveChange } from "./openspec.js";
import type { OpenSpecResult } from "./openspec.js";
import { archiveWorkfiles as archiveWorkfilesReal } from "./housekeeping.js";
import { pendingUnits, type Unit } from "./units.js";
import { loadConfig, resolveModel } from "./config.js";
import { pyIndex, pyTruthy } from "./jsonio.js";

/**
 * 本引擎自己處理的子命令。其餘一律委派回 Python。
 *
 * 這份清單與 main() 的分派必須完全一致——清單多列一個沒實作的命令,呼叫會
 * 落到 unknown 分支;少列一個已實作的,呼叫會靜默走 Python,「已移植」變成
 * 假的而且沒有人會發現。cli.test.ts 有一條測試釘住兩者相符。
 *
 * "status" is deliberately NOT here even though a `cmdStatus` used to exist:
 * it was written before this branch made TS the front door and shipped with
 * three documented omissions (--json, config.json gate_cmds sourcing, the
 * watcher-missing warning) that were harmless while nothing invoked it.
 * Once bin/devloop started execing dist/cli.js, those omissions became live,
 * silent regressions. Status stays on Python until the `watcher` module is
 * ported (next milestone) and a full port can be done properly.
 */
export const TS_COMMANDS = ["archive", "units-status", "model", "event"] as const;

export interface CliDeps {
  delegate: (argv: string[]) => number;
  // archive 會真的呼叫 openspec CLI,測試要能換掉它。Python 那側是
  // monkeypatch cli.archive_change,這裡用注入達到同一件事。
  archiveChange: (changeId: string) => OpenSpecResult;
  // archiveWorkfiles 會真的動檔案系統(sweep 工作檔),測試要能換掉它,
  // 才能演練「archive 成功、sweep 失敗」這條 warn-but-exit-0 的路徑而不必
  // 真的在磁碟上造出一個會讓 statSync/renameSync 失敗的情境。
  archiveWorkfiles: (checkpointPath: string, changeId: string) => string[];
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
 * merge 階段歸檔:openspec archive 成功後才收工作檔。
 *
 * 失敗語意是刻意的:openspec archive 失敗回 1;工作檔歸檔失敗只印 warning、
 * 回 0——後者是清理,不該反噬前者已經完成的歸檔結果。
 */
function cmdArchive(
  file: string,
  archive: (changeId: string) => OpenSpecResult,
  sweep: (checkpointPath: string, changeId: string) => string[],
): number {
  const cp = loadCheckpoint(file);
  const result = archive(cp.change_id);
  process.stdout.write(`${result.output}\n`);
  if (!result.ok) {
    return 1;
  }
  try {
    const archived = sweep(file, cp.change_id);
    process.stdout.write(
      `archived workfiles: ${archived.length} -> ${join(dirname(file), "archive", cp.change_id)}\n`,
    );
  } catch (exc) {
    process.stderr.write(`warning: workfile archive failed: ${String(exc)}\n`);
  }
  return 0;
}

/**
 * units-status subcommand. Python: `print("%s %s" % (u["id"], u["status"]))`
 * — a unit missing either key raises KeyError and the command dies. Plain
 * property access (`u.id`/`u.status`) would instead print `undefined` and
 * exit 0, the exact obj.k hazard pyIndex exists to close.
 */
function cmdUnitsStatus(file: string): number {
  const cp = loadCheckpoint(file);
  const units = cp.units as unknown as Unit[];
  for (const raw of units) {
    const u = raw as unknown as Record<string, unknown>;
    process.stdout.write(`${pyIndex<string>(u, "id")} ${pyIndex<string>(u, "status")}\n`);
  }
  const pend = pendingUnits(units).map((raw) => pyIndex<string>(raw as unknown as Record<string, unknown>, "id"));
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

/**
 * checkpoint save + transition 追加到 history.jsonl + auto-arm。
 *
 * history 是 best-effort 的觀測資料:寫失敗只在 stderr 警告,不能反噬已經
 * 成功的主命令。auto-arm 同理(在 ensureArmedAfterSave 裡自己處理)。
 *
 * `fromPhase` 收 `string | null` 是為了對齊 Python:`_cmd_start` 傳的是
 * `None`,append_history 直接把它寫進 JSON 變成 `"from": null`。history.ts 的
 * `appendHistory` 只收 `string`,所以這裡用 `?? ""` 收斂——`start` 在本里程碑
 * 還沒移植過來,這個分歧目前不可達;等 `start` 進 TS 時要改的是 history.ts 的
 * 簽章(讓它收 `string | null`),不是在這裡把 null 悄悄變成空字串。
 */
function saveWithHistory(
  cp: Checkpoint,
  file: string,
  event: string,
  fromPhase: string | null,
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

/**
 * Python 的 `"%s" % value`。這裡只用在 qa_skip 守門的錯誤訊息上,而該訊息會
 * 把 checkpoint 上未經型別收斂的 `needs_uiux` 直接插進去。
 *
 * 直譯成 `String(v)` 會印出 JS 的 `false`,Python 印的是 `False`——實測
 * `event --event qa_skip`(flow_profile=full)PY 印
 * "(got full/False)"、TS(修前)印 "(got full/false)"。null 同理(`None`)。
 *
 * 已知未涵蓋:容器型別。Python 的 `%s` 對 list/dict 走 repr,用單引號
 * (`{'a': 1}`),JSON.stringify 用雙引號。checkpoint 的 needs_uiux 要是容器
 * 才踩得到,實務上不會發生,且訊息文字的分歧已登記在
 * fixtures/parity/README.md,不值得為此手寫一份 Python repr。
 */
function pyFormat(value: unknown): string {
  if (value === true) {
    return "True";
  }
  if (value === false) {
    return "False";
  }
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function cmdEvent(
  file: string,
  event: string,
  max: number,
  finishMode: string | null,
): number {
  const cp = loadCheckpoint(file);
  // qa_skip 只在 light 且非 uiux 放行:裁剪必須有檔位授權,且 UX 線不可裁
  // (light+uiux 的 QA 保留以驗 UX 驗收)。guard 讀 checkpoint(start 時凍結)。
  //
  // `!cp.needs_uiux` 是 Python 的 `not cp.needs_uiux`:needs_uiux 沒有經過任何
  // 型別收斂(loadCheckpoint 原樣帶入磁碟上的 JSON),但 JS 與 Python 對
  // 這裡可能出現的值 falsy 判定一致的只有 false/null/0/""。容器(`[]`/`{}`)
  // 兩邊相反,所以照樣走 pyTruthy 才安全——見下。
  if (event === QA_SKIP && !(cp.flow_profile === "light" && !pyTruthy(cp.needs_uiux))) {
    process.stderr.write(
      "error: qa_skip requires flow_profile=light and needs_uiux=false "
      + `(got ${pyFormat(cp.flow_profile)}/${pyFormat(cp.needs_uiux)})\n`,
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
  // Python 是 `if getattr(args, "finish_mode", None):`——truthy 檢查,不是
  // `is not None`。argparse 的 choices 已經把值限制在 merge/pr,所以兩者
  // 在可達輸入上等價。
  if (finishMode !== null && finishMode !== "") {
    cp.finish_mode = finishMode;
  }
  saveWithHistory(cp, file, event, fromPhase);
  process.stdout.write(`phase=${cp.phase} iteration=${cp.iteration}\n`);
  return 0;
}

/**
 * `--key value` 形式的旗標解析。回傳每個已知旗標的**最後一次**出現(argparse
 * 的 store 動作就是後蓋前:`model --stage apply --stage fix` 兩邊都要落地
 * `fix`),以及沒被任何已知旗標(或其值)吃掉的殘餘 token。
 *
 * 殘餘 token 非空,代表命令列上有一個已知旗標集合認不出的東西——多半是打錯
 * 字的旗標。argparse 對這種情況一律 exit 2 印 "unrecognized arguments";呼
 * 叫端(main())比照辦理,而不是靜默把它當沒發生過。
 */
function parseArgs(
  rest: string[],
  known: readonly string[],
): { values: Map<string, string>; unknown: string[] } {
  const values = new Map<string, string>();
  const consumed = new Array<boolean>(rest.length).fill(false);
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (known.includes(tok)) {
      consumed[i] = true;
      if (i + 1 < rest.length) {
        values.set(tok, rest[i + 1] as string);
        consumed[i + 1] = true;
        i++;
      }
    }
  }
  const unknown = rest.filter((_, i) => !consumed[i]);
  return { values, unknown };
}

/**
 * 必填旗標(無預設值)的讀取規則:空字串視同缺席。舊的 `status` 解析是
 * `i === -1 || !rest[i + 1]`,`--file ""` 會被當成缺 `--file` 回 2——這裡延續
 * 同一條規則,只用在「缺席時要直接 exit 2」的旗標(`--file`、`--stage`)。
 *
 * 不適用於有非空預設值的旗標(例如 `model --config`):那種旗標的空字串是
 * 使用者明確傳入的字面值,必須原樣送進 loadConfig("")(Python argparse 也是
 * 存字面值,不會因為它是空字串就退回 default),不能被這條規則吃掉、
 * 誤觸發 `?? default`。那類旗標改用 `rawFlag`(見下)。
 */
function requiredFlag(values: Map<string, string>, name: string): string | undefined {
  const value = values.get(name);
  return value === undefined || value === "" ? undefined : value;
}

/** 有預設值旗標的讀取規則:只有「完全沒傳這個旗標」才算缺席,空字串是合法字面值。 */
function rawFlag(values: Map<string, string>, name: string): string | undefined {
  return values.get(name);
}

/**
 * Python 的 `type=int`:非整數 argparse 回 2 並印 usage。這裡回 null 讓呼叫端
 * 回 2——訊息文字與 argparse 不同(少一段 usage),那是既有的、寫在
 * fixtures/parity/README.md 的可接受分歧。
 *
 * 用 pyParseInt 而不是 Number()/parseInt():`int("0x10")` 在 Python 是
 * ValueError、`Number("0x10")` 是 16;`int("1_0")` 是 10、`Number` 是 NaN;
 * `parseInt("5x")` 是 5、Python 直接 ValueError。三種都會讓 --max 被誤解。
 */
function parseIntFlag(
  values: Map<string, string>,
  name: string,
  fallback: number,
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

/**
 * Python 的 `main()` 把 `args.func(args)` 包在 try 裡,把 InvalidTransition
 * 轉成 `error: <訊息>` + exit 2(未知事件、或該階段不接受該事件)。沒有這層,
 * `event --event no_such_event` 在 TS 會變成未捕捉例外 + stack trace + exit 1。
 *
 * (Python 同一層還接 ReportError,但那是 review/qa 命令的例外,本里程碑還沒
 * 移植;等那些命令進 TS 時在這裡補第二個分支。)
 */
export async function main(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  try {
    return await dispatch(argv, deps);
  } catch (exc) {
    if (exc instanceof InvalidTransition) {
      process.stderr.write(`error: ${exc.message}\n`);
      return 2;
    }
    throw exc;
  }
}

async function dispatch(argv: string[], deps: Partial<CliDeps>): Promise<number> {
  const delegate = deps.delegate ?? delegateToPython;
  const [cmd, ...rest] = argv;
  if (cmd === undefined || !(TS_COMMANDS as readonly string[]).includes(cmd)) {
    // 未知命令也走這條:Python 的 argparse 會印出 usage 與合法命令清單並回 2,
    // 那正是現行行為,不需要在這裡另外複製一份。
    return delegate(argv);
  }
  if (cmd === "archive") {
    const { values, unknown } = parseArgs(rest, ["--file"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}\n`);
      return 2;
    }
    const file = requiredFlag(values, "--file");
    if (file === undefined) {
      process.stderr.write("archive requires --file\n");
      return 2;
    }
    return cmdArchive(
      file,
      deps.archiveChange ?? archiveChange,
      deps.archiveWorkfiles ?? archiveWorkfilesReal,
    );
  }
  if (cmd === "units-status") {
    const { values, unknown } = parseArgs(rest, ["--file"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}\n`);
      return 2;
    }
    const file = requiredFlag(values, "--file");
    if (file === undefined) {
      process.stderr.write("units-status requires --file\n");
      return 2;
    }
    return cmdUnitsStatus(file);
  }
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
    // 這裡用 rawFlag 而不是 requiredFlag:`--finish-mode ""` 在 argparse 是
    // 「非法選項」exit 2(實測),不是「沒傳」;requiredFlag 的「空字串視同
    // 缺席」規則會把它靜默吃掉變成 exit 0。
    const finishMode = rawFlag(values, "--finish-mode") ?? null;
    if (finishMode !== null && finishMode !== "merge" && finishMode !== "pr") {
      process.stderr.write(
        `error: argument --finish-mode: invalid choice: '${finishMode}' `
        + "(choose from 'merge', 'pr')\n",
      );
      return 2;
    }
    return cmdEvent(file, event, max, finishMode);
  }
  if (cmd === "model") {
    const { values, unknown } = parseArgs(rest, ["--stage", "--config"]);
    if (unknown.length > 0) {
      process.stderr.write(`error: unrecognized arguments: ${unknown.join(" ")}\n`);
      return 2;
    }
    const stage = requiredFlag(values, "--stage");
    if (stage === undefined) {
      process.stderr.write("model requires --stage\n");
      return 2;
    }
    // Python 的 --config 預設值——rawFlag,不是 requiredFlag:`--config ""`
    // 必須留著空字串本身,不能被「空字串視同缺席」規則吃掉變回這個預設值。
    return cmdModel(stage, rawFlag(values, "--config") ?? ".devloop/config.json");
  }
  // TS_COMMANDS 列了但這裡沒分派 —— cli.test.ts 的一致性測試會先擋下
  process.stderr.write(`unrouted command: ${cmd}\n`);
  return 2;
}

/**
 * 儘量把路徑正規化成實體路徑;`realpathSync` 失敗(例如路徑其實不存在)時
 * 沒有 symlink-安全的答案可言,只能退回字面路徑正規化當作盡力而為的猜測。
 */
function canon(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
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
 *
 * 兩邊各自獨立 canonicalize(而不是包一個 try/catch 比兩次 realpathSync)：
 * 若只有一邊 realpathSync 失敗就整體退回 `resolve(a) === b`,b 那邊仍是
 * realpath 過的實體路徑、a 卻是字面路徑,symlink 情境下兩者本來就不相等
 * ——那正是這個守衛要擋下的「什麼都不印、回 0」失敗模式又重新發生一次。
 */
function samePath(a: string, b: string): boolean {
  return canon(a) === canon(b);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && samePath(invokedPath, fileURLToPath(import.meta.url))) {
  // main 現在回 Promise:直接 process.exit(main(...)) 會拿 Promise 當 exit
  // code,不論哪種 Node 行為,真正的 exit code 都會不見。實測 Node v24.18.0
  // (`node -e 'async function f(){return 2} process.exit(f())'`):同步丟出
  // TypeError [ERR_INVALID_ARG_TYPE],未捕捉的例外讓行程以 exit 1 收尾——
  // 不是「Promise 轉成 NaN」。舊版 Node 曾有把 exit code 轉數字、Promise
  // 變 NaN 因而 exit 0 的說法,但那是未經這裡驗證的舊行為,不當作現況。
  // 兩種情況共同點都是:正確的 exit code(這裡範例是 2)被蓋掉,所以無論
  // 底層機制為何,守衛都必須先 await/then 出真正的數字再交給 process.exit。
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String((err as Error).stack ?? err)}\n`);
      process.exit(1);
    },
  );
}

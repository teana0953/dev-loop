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
    } catch (e) {
      // Python 只捕 (ProcessLookupError, PermissionError, OSError) —— 行程已死
      // (ESRCH)或無權限(EPERM)。一個超出 pid 範圍的數字在 Python 是
      // OverflowError(非 OSError 子類,會冒出去、unlink 不會執行);Node
      // 對應的是 TypeError(無 .code)。只吞 ESRCH/EPERM,其餘一律往外拋,
      // 讓損毀的狀態被看見而不是被清除證據。
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || code === "EPERM") {
        result = "absent";
      } else {
        throw e;
      }
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
  } catch (e) {
    // Python 只捕 FileNotFoundError(TOCTOU:剛剛還在,現在沒了)。目的地已是
    // 目錄(IsADirectoryError/EISDIR)或跨裝置(EXDEV)這類真正損毀的狀態要
    // 冒出去,不能被吞成「沒東西可搬」的 false——那是謊報乾淨。
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    throw e;
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

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

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree, mergeBranch, listWorktreePaths, parseWorktreePaths, worktreeExists,
  type GitRunner,
} from "./worktree.js";

describe("addWorktree", () => {
  it("throws with git's stderr when the command fails", () => {
    const failing: GitRunner = () => ({ code: 1, stdout: "", stderr: "boom" });
    expect(() => addWorktree("/r", "/p", "b", "main", failing)).toThrow("boom");
  });
  it("falls back to stdout when stderr is empty", () => {
    const failing: GitRunner = () => ({ code: 1, stdout: "out-only", stderr: "" });
    expect(() => addWorktree("/r", "/p", "b", "main", failing)).toThrow("out-only");
  });
});

describe("mergeBranch", () => {
  it("aborts the merge on conflict and reports both streams", () => {
    const calls: string[][] = [];
    const conflicting: GitRunner = (_repo, args) => {
      calls.push(args);
      return args[0] === "merge" && args[1] === "--no-ff"
        ? { code: 1, stdout: "o", stderr: "e" }
        : { code: 0, stdout: "", stderr: "" };
    };
    const r = mergeBranch("/r", "b", conflicting);
    expect(r).toEqual({ ok: false, conflict: true, output: "oe" });
    expect(calls.some((a) => a[0] === "merge" && a[1] === "--abort")).toBe(true);
  });
  it("does not abort on success", () => {
    const calls: string[][] = [];
    const runner: GitRunner = (_repo, args) => { calls.push(args); return { code: 0, stdout: "done", stderr: "" }; };
    expect(mergeBranch("/r", "b", runner).ok).toBe(true);
    expect(calls.some((a) => a[1] === "--abort")).toBe(false);
  });
});

/**
 * fixtures/parity/worktree.json 的每個 case 都用不存在的假路徑(/repo/.wt/a),
 * pyResolve 對它們一律原樣回傳 —— 也就是說把 parseWorktreePaths 裡的 pyResolve
 * 整個拿掉,那份 fixture 兩側依然全綠。symlink 沒辦法用 JSON 表達,所以這一段
 * 由測試自己造一個真的 symlink 目錄來釘。
 *
 * 刻意**不**依賴 macOS 的 /tmp -> /private/tmp:CI 跑的是 ubuntu-latest,那裡
 * 的 /tmp 是真目錄,靠它的話這條在 CI 就退化成恆綠。
 *
 * 對稱測試:tests/test_worktree.py 的
 * test_list_worktree_paths_resolves_a_symlinked_parent /
 * test_worktree_exists_through_a_symlinked_parent。
 */
describe("parseWorktreePaths resolves symlinks (the reason pyResolve exists)", () => {
  function symlinkedDir(): { base: string; real: string; link: string } {
    const base = mkdtempSync(join(tmpdir(), "wt-sym-"));
    const real = join(base, "real");
    mkdirSync(real);
    const link = join(base, "link");
    symlinkSync(real, link, "dir");
    return { base, real, link };
  }

  it("rewrites a worktree path given through a symlinked parent to the real path", () => {
    const { base, real, link } = symlinkedDir();
    // 期望值用 node 原生的 realpathSync 算,不經過受測的 pyResolve。
    const want = join(realpathSync(real), "w");
    const porcelain = `worktree ${join(base, "repo")}\n\nworktree ${join(link, "w")}\n`;
    const got = parseWorktreePaths(porcelain, join(realpathSync(base), "repo"));
    expect(got).toEqual([want]);
    // 沒解 symlink 的話會是這個值——確保上面的斷言真的在區分兩者。
    expect(got[0]).not.toBe(join(link, "w"));
  });

  it("excludes the main worktree even when git prints it through a symlink", () => {
    const { real, link } = symlinkedDir();
    const repoReal = join(realpathSync(real), "repo");
    const porcelain = `worktree ${join(link, "repo")}\nHEAD abc\n`;
    expect(parseWorktreePaths(porcelain, repoReal)).toEqual([]);
  });
});

describe("worktreeExists against real git", () => {
  it("matches a path given through a symlinked parent", () => {
    // 用測試自己造的 symlink(不是 macOS 的 /tmp),所以 ubuntu CI 上照樣有效:
    // git porcelain 印的是實體路徑,使用者給的是穿過 symlink 的路徑,兩者要
    // 比得上就非得先 resolve 不可。
    const repoBase = mkdtempSync(join(tmpdir(), "wt-repo-"));
    const repo = join(repoBase, "real");
    mkdirSync(repo);
    symlinkSync(repo, join(repoBase, "link"), "dir");
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "t@e"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a", "utf-8");
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "init"]);
    const outBase = mkdtempSync(join(tmpdir(), "wt-out-"));
    const outReal = join(outBase, "real");
    mkdirSync(outReal);
    symlinkSync(outReal, join(outBase, "link"), "dir");
    const wt = join(outBase, "link", "w");
    addWorktree(repo, wt, "feat", "HEAD");
    // repo 也從 symlink 進來:主工作區的排除比對走的是 pyResolve(repo) vs git
    // 印出的實體路徑,不 resolve 就會把主 repo 也算成 linked worktree。
    const repoViaLink = join(repoBase, "link");
    expect(listWorktreePaths(repoViaLink).length).toBe(1);
    expect(listWorktreePaths(repo).length).toBe(1);
    // git 印的是 outReal/w;wt 走的是 link。不 resolve 就比不到。
    expect(listWorktreePaths(repo)[0]).toBe(join(realpathSync(outReal), "w"));
    expect(worktreeExists(repo, wt)).toBe(true);
  });
});

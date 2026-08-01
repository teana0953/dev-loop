import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree, mergeBranch, listWorktreePaths, worktreeExists,
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

describe("worktreeExists against real git", () => {
  it("matches a path given through a symlinked parent", () => {
    // macOS 的 /tmp 是 /private/tmp 的 symlink,而 git porcelain 印實體路徑。
    // 用 resolve()(不解 symlink)實作的話這條會 false。
    const repo = mkdtempSync(join(tmpdir(), "wt-repo-"));
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "t@e"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a", "utf-8");
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "init"]);
    const wt = join(mkdtempSync(join(tmpdir(), "wt-out-")), "w");
    addWorktree(repo, wt, "feat", "HEAD");
    expect(listWorktreePaths(repo).length).toBe(1);
    expect(worktreeExists(repo, wt)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  disarmWatcher, sweepChangeMeta, pruneOrphanWorktrees, classifyBranchDeleteError, deleteMergedBranch,
} from "./teardown.js";
import type { GitRunner } from "./worktree.js";

function devloopDir(): string {
  const d = join(mkdtempSync(join(tmpdir(), "td-")), ".devloop");
  mkdirSync(join(d, "changes"), { recursive: true });
  return d;
}

describe("disarmWatcher", () => {
  it("reports absent when there is no pid file", () => {
    const d = devloopDir();
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
  });
  it("treats a malformed pid as absent and still removes the file", () => {
    // Python 的 int("12abc") 拋 ValueError;Number.parseInt 回 12,會去 kill
    // 一個無關的行程。這條就是釘住那個差異。
    const d = devloopDir();
    const pid = join(d, "watcher.pid");
    writeFileSync(pid, "12abc", "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
    expect(existsSync(pid)).toBe(false);
  });
  it("does not kill the process a loose parse would have found", async () => {
    // 上一條的 "12abc" 其實抓不到把 pyParseInt 換回 Number.parseInt 的退化:
    // 它會解成 pid 12,那是 kernel 行程,kill 回 EPERM,結果照樣是 "absent"
    // ——測試綠著、行為卻已經在對無關的行程送訊號了。這條把「無關的行程」
    // 換成一個我們看得見死活的自家子行程,退化就藏不住了。
    const d = devloopDir();
    const child = spawn("sleep", ["30"]);
    await new Promise<void>((ok, bad) => {
      child.once("spawn", () => ok());
      child.once("error", bad);
    });
    const pid = join(d, "watcher.pid");
    writeFileSync(pid, `${child.pid}abc`, "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
    expect(child.killed, "非法的 pid 檔不得害到任何真實行程").toBe(false);
    expect(process.kill(child.pid as number, 0)).toBe(true);
    child.kill("SIGKILL");
  });
  it("treats a dead pid as absent and still removes the file", () => {
    const d = devloopDir();
    const pid = join(d, "watcher.pid");
    // 極高機率不存在的 pid
    writeFileSync(pid, "2147483646", "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("absent");
    expect(existsSync(pid)).toBe(false);
  });
  it("kills a live process and removes the pid file", async () => {
    // 對稱 tests/test_teardown.py 的 test_disarm_watcher_kills_live_process_and_removes_pidfile。
    const d = devloopDir();
    const child = spawn("sleep", ["30"]);
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", () => resolveSpawn());
      child.once("error", reject);
    });
    const pid = join(d, "watcher.pid");
    writeFileSync(pid, String(child.pid), "utf-8");
    expect(disarmWatcher(join(d, "checkpoint.json"))).toBe("killed");
    expect(existsSync(pid)).toBe(false);
    const exit = await new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    expect(exit.signal).toBe("SIGTERM");
  });
  it("propagates on an unrepresentable pid instead of swallowing it, and leaves the pid file", () => {
    // Python: os.kill(2**63, SIGTERM) raises OverflowError, which is NOT an
    // OSError subclass, so it is not caught by `except (ProcessLookupError,
    // PermissionError, OSError)` — disarm_watcher crashes and pid_path.unlink()
    // never runs. Node's process.kill(2**63, ...) raises a TypeError with no
    // .code; the narrowed catch (ESRCH/EPERM only) must let it through too,
    // and the pid file must survive since we never reach unlinkSync.
    const d = devloopDir();
    const pid = join(d, "watcher.pid");
    writeFileSync(pid, String(2 ** 63), "utf-8");
    expect(() => disarmWatcher(join(d, "checkpoint.json"))).toThrow();
    expect(existsSync(pid)).toBe(true);
  });
});

describe("sweepChangeMeta", () => {
  it("moves the meta and creates the archive directory", () => {
    const d = devloopDir();
    writeFileSync(join(d, "changes", "c1.json"), "{}", "utf-8");
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "c1")).toBe(true);
    expect(existsSync(join(d, "archive", "c1", "c1.json"))).toBe(true);
    expect(existsSync(join(d, "changes", "c1.json"))).toBe(false);
  });
  it("is idempotent", () => {
    const d = devloopDir();
    writeFileSync(join(d, "changes", "c1.json"), "{}", "utf-8");
    sweepChangeMeta(join(d, "checkpoint.json"), "c1");
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "c1")).toBe(false);
  });
  it("returns false when there is no meta", () => {
    const d = devloopDir();
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "nope")).toBe(false);
  });
  it("a change id containing a slash lands on the basename, as Python's meta.name does", () => {
    // Python 用 `meta.name`(basename),不是重新拼 `<change_id>.json`。
    // `--change-id` 是 required=True 且完全沒有驗證,含 "/" 的值是合法輸入。
    // 實測 change_id "a/b"(檔案在 changes/a/b.json):
    //   PY -> True,搬到 archive/a/b/b.json
    //   TS(修前) -> False,目的地拼成 archive/a/b/a/b.json,檔案原地不動
    const d = devloopDir();
    mkdirSync(join(d, "changes", "a"), { recursive: true });
    writeFileSync(join(d, "changes", "a", "b.json"), "{}", "utf-8");
    expect(sweepChangeMeta(join(d, "checkpoint.json"), "a/b")).toBe(true);
    expect(existsSync(join(d, "archive", "a", "b", "b.json"))).toBe(true);
    expect(existsSync(join(d, "changes", "a", "b.json"))).toBe(false);
  });
  it("propagates when the destination path is a directory instead of reporting nothing to sweep", () => {
    // Python: Path(meta).replace(dest) raises IsADirectoryError when dest is a
    // directory; only FileNotFoundError is caught, so this is not swallowed
    // into `False`. Node's renameSync raises EISDIR in the same situation —
    // the narrowed catch (ENOENT only) must let it through, not report a
    // clean "nothing to sweep" for a genuinely corrupt archive destination.
    const d = devloopDir();
    writeFileSync(join(d, "changes", "c1.json"), "{}", "utf-8");
    mkdirSync(join(d, "archive", "c1", "c1.json"), { recursive: true });
    expect(() => sweepChangeMeta(join(d, "checkpoint.json"), "c1")).toThrow();
  });
});

describe("pruneOrphanWorktrees", () => {
  it("prunes and returns zero when the worktree root does not exist", () => {
    const calls: string[][] = [];
    const git: GitRunner = (_r, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; };
    expect(pruneOrphanWorktrees("/repo", "/nope", git)).toBe(0);
    expect(calls[0]).toEqual(["worktree", "prune"]);
  });
  it("only removes worktrees under the root", () => {
    const root = mkdtempSync(join(tmpdir(), "wtroot-"));
    const inside = join(root, "a");
    const git: GitRunner = (_r, args) => {
      if (args[0] === "worktree" && args[1] === "list") {
        return { code: 0, stdout: `worktree /repo\n\nworktree ${inside}\n\nworktree /elsewhere/b\n`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(pruneOrphanWorktrees("/repo", root, git)).toBe(1);
  });
});

describe("classifyBranchDeleteError order", () => {
  it("prefers checked_out over absent when both substrings appear", () => {
    expect(classifyBranchDeleteError(1, "checked out at '/x'; ref not found")).toBe("checked_out");
  });
});

describe("deleteMergedBranch", () => {
  it("delegates to git branch -d and classifies a successful deletion", () => {
    const calls: string[][] = [];
    const git: GitRunner = (_r, args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; };
    expect(deleteMergedBranch("/repo", "feat", git)).toBe("deleted");
    expect(calls[0]).toEqual(["branch", "-d", "feat"]);
  });
  it("classifies a non-zero exit via stderr", () => {
    const git: GitRunner = () => ({ code: 1, stdout: "", stderr: "error: The branch 'feat' is not fully merged.\n" });
    expect(deleteMergedBranch("/repo", "feat", git)).toBe("unmerged");
  });
});

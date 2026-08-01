import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TS_COMMANDS, main } from "./cli.js";

const CLI = join(process.cwd(), "dist", "cli.js");
const WRAPPER = join(process.cwd(), "bin", "devloop");

function runStatus(cpPath: string): string {
  return execFileSync("node", [CLI, "status", "--file", cpPath], { encoding: "utf-8" });
}

function runStatusViaWrapper(cpPath: string): string {
  return execFileSync(WRAPPER, ["status", "--file", cpPath], { encoding: "utf-8" });
}

describe("cli status", () => {
  it("prints phase summary and next hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    const p = join(dir, "cp.json");
    writeFileSync(
      p,
      JSON.stringify({
        phase: "gate",
        change_id: "c",
        branch: "b",
        iteration: 1,
        gate_failures: 0,
      }),
      "utf-8",
    );
    const out = runStatus(p);
    const lines = out.trim().split("\n");
    expect(lines[0]).toContain("gate");
    expect(lines[1]).toMatch(/^next: /);
  });

  it("prints updated_at line when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    const p = join(dir, "cp.json");
    writeFileSync(
      p,
      JSON.stringify({
        phase: "done",
        change_id: "c",
        branch: "b",
        iteration: 2,
        updated_at: "2026-07-30T00:00:00.000Z",
      }),
      "utf-8",
    );
    const out = runStatus(p);
    const lines = out.trim().split("\n");
    expect(lines[0]).toBe("phase=done iteration=2 change_id=c branch=b");
    expect(lines[1]).toBe("next: (done)");
    expect(lines[2]).toBe("updated_at=2026-07-30T00:00:00.000Z");
  });

  it.skipIf(process.platform === "win32")(
    "committed bundle (dist/cli.js) is directly executable (no `node` prefix, execute bit set)",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "cli-"));
      const p = join(dir, "cp.json");
      writeFileSync(
        p,
        JSON.stringify({
          phase: "gate",
          change_id: "c",
          branch: "b",
          iteration: 1,
          gate_failures: 0,
        }),
        "utf-8",
      );
      // Invoke dist/cli.js directly (no "node" prefix) relying on its own
      // shebang + execute bit, exactly as `npm link`/`npx` would. This locks
      // that `npm run bundle` always leaves the committed bundle executable.
      const out = execFileSync(CLI, ["status", "--file", p], { encoding: "utf-8" });
      const lines = out.trim().split("\n");
      expect(lines[0]).toBe("phase=gate iteration=1 change_id=c branch=b");
      expect(lines[1]).toMatch(/^next: /);
    },
  );

  it.skipIf(process.platform === "win32")(
    "wrapper (bin/devloop) produces the same output as direct invocation",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "cli-"));
      const p = join(dir, "cp.json");
      writeFileSync(
        p,
        JSON.stringify({
          phase: "gate",
          change_id: "c",
          branch: "b",
          iteration: 1,
          gate_failures: 0,
        }),
        "utf-8",
      );
      const direct = runStatus(p);
      const viaWrapper = runStatusViaWrapper(p);
      expect(viaWrapper).toBe(direct);
      const lines = viaWrapper.trim().split("\n");
      expect(lines[0]).toContain("gate");
      expect(lines[1]).toMatch(/^next: /);
    },
  );

  it("treats an empty --file value as missing (exit 2), matching the pre-TS behavior", () => {
    const rc = main(["status", "--file", ""]);
    expect(rc).toBe(2);
  });
});

describe("command routing", () => {
  it("routes every command it does not own to Python", () => {
    const seen: string[][] = [];
    const rc = main(["event", "--file", "x", "--event", "apply_done"], {
      delegate: (argv) => { seen.push(argv); return 7; },
    });
    expect(rc).toBe(7);
    expect(seen).toEqual([["event", "--file", "x", "--event", "apply_done"]]);
  });

  it("routes an unknown command to Python rather than inventing its own error", () => {
    // Python 的 argparse 已經會印 usage 與合法命令清單並回 2;TS 自己再寫一份
    // 只會多一個會漂移的真理來源。
    const seen: string[][] = [];
    main(["nosuch"], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(seen).toEqual([["nosuch"]]);
  });

  it("routes no-args to Python", () => {
    const seen: string[][] = [];
    main([], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(seen).toEqual([[]]);
  });

  it("every command it claims is actually dispatched", () => {
    // 兩種不同的漂移各測一次:
    //  - 清單少列一個已實作的命令 → 呼叫靜默走 Python(delegated 變 true)。
    //  - 清單多列一個沒接分派分支的命令 → 落到 main() 的 `unrouted command`
    //    分支,exit 2、印 stderr,但同樣不會呼叫 delegate——只看 delegated
    //    抓不到這種情況(兩種情況下 delegated 都是 false),所以還要另外
    //    斷言沒有印出 `unrouted command`。
    for (const cmd of TS_COMMANDS) {
      let delegated = false;
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      main([cmd], { delegate: () => { delegated = true; return 0; } });
      const unrouted = stderrSpy.mock.calls.some(([msg]) =>
        String(msg).includes("unrouted command"),
      );
      stderrSpy.mockRestore();
      expect(delegated, `${cmd} is in TS_COMMANDS but fell through to Python`).toBe(false);
      expect(unrouted, `${cmd} is in TS_COMMANDS but has no dispatch branch in main()`).toBe(
        false,
      );
    }
  });
});

describe("delegation to the Python engine", () => {
  it("runs a not-yet-ported command end to end through bin/devloop", () => {
    // 走真的 wrapper、真的 node、真的 python3。PYTHONPATH 設錯的話這裡會
    // ModuleNotFoundError,而不是靜靜地過。
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    const p = join(dir, "cp.json");
    writeFileSync(
      p,
      JSON.stringify({ phase: "apply", change_id: "c", branch: "b", iteration: 0 }),
      "utf-8",
    );
    const out = execFileSync(WRAPPER, ["event", "--file", p, "--event", "apply_done"], {
      encoding: "utf-8",
    });
    expect(out).toContain("phase=gate");
  });

  it("passes the Python exit code through", () => {
    // 不存在的子命令:argparse 回 2
    let status: number | undefined;
    try {
      execFileSync(WRAPPER, ["nosuch-command"], { encoding: "utf-8", stdio: "pipe" });
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(2);
  });
});

describe("archive", () => {
  function checkpointAt(dir: string, changeId: string): string {
    const p = join(dir, "checkpoint.json");
    writeFileSync(
      p,
      JSON.stringify({ phase: "merge", change_id: changeId, branch: "b" }),
      "utf-8",
    );
    return p;
  }

  it("archives the change, then sweeps the workfiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "add-foo");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const seen: string[] = [];
    const rc = main(["archive", "--file", cp], {
      archiveChange: (id) => {
        seen.push(id);
        return { ok: true, command: ["openspec", "archive", id], output: "archived" };
      },
    });
    expect(rc).toBe(0);
    expect(seen).toEqual(["add-foo"]);
    expect(readdirSync(join(dir, "archive", "add-foo")).sort())
      .toEqual(["checkpoint.json", "r.json"]);
  });

  it("returns 1 and sweeps nothing when the openspec archive fails", () => {
    // 失敗語意是刻意的:openspec 沒歸檔成功就不該動工作檔
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "x");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const rc = main(["archive", "--file", cp], {
      archiveChange: (id) => ({ ok: false, command: ["openspec", "archive", id], output: "nope" }),
    });
    expect(rc).toBe(1);
    expect(existsSync(join(dir, "archive"))).toBe(false);
  });
});

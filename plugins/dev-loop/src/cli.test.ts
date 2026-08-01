import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

// status is not in TS_COMMANDS (see C1) — every case below now exercises
// delegation to the real Python engine (through bin/devloop's exec), not a
// TypeScript implementation. That is deliberate: `status` used to be TS-owned
// with three documented omissions (--json, config.json gate_cmds sourcing,
// the watcher-missing warning) that were harmless only because nothing
// invoked the TS path. Making bin/devloop exec dist/cli.js turned them into
// live regressions, and the ruling was to drop status back to Python rather
// than rush a partial port. These tests now pin "byte-identical to Python,
// because it *is* Python" instead of pinning TS's own (incomplete) format.
describe("cli status (delegated to Python — C1)", () => {
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

  it("routes status through the injected delegate rather than owning it", () => {
    const seen: string[][] = [];
    const rc = main(["status", "--file", "x"], {
      delegate: (argv) => { seen.push(argv); return 0; },
    });
    expect(rc).toBe(0);
    expect(seen).toEqual([["status", "--file", "x"]]);
  });

  it("honors gate_cmds from config.json and prints the watcher-missing warning", () => {
    // This is the exact regression C1 pinned: the old TS-owned cmdStatus
    // never read config.json (so the gate hint was always the "<test-cmd>"
    // skeleton, never the real command) and never checked the watcher
    // (so the "watcher not running; re-arm:" warning never printed). Both
    // must show up now that status is Python end to end.
    const dir = mkdtempSync(join(tmpdir(), "cli-status-"));
    const p = join(dir, "cp.json");
    writeFileSync(
      p,
      JSON.stringify({
        phase: "gate",
        change_id: "c",
        branch: "b",
        iteration: 1,
        gate_failures: 0,
        resume_exec: "some-resume-command",
      }),
      "utf-8",
    );
    writeFileSync(join(dir, "config.json"), JSON.stringify({ gate_cmds: ["npm test"] }), "utf-8");
    const proc = spawnSync(WRAPPER, ["status", "--file", p], { encoding: "utf-8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain(`next: devloop gate --file ${p}`);
    expect(proc.stdout).not.toContain("--cmd");
    expect(proc.stderr).toContain("warning: watcher not running; re-arm:");
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

  it("warns but still exits 0 when the workfile sweep itself fails (I6)", () => {
    // Python 對照:tests/test_housekeeping.py
    // test_cli_archive_housekeeping_failure_warns_but_exit_0. The sweep is
    // cleanup — it must not reverse an openspec archive that already
    // succeeded. Injecting archiveWorkfiles lets this be exercised without
    // needing to contrive a real filesystem failure.
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "add-foo");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rc = main(["archive", "--file", cp], {
      archiveChange: () => ({ ok: true, command: ["openspec", "archive", "add-foo"], output: "archived" }),
      archiveWorkfiles: () => {
        throw new Error("disk full");
      },
    });
    const warned = stderrSpy.mock.calls.some(([msg]) =>
      String(msg).includes("warning: workfile archive failed"),
    );
    stderrSpy.mockRestore();
    expect(rc).toBe(0);
    expect(warned).toBe(true);
    // 工作檔沒被歸檔(sweep 失敗),但也沒有被誤刪——archive 成功這件事本身
    // 不反悔。
    expect(existsSync(join(dir, "r.json"))).toBe(true);
  });
});

describe("unknown arguments are rejected (I3)", () => {
  it("units-status exits 2 on a typo'd flag instead of silently ignoring it", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-unk-"));
    const p = join(dir, "cp.json");
    writeFileSync(p, JSON.stringify({ phase: "apply", change_id: "c", branch: "b" }), "utf-8");
    const rc = main(["units-status", "--file", p, "--bogus"]);
    expect(rc).toBe(2);
  });

  it("model exits 2 on a typo'd flag instead of silently ignoring it", () => {
    const rc = main(["model", "--stage", "apply", "--bogus", "x"]);
    expect(rc).toBe(2);
  });

  it("archive exits 2 on a typo'd flag instead of silently ignoring it", () => {
    const rc = main(["archive", "--file", "x", "--json"]);
    expect(rc).toBe(2);
  });

  it("does not reject a command with only known flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-unk-"));
    const p = join(dir, "cp.json");
    writeFileSync(p, JSON.stringify({ phase: "apply", change_id: "c", branch: "b" }), "utf-8");
    expect(main(["units-status", "--file", p])).toBe(0);
  });
});

describe("model: repeated flags and the empty-string --config edge case (M8/M9)", () => {
  it("a repeated --stage takes the LAST occurrence, matching argparse (M8)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-model-"));
    const configPath = join(dir, "config.json");
    // Only "fix" has an override; if --stage were resolved as the first
    // occurrence ("apply", which has no override and no profile) this would
    // print "inherit" instead.
    writeFileSync(configPath, JSON.stringify({ models: { fix: "haiku" } }), "utf-8");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rc = main(["model", "--stage", "apply", "--stage", "fix", "--config", configPath]);
    const printed = stdoutSpy.mock.calls.map(([msg]) => String(msg)).join("");
    stdoutSpy.mockRestore();
    expect(rc).toBe(0);
    expect(printed.trim()).toBe("haiku");
  });

  it('an explicit --config "" is a literal value, not "flag absent" (M9)', () => {
    // flag()/rawFlag() must NOT collapse an explicitly-passed empty string
    // into "flag absent -> substitute the default path". If it did, this
    // could silently load a real .devloop/config.json instead of the literal
    // "" the user typed. loadConfig("") reports no file present (Node's
    // fs.existsSync("") is false), so this must resolve to "inherit" — the
    // same as passing a config path that plainly does not exist — never a
    // real profile/model that happens to live at the default relative path.
    const rc = main(["model", "--stage", "apply", "--config", ""]);
    expect(rc).toBe(0);
  });
});

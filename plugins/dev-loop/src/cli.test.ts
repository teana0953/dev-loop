import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  writeFileSync, readFileSync, mkdtempSync, mkdirSync, readdirSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TS_COMMANDS, main } from "./cli.js";
import { makeCheckpoint, saveCheckpoint, loadCheckpoint } from "./checkpoint.js";

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

  it("routes status through the injected delegate rather than owning it", async () => {
    const seen: string[][] = [];
    const rc = await main(["status", "--file", "x"], {
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
  it("routes every command it does not own to Python", async () => {
    const seen: string[][] = [];
    // `gate` 還沒移植(下一個任務才會),所以它是這條「不屬於我就轉給
    // Python」的樣本。原本用的是 `event`,而 event 已在本任務進 TS_COMMANDS。
    const rc = await main(["gate", "--file", "x", "--cmd", "true"], {
      delegate: (argv) => { seen.push(argv); return 7; },
    });
    expect(rc).toBe(7);
    expect(seen).toEqual([["gate", "--file", "x", "--cmd", "true"]]);
  });

  it("routes an unknown command to Python rather than inventing its own error", async () => {
    // Python 的 argparse 已經會印 usage 與合法命令清單並回 2;TS 自己再寫一份
    // 只會多一個會漂移的真理來源。
    const seen: string[][] = [];
    const rc = await main(["nosuch"], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(rc).toBe(2);
    expect(seen).toEqual([["nosuch"]]);
  });

  it("routes no-args to Python", async () => {
    const seen: string[][] = [];
    const rc = await main([], { delegate: (argv) => { seen.push(argv); return 2; } });
    expect(rc).toBe(2);
    expect(seen).toEqual([[]]);
  });

  it("every command it claims is actually dispatched", async () => {
    // 兩種不同的漂移各測一次:
    //  - 清單少列一個已實作的命令 → 呼叫靜默走 Python(delegated 變 true)。
    //  - 清單多列一個沒接分派分支的命令 → 落到 main() 的 `unrouted command`
    //    分支,exit 2、印 stderr,但同樣不會呼叫 delegate——只看 delegated
    //    抓不到這種情況(兩種情況下 delegated 都是 false),所以還要另外
    //    斷言沒有印出 `unrouted command`。
    for (const cmd of TS_COMMANDS) {
      let delegated = false;
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      // 每個 TS_COMMANDS 命令這裡都不帶其必填旗標(例如 --file/--stage),
      // 所以各自的分派分支都會落到「缺旗標」提前返回 2——這個 rc 斷言同時
      // 釘住「main 真的回傳了東西」(漏 await 會讓 rc 變成 Promise 而非 2)。
      const rc = await main([cmd], { delegate: () => { delegated = true; return 0; } });
      const unrouted = stderrSpy.mock.calls.some(([msg]) =>
        String(msg).includes("unrouted command"),
      );
      stderrSpy.mockRestore();
      expect(rc, `${cmd} did not return the expected missing-flag exit code`).toBe(2);
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

  it("archives the change, then sweeps the workfiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "add-foo");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const seen: string[] = [];
    const rc = await main(["archive", "--file", cp], {
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

  it("returns 1 and sweeps nothing when the openspec archive fails", async () => {
    // 失敗語意是刻意的:openspec 沒歸檔成功就不該動工作檔
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "x");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const rc = await main(["archive", "--file", cp], {
      archiveChange: (id) => ({ ok: false, command: ["openspec", "archive", id], output: "nope" }),
    });
    expect(rc).toBe(1);
    expect(existsSync(join(dir, "archive"))).toBe(false);
  });

  it("warns but still exits 0 when the workfile sweep itself fails (I6)", async () => {
    // Python 對照:tests/test_housekeeping.py
    // test_cli_archive_housekeeping_failure_warns_but_exit_0. The sweep is
    // cleanup — it must not reverse an openspec archive that already
    // succeeded. Injecting archiveWorkfiles lets this be exercised without
    // needing to contrive a real filesystem failure.
    const dir = mkdtempSync(join(tmpdir(), "arch-"));
    const cp = checkpointAt(dir, "add-foo");
    writeFileSync(join(dir, "r.json"), "{}", "utf-8");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rc = await main(["archive", "--file", cp], {
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
  it("units-status exits 2 on a typo'd flag instead of silently ignoring it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-unk-"));
    const p = join(dir, "cp.json");
    writeFileSync(p, JSON.stringify({ phase: "apply", change_id: "c", branch: "b" }), "utf-8");
    const rc = await main(["units-status", "--file", p, "--bogus"]);
    expect(rc).toBe(2);
  });

  it("model exits 2 on a typo'd flag instead of silently ignoring it", async () => {
    const rc = await main(["model", "--stage", "apply", "--bogus", "x"]);
    expect(rc).toBe(2);
  });

  it("archive exits 2 on a typo'd flag instead of silently ignoring it", async () => {
    const rc = await main(["archive", "--file", "x", "--json"]);
    expect(rc).toBe(2);
  });

  it("does not reject a command with only known flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-unk-"));
    const p = join(dir, "cp.json");
    writeFileSync(p, JSON.stringify({ phase: "apply", change_id: "c", branch: "b" }), "utf-8");
    expect(await main(["units-status", "--file", p])).toBe(0);
  });
});

describe("model: repeated flags and the empty-string --config edge case (M8/M9)", () => {
  it("a repeated --stage takes the LAST occurrence, matching argparse (M8)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-model-"));
    const configPath = join(dir, "config.json");
    // Only "fix" has an override; if --stage were resolved as the first
    // occurrence ("apply", which has no override and no profile) this would
    // print "inherit" instead.
    writeFileSync(configPath, JSON.stringify({ models: { fix: "haiku" } }), "utf-8");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rc = await main(["model", "--stage", "apply", "--stage", "fix", "--config", configPath]);
    const printed = stdoutSpy.mock.calls.map(([msg]) => String(msg)).join("");
    stdoutSpy.mockRestore();
    expect(rc).toBe(0);
    expect(printed.trim()).toBe("haiku");
  });

  it('an explicit --config "" is a literal value, not "flag absent" (M9)', async () => {
    // flag()/rawFlag() must NOT collapse an explicitly-passed empty string
    // into "flag absent -> substitute the default path". If it did, this
    // could silently load a real .devloop/config.json instead of the literal
    // "" the user typed. loadConfig("") reports no file present (Node's
    // fs.existsSync("") is false), so this must resolve to "inherit" — the
    // same as passing a config path that plainly does not exist — never a
    // real profile/model that happens to live at the default relative path.
    const rc = await main(["model", "--stage", "apply", "--config", ""]);
    expect(rc).toBe(0);
  });
});

/**
 * event 命令 + backbone(applyEvent / saveWithHistory)。
 *
 * 每條的預期值都抄自 Python 的實測輸出(`python3 -m devloop.cli event ...`),
 * 不是從 TS 實作反推的。
 */
describe("event", () => {
  function fixture(fields: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-event-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }),
      file,
    );
    return file;
  }

  /** cli.test.ts 現行的攔截慣例(見 model 那組):vitest spy,不是憑空 import。 */
  function capture(stream: "stdout" | "stderr"): { text: () => string; restore: () => void } {
    const spy = vi.spyOn(process[stream], "write").mockImplementation(() => true);
    return {
      text: () => spy.mock.calls.map(([msg]) => String(msg)).join(""),
      restore: () => spy.mockRestore(),
    };
  }

  function historyLines(file: string): string[] {
    return readFileSync(join(dirname(file), "history.jsonl"), "utf-8").trim().split("\n");
  }

  it("applies the transition, prints the new state, and appends one history line", async () => {
    // PY: stdout "phase=gate iteration=0\n", exit 0, history 一行
    // {"ts": ..., "event": "apply_done", "from": "apply", "to": "gate", "iteration": 0}
    const file = fixture();
    const out = capture("stdout");
    const rc = await main(["event", "--file", file, "--event", "apply_done"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=gate iteration=0\n");
    expect(loadCheckpoint(file).phase).toBe("gate");
    const hist = historyLines(file);
    expect(hist.length).toBe(1);
    const entry = JSON.parse(hist[0] as string) as Record<string, unknown>;
    expect(entry.event).toBe("apply_done");
    expect(entry.from).toBe("apply");
    expect(entry.to).toBe("gate");
    expect(entry.iteration).toBe(0);
  });

  it("rejects qa_skip outside the light non-uiux profile", async () => {
    // Python:裁剪必須有檔位授權,且 UX 線不可裁。exit 2,checkpoint 不動。
    // PY stderr(實測):
    //   error: qa_skip requires flow_profile=light and needs_uiux=false (got full/False)
    // 注意是 Python 的 `False`,不是 JS 的 `false`。
    const file = fixture({ phase: "qa", flow_profile: "full" });
    const err = capture("stderr");
    const rc = await main(["event", "--file", file, "--event", "qa_skip"]);
    const printed = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(printed).toBe(
      "error: qa_skip requires flow_profile=light and needs_uiux=false (got full/False)\n",
    );
    expect(loadCheckpoint(file).phase).toBe("qa");
  });

  it("allows qa_skip on light without uiux", async () => {
    // PY: "phase=review iteration=0", exit 0
    const file = fixture({ phase: "qa", flow_profile: "light", needs_uiux: false });
    const out = capture("stdout");
    const rc = await main(["event", "--file", file, "--event", "qa_skip"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=review iteration=0\n");
    expect(loadCheckpoint(file).phase).toBe("review");
  });

  it("rejects qa_skip on light WITH uiux", async () => {
    // light+uiux 的 QA 保留以驗 UX 驗收——這一半的守門很容易寫成只看
    // flow_profile 而漏掉 needs_uiux,所以兩半各有一條。
    // PY stderr(實測):"... (got light/True)"
    const file = fixture({ phase: "qa", flow_profile: "light", needs_uiux: true });
    const err = capture("stderr");
    const rc = await main(["event", "--file", file, "--event", "qa_skip"]);
    const printed = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(printed).toBe(
      "error: qa_skip requires flow_profile=light and needs_uiux=false (got light/True)\n",
    );
    expect(loadCheckpoint(file).phase).toBe("qa");
  });

  it("treats a container needs_uiux as truthy, the way Python does", async () => {
    // needs_uiux 沒有型別收斂,磁碟上可以是任何 JSON。Python 的
    // `not cp.needs_uiux` 對 `[]` 是 True(放行)、對 `[0]` 是 False(擋)。
    // 直譯成 JS 的 `!cp.needs_uiux` 兩者都會放行——`[]` 在 JS 是 truthy。
    const allowed = fixture({ phase: "qa", flow_profile: "light", needs_uiux: [] as unknown as boolean });
    const out = capture("stdout");
    const rcAllowed = await main(["event", "--file", allowed, "--event", "qa_skip"]);
    out.restore();
    expect(rcAllowed).toBe(0);

    const blocked = fixture({ phase: "qa", flow_profile: "light", needs_uiux: [0] as unknown as boolean });
    const err = capture("stderr");
    const rcBlocked = await main(["event", "--file", blocked, "--event", "qa_skip"]);
    err.restore();
    expect(rcBlocked).toBe(2);
  });

  it("resets the retry counters on a human resume", async () => {
    // PY: "phase=fix iteration=0";iteration/propose_attempts/gate_failures 全歸零
    const file = fixture({
      phase: "escalated", iteration: 2, propose_attempts: 3, gate_failures: 4,
    });
    const out = capture("stdout");
    const rc = await main(["event", "--file", file, "--event", "human_resume_fix"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=fix iteration=0\n");
    const cp = loadCheckpoint(file);
    expect([cp.iteration, cp.propose_attempts, cp.gate_failures]).toEqual([0, 0, 0]);
  });

  it("records --finish-mode when given", async () => {
    const file = fixture({ phase: "qa" });
    const out = capture("stdout");
    expect(await main(["event", "--file", file, "--event", "qa_pass", "--finish-mode", "pr"]))
      .toBe(0);
    out.restore();
    expect(loadCheckpoint(file).finish_mode).toBe("pr");
  });

  it("rejects a --finish-mode outside argparse's choices", async () => {
    // PY(實測)exit 2:
    //   devloop event: error: argument --finish-mode: invalid choice: 'zzz'
    //   (choose from 'merge', 'pr')
    // 空字串同樣是「非法選項」,不是「沒傳」——這條把兩者都釘住。
    const file = fixture({ phase: "qa" });
    const err = capture("stderr");
    expect(await main(["event", "--file", file, "--event", "qa_pass", "--finish-mode", "zzz"]))
      .toBe(2);
    expect(await main(["event", "--file", file, "--event", "qa_pass", "--finish-mode", ""]))
      .toBe(2);
    err.restore();
    expect(loadCheckpoint(file).phase).toBe("qa");
  });

  it("reports an impossible transition as exit 2, not an unhandled throw", async () => {
    // PY stderr(實測):error: no transition from 'apply' on 'no_such_event'
    // %r 的引號是訊息的一部分。
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["event", "--file", file, "--event", "no_such_event"]);
    const printed = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(printed).toBe("error: no transition from 'apply' on 'no_such_event'\n");
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("rejects a non-integer --max", async () => {
    // PY(實測)exit 2:devloop event: error: argument --max: invalid int value: 'x'
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["event", "--file", file, "--event", "apply_done", "--max", "x"]);
    err.restore();
    expect(rc).toBe(2);
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("honours --max when the gate-pass counter would exceed it", async () => {
    // gate + gate_pass:iteration+1 超過 max 就升級 escalated。--max 走
    // parseIntFlag,傳 0 時 iteration 1 > 0 → escalated(PY 實測相同)。
    const file = fixture({ phase: "gate" });
    const out = capture("stdout");
    const rc = await main(["event", "--file", file, "--event", "gate_pass", "--max", "0"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=escalated iteration=1\n");
  });

  it("rejects unrecognized flags instead of ignoring them", async () => {
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["event", "--file", file, "--event", "apply_done", "--bogus", "1"]);
    err.restore();
    expect(rc).toBe(2);
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("requires --file and --event", async () => {
    const err = capture("stderr");
    expect(await main(["event", "--event", "apply_done"])).toBe(2);
    expect(await main(["event", "--file", fixture()])).toBe(2);
    err.restore();
  });

  it("still saves the checkpoint when the history append fails", async () => {
    // Python:history 是 best-effort 觀測資料,失敗只警告。把 history.jsonl
    // 換成目錄就能讓 append 失敗而 checkpoint save 不受影響。
    const file = fixture();
    mkdirSync(join(dirname(file), "history.jsonl"), { recursive: true });
    const err = capture("stderr");
    const out = capture("stdout");
    const rc = await main(["event", "--file", file, "--event", "apply_done"]);
    const warned = err.text();
    const printed = out.text();
    out.restore();
    err.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=gate iteration=0\n");
    expect(warned).toContain("warning: history append failed:");
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("does not arm a watcher when the checkpoint has no resume command", async () => {
    const file = fixture();
    const out = capture("stdout");
    await main(["event", "--file", file, "--event", "apply_done"]);
    out.restore();
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(false);
  });

  it("arms a watcher after saving when auto_arm is on and a resume command exists", async () => {
    // --exec 用 /usr/bin/true,watcher 跑一次就自己結束,不留孤兒行程。
    // resume_exec 同時寫進 fixture 的 checkpoint 檔:ensureArmedAfterSave 讀
    // 傳進去的物件,ensureArmed 卻是從磁碟重讀,只餵其中一邊會讓變異體從
    // 「合法 skip」那條路溜掉還是綠的。
    const file = fixture({ resume_exec: "/usr/bin/true" });
    const out = capture("stdout");
    await main(["event", "--file", file, "--event", "apply_done"]);
    out.restore();
    expect(loadCheckpoint(file).resume_exec).toBe("/usr/bin/true");
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(true);
  });

  it("does not arm a watcher when config.json turns auto_arm off", async () => {
    const file = fixture({ resume_exec: "/usr/bin/true" });
    writeFileSync(join(dirname(file), "config.json"), JSON.stringify({ auto_arm: false }), "utf-8");
    const out = capture("stdout");
    await main(["event", "--file", file, "--event", "apply_done"]);
    out.restore();
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(false);
  });
});

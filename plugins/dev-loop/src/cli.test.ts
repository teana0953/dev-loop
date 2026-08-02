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
    // `status` 還沒移植(見 TS_COMMANDS 的註解:等 watcher 進 TS 才會完整
    // 移植),所以它是這條「不屬於我就轉給 Python」的樣本。先前用的是
    // `event`、再來是 `gate`,兩者都已陸續進 TS_COMMANDS。
    const rc = await main(["status", "--file", "x"], {
      delegate: (argv) => { seen.push(argv); return 7; },
    });
    expect(rc).toBe(7);
    expect(seen).toEqual([["status", "--file", "x"]]);
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

/**
 * gate 命令。
 *
 * 每條的預期值都抄自 Python 的實測輸出(`python3 -m devloop.cli gate ...`,
 * 每次都用一個全新的暫存目錄——gate 會改 checkpoint,重用目錄量到的全是假的),
 * 不是從 TS 實作反推的。
 */
describe("gate", () => {
  function fixture(fields: Record<string, unknown> = {}, config?: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-gate-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "gate", change_id: "c1", branch: "b", ...fields }), file);
    if (config) {
      writeFileSync(join(dir, "config.json"), JSON.stringify(config), "utf-8");
    }
    return file;
  }

  function capture(stream: "stdout" | "stderr"): { text: () => string; restore: () => void } {
    const s = vi.spyOn(process[stream], "write").mockImplementation(() => true);
    return {
      text: () => s.mock.calls.map(([msg]) => String(msg)).join(""),
      restore: () => s.mockRestore(),
    };
  }

  it("passes, advances the phase, and exits 0", async () => {
    // PY(實測):stdout "gate PASSED -> phase=qa iteration=1\n", exit 0
    const file = fixture();
    const out = capture("stdout");
    const rc = await main(["gate", "--file", file, "--cmd", "/usr/bin/true"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("gate PASSED -> phase=qa iteration=1\n");
    expect(loadCheckpoint(file).phase).toBe("qa");
  });

  it("fails, bumps gate_failures, moves to fix, and exits 1", async () => {
    // PY(實測)stdout 三行,中間那行是空的(result.output 是 ""):
    //   gate FAILED: ['/usr/bin/false']
    //   <空行>
    //   phase=fix iteration=0
    const file = fixture();
    const out = capture("stdout");
    const rc = await main(["gate", "--file", file, "--cmd", "/usr/bin/false"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=fix iteration=0\n");
    const cp = loadCheckpoint(file);
    expect(cp.gate_failures).toBe(1);
    expect(cp.phase).toBe("fix");
  });

  /**
   * `expect(p).rejects` 在 vitest 對 ReferenceError 也算通過,所以自己把錯誤
   * 抓出來並排除 ReferenceError。(與 parseArgs 那組的同名 helper 相同。)
   */
  async function expectRejects(p: Promise<unknown>, label: string): Promise<unknown> {
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught, `${label}: 必須拋錯`).toBeInstanceOf(Error);
    expect(caught, `${label}: 拋的是 ReferenceError —— 測試自己壞了`)
      .not.toBeInstanceOf(ReferenceError);
    return caught;
  }

  /**
   * 升級的邊界是 `cp.gate_failures > maxGate`(gate_failures 已先 +1),不是 `>=`。
   *
   * 把它寫成 `>=` 會讓 TS 比 Python 早一輪升級 —— 同一個 checkpoint,一邊還在
   * 「再修一輪」、一邊已經「放棄等人接手」。這正是本里程碑最怕的雙引擎狀態分岔。
   *
   * 下面的 grid 是實測出來的:對兩個引擎各跑一份全新目錄,gate_failures ∈
   * {0,1,2} × --max-gate ∈ {-1,0,1,2},每格兩邊完全相同。只有兩格能區分
   * `>` 與 `>=`(也就是 gate_failures+1 === maxGate 的那條對角線),兩格都在
   * 下面被釘住 —— 原本的 escalation 測試用的是 (1, 1),那格 2>1 與 2>=1 都真,
   * 對這個變異完全無感。
   *
   *   gf  maxg | PY 與 TS(exit, phase, 存回的 gate_failures)
   *    0    -1 | 3, escalated, 1
   *    0     0 | 3, escalated, 1
   *    0     1 | 1, fix,       1   <- 區分 > 與 >=
   *    0     2 | 1, fix,       1
   *    1    -1 | 3, escalated, 2
   *    1     0 | 3, escalated, 2
   *    1     1 | 3, escalated, 2   <- 原本唯一的 escalation 測試在這裡
   *    1     2 | 1, fix,       2   <- 區分 > 與 >=
   *    2   任一 | 3, escalated, 3
   */
  it("stays in fix on the failure that exactly SPENDS the budget (not >=)", async () => {
    // PY(實測 gf=0 --max-gate 1):exit 1、"phase=fix iteration=0"、gate_failures=1。
    // `>=` 會在這裡就升級成 exit 3 / escalated。
    const file = fixture({ gate_failures: 0 });
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", "1",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=fix iteration=0\n");
    const cp = loadCheckpoint(file);
    expect(cp.phase).toBe("fix");
    expect(cp.gate_failures).toBe(1);
  });

  it("stays in fix at the other boundary point too (gate_failures 1, --max-gate 2)", async () => {
    // 第二條區分格。兩格都留著:只留一條的話,把邊界從 > 改成 >= 之外的其他
    // 偏移(例如整個 +1)仍可能剛好躲過。
    // PY(實測):exit 1、"phase=fix iteration=0"、gate_failures=2。
    const file = fixture({ gate_failures: 1 });
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", "2",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=fix iteration=0\n");
    expect(loadCheckpoint(file).gate_failures).toBe(2);
  });

  it("escalates on the very first failure when --max-gate is 0 or negative", async () => {
    // argparse 的 type=int 沒有下界,0 與負數都是合法輸入(--max-gate -1 走
    // negative-number matcher,是值不是旗標)。PY(實測)兩者都是 exit 3 /
    // escalated / gate_failures=1。
    for (const maxGate of ["0", "-1"]) {
      const file = fixture({ gate_failures: 0 });
      const out = capture("stdout");
      const rc = await main([
        "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", maxGate,
      ]);
      const printed = out.text();
      out.restore();
      expect(rc, `--max-gate ${maxGate}`).toBe(3);
      expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=escalated iteration=0\n");
      expect(loadCheckpoint(file).gate_failures).toBe(1);
    }
  });

  it("exits 3 — not 1 — once the failure budget is spent", async () => {
    // escalated 與一般 fail 必須可區分:3 專屬升級。混在一起的話編排端
    // 會把「已經放棄、要人接手」誤當成「再修一輪」。
    // PY(實測):"gate FAILED: ['/usr/bin/false']\n\nphase=escalated iteration=0\n", exit 3
    const file = fixture({ gate_failures: 1 });
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", "1",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(3);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=escalated iteration=0\n");
    expect(loadCheckpoint(file).phase).toBe("escalated");
  });

  it("falls back to config.json gate_cmds when --cmd is absent", async () => {
    // PY(實測):"gate PASSED -> phase=qa iteration=1\n", exit 0
    const file = fixture({}, { gate_cmds: ["/usr/bin/true"] });
    const out = capture("stdout");
    const rc = await main(["gate", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("gate PASSED -> phase=qa iteration=1\n");
  });

  it("refuses to run with no gate commands at all, instead of passing vacuously", async () => {
    // 空清單進 runGate 恆 pass:那是假綠,比失敗更糟。
    // PY(實測)stderr:
    //   error: no gate commands: pass --cmd or set gate_cmds in .devloop/config.json
    // exit 2,checkpoint 完全沒動。
    const file = fixture({}, { gate_cmds: [] });
    const err = capture("stderr");
    const rc = await main(["gate", "--file", file]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe(
      "error: no gate commands: pass --cmd or set gate_cmds in .devloop/config.json\n");
    expect(loadCheckpoint(file).phase).toBe("gate");
    expect(loadCheckpoint(file).gate_failures).toBe(0);
  });

  it("also refuses when neither --cmd nor a config.json exists at all", async () => {
    // PY(實測,brief step 1 第三條):同一則訊息、exit 2。
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["gate", "--file", file]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe(
      "error: no gate commands: pass --cmd or set gate_cmds in .devloop/config.json\n");
  });

  /**
   * Python 的 `except ValueError` 只接 ValueError。JSONDecodeError 是它的子類
   * (壞掉的 config.json -> exit 2);IsADirectoryError / PermissionError 是
   * OSError,**不**被接住(-> 未捕捉例外,exit 1)。
   *
   * TS 這側用 `isOsError`(Node 的 ErrnoException 帶 `code`)把兩類分開。少了
   * 那個 rethrow,一個讀不到的 config 會從「炸掉、要人處理」悄悄變成「exit 2、
   * 像是使用者忘了給 --cmd」——而 Python 仍然是 exit 1。
   *
   * 兩邊實測(各自全新目錄):
   *   config.json 是目錄   PY exit 1 IsADirectoryError | TS exit 1 EISDIR
   *   config.json chmod 000 PY exit 1 PermissionError   | TS exit 1 EACCES
   *   config.json 是壞 JSON PY exit 2 "error: Expecting value: line 1 column 1"
   *                         TS exit 2(訊息文字不同,是既有的認可分歧)
   */
  it("rethrows an unreadable config instead of reporting it as a missing --cmd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-gate-eisdir-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(makeCheckpoint({ phase: "gate", change_id: "c1", branch: "b" }), file);
    // 目錄而不是 chmod 000:root 底下 chmod 000 照樣讀得到,這條會假綠。
    mkdirSync(join(dir, "config.json"));
    const exc = await expectRejects(
      main(["gate", "--file", file]), "gate with a config.json that is a directory");
    expect((exc as NodeJS.ErrnoException).code).toBe("EISDIR");
    // 炸掉表示什麼都沒推進
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("still reports a CORRUPT config as exit 2, the way Python's ValueError branch does", async () => {
    // rethrow 的另一半:JSON 解析錯誤沒有 `code`,必須留在 exit 2,不能被
    // 「凡是例外都往外丟」一起帶走。
    const dir = mkdtempSync(join(tmpdir(), "cli-gate-badjson-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(makeCheckpoint({ phase: "gate", change_id: "c1", branch: "b" }), file);
    writeFileSync(join(dir, "config.json"), "not json", "utf-8");
    const err = capture("stderr");
    const rc = await main(["gate", "--file", file]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toMatch(/^error: /);
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("splits each configured command with shlex, not on spaces", async () => {
    // `/bin/sh -c 'exit 0'` 用空白切會變成 ["/bin/sh","-c","'exit","0'"],
    // sh 會拿 "'exit" 當程式碼 -> 非 0 -> 這條會變成 exit 1。
    // PY(實測):"gate PASSED -> phase=qa iteration=1\n", exit 0
    const file = fixture({}, { gate_cmds: ["/bin/sh -c 'exit 0'"] });
    const out = capture("stdout");
    const rc = await main(["gate", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("gate PASSED -> phase=qa iteration=1\n");
  });

  it("runs EVERY --cmd, not just the last one (argparse action=append)", async () => {
    // `--cmd a --cmd b` 只跑 b 是靜默少跑一條 gate,沒有任何錯誤訊號。
    // PY(實測):第一條就失敗並短路 -> "gate FAILED: ['/usr/bin/false']"
    const file = fixture();
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--cmd", "/usr/bin/true",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=fix iteration=0\n");
  });

  it("keeps appending across the --cmd=value and abbreviation forms", async () => {
    // 實測 argparse:`--c a --c=b` -> cmd == ['a','b'](縮寫與 = 形式都照樣 append)。
    // 若 repeated 只收「長名 + 空白」那一種寫法,這裡會退化成只跑 /usr/bin/true。
    const file = fixture();
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--c", "/usr/bin/true", "--cmd=/usr/bin/false",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe("gate FAILED: ['/usr/bin/false']\n\nphase=fix iteration=0\n");
  });

  it("prints failed_command as a Python list repr, not JSON", async () => {
    // Python 的 `print("%s" % list)` 走 repr:單引號、逗號後有空白。
    // 實測:`--cmd '/bin/sh -c "exit 1"'` -> gate FAILED: ['/bin/sh', '-c', 'exit 1']
    // JSON.stringify 會給 ["/bin/sh","-c","exit 1"] —— 三處都不一樣。
    const file = fixture();
    const out = capture("stdout");
    const rc = await main(["gate", "--file", file, "--cmd", '/bin/sh -c "exit 1"']);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed.split("\n")[0]).toBe("gate FAILED: ['/bin/sh', '-c', 'exit 1']");
  });

  it("switches the repr's quote style when the string contains a single quote", async () => {
    // Python 的 repr 對含單引號的字串改用雙引號外框且**不**轉義那個單引號;
    // 兩種引號都有時才回到單引號外框並把 ' 轉義成 \';反斜線一律轉義。
    // 這三條規則寫錯的話,只有在 gate 失敗當下才會被看到 —— 也就是最需要
    // 這段輸出可讀的時候。`/bin/sh -c "exit 1" ...` 的額外參數會落到 $0/$1,
    // sh 照樣 exit 1,所以它們會原樣進 failed_command。
    //
    // PY 實測(cmd 字串與下面完全相同):
    //   shlex.split -> ['/bin/sh', '-c', 'exit 1', "it's", 'a\'b"c', 'back\\slash']
    //   stdout 首行 -> gate FAILED: ['/bin/sh', '-c', 'exit 1', "it's", 'a\'b"c', 'back\\slash']
    const file = fixture();
    const out = capture("stdout");
    const rc = await main([
      "gate", "--file", file, "--cmd",
      "/bin/sh -c \"exit 1\" \"it's\" 'a'\"'\"'b\"c' 'back\\slash' ",
    ]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed.split("\n")[0]).toBe(
      "gate FAILED: ['/bin/sh', '-c', 'exit 1', \"it's\", 'a\\'b\"c', 'back\\\\slash']");
  });

  it("rejects a non-integer --max-gate/--timeout the way argparse does", async () => {
    // PY(實測):devloop gate: error: argument --max-gate: invalid int value: 'abc',exit 2
    const file = fixture();
    const err = capture("stderr");
    const rc = await main([
      "gate", "--file", file, "--cmd", "/usr/bin/false", "--max-gate", "abc",
    ]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: argument --max-gate: invalid int value: 'abc'\n");
    // 拒絕的命令一步都不能推進
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("reports --ma as ambiguous, because gate has both --max and --max-gate", async () => {
    // 實測 argparse(gate 的旗標集):ambiguous option: --ma could match --max, --max-gate
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["gate", "--file", file, "--cmd", "/usr/bin/true", "--ma", "1"]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: ambiguous option: --ma could match --max, --max-gate\n");
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("requires --file", async () => {
    const err = capture("stderr");
    const rc = await main(["gate", "--cmd", "/usr/bin/true"]);
    err.restore();
    expect(rc).toBe(2);
  });
});

/**
 * parseArgs / rawFlag 的 argparse 相容性(fix round 1)。
 *
 * 這一組全部針對共用的旗標解析,不是針對某一支命令——`event` 之後每一支變更型
 * 命令都走同一份程式碼,所以「一邊推進 loop、一邊拒絕」的分歧在這裡修一次就好。
 * 每條的預期值都取自實測(argparse 直接跑,或 `python3 -m devloop.cli`)。
 */
describe("parseArgs: argparse compatibility", () => {
  function cpFile(fields: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-args-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }),
      file,
    );
    return file;
  }

  function spy(stream: "stdout" | "stderr"): { text: () => string; restore: () => void } {
    const s = vi.spyOn(process[stream], "write").mockImplementation(() => true);
    return {
      text: () => s.mock.calls.map(([msg]) => String(msg)).join(""),
      restore: () => s.mockRestore(),
    };
  }

  /**
   * `expect(p).rejects` 在 vitest 對 ReferenceError 也算通過,所以這裡自己把
   * 錯誤抓出來、明確排除 ReferenceError——否則打錯一個名字的測試會「通過」而
   * 什麼都沒驗到。(watcher.test.ts 的同名 helper 是同步版。)
   */
  async function expectRejects(p: Promise<unknown>, label: string): Promise<unknown> {
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught, `${label}: 必須拋錯`).toBeInstanceOf(Error);
    expect(caught, `${label}: 拋的是 ReferenceError —— 測試自己壞了`)
      .not.toBeInstanceOf(ReferenceError);
    return caught;
  }

  // ---- F1: --flag=value -------------------------------------------------
  it("accepts --flag=value the way argparse does (F1)", async () => {
    // PY: `event --file <cp> --event=apply_done` -> exit 0, "phase=gate iteration=0"
    // TS(修前): exit 2 "error: unrecognized arguments: --event=apply_done"
    const file = cpFile();
    const out = spy("stdout");
    const rc = await main(["event", `--file=${file}`, "--event=apply_done"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=gate iteration=0\n");
    expect(loadCheckpoint(file).phase).toBe("gate");
  });

  it("treats --flag= as an explicit empty value, not a missing one", async () => {
    // 實測 argparse:`--event=` 存下 ""、`--max=` 走 "invalid int value: ''"
    // ——都不是 "expected one argument"。
    const file = cpFile();
    const err = spy("stderr");
    // --event="" 是合法的空事件字串,狀態機沒有這個轉移 -> InvalidTransition
    const rcEvent = await main(["event", "--file", file, "--event="]);
    const msg = err.text();
    err.restore();
    expect(rcEvent).toBe(2);
    expect(msg).toBe("error: no transition from 'apply' on ''\n");

    const err2 = spy("stderr");
    const rcMax = await main(["event", "--file", file, "--event", "apply_done", "--max="]);
    const msg2 = err2.text();
    err2.restore();
    expect(rcMax).toBe(2);
    expect(msg2).toBe("error: argument --max: invalid int value: ''\n");
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("lets --flag=value carry a value that itself starts with --", async () => {
    // 實測 argparse:`--event=--foo` 存下 "--foo"(而 `--event --foo` 是錯誤)。
    const file = cpFile();
    const err = spy("stderr");
    const rc = await main(["event", "--file", file, "--event=--foo"]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: no transition from 'apply' on '--foo'\n");
  });

  it("lets the last --flag=value win, matching argparse's store action", async () => {
    // 實測 argparse:`--event=a --event=b` -> event == "b"
    const file = cpFile({ phase: "qa" });
    const out = spy("stdout");
    const rc = await main(["event", "--file", file, "--event=qa_fail", "--event=qa_pass"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=review iteration=0\n");
  });

  it("accepts --flag=value for the other TS commands too", async () => {
    const file = cpFile({ units: [{ id: "g1", status: "pending" }] });
    const out = spy("stdout");
    const rc = await main([`units-status`, `--file=${file}`]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("g1 pending\npending: g1\n");

    const dir = mkdtempSync(join(tmpdir(), "cli-args-cfg-"));
    const cfg = join(dir, "config.json");
    writeFileSync(cfg, JSON.stringify({ models: { apply: "haiku" } }), "utf-8");
    const out2 = spy("stdout");
    const rc2 = await main(["model", "--stage=apply", `--config=${cfg}`]);
    const printed2 = out2.text();
    out2.restore();
    expect(rc2).toBe(0);
    expect(printed2).toBe("haiku\n");
  });

  // ---- F2: a known flag with no value -----------------------------------
  it("rejects a known flag left without a value instead of swallowing it (F2)", async () => {
    // PY: `event --file <cp> --event apply_done --max`
    //     -> exit 2 "argument --max: expected one argument", 什麼都沒寫
    // TS(修前): exit 0, checkpoint 被推進到 phase=gate
    const file = cpFile();
    const err = spy("stderr");
    const rc = await main(["event", "--file", file, "--event", "apply_done", "--max"]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: argument --max: expected one argument\n");
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("rejects a known flag whose next token looks like another flag", async () => {
    // 實測 argparse:`--event --foo` / `--max --file` 都是 "expected one argument";
    // `--event --` 也是(`--` 也算「看起來像旗標」)。
    const file = cpFile();
    const err = spy("stderr");
    expect(await main(["event", "--file", file, "--event", "--foo"])).toBe(2);
    expect(await main(["event", "--file", file, "--event", "e", "--max", "--file"])).toBe(2);
    expect(await main(["event", "--file", file, "--event", "--"])).toBe(2);
    expect(err.text()).toBe(
      "error: argument --event: expected one argument\n"
      + "error: argument --max: expected one argument\n"
      + "error: argument --event: expected one argument\n",
    );
    err.restore();
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("still accepts values that only look flag-ish: '-', negative numbers, spaces", async () => {
    // 實測 argparse 把這三種都當值,不當旗標。
    const file = cpFile();
    const err = spy("stderr");
    // 值有被真的收下 -> 走到狀態機才失敗,而不是 "expected one argument"
    expect(await main(["event", "--file", file, "--event", "-"])).toBe(2);
    expect(await main(["event", "--file", file, "--event", "-1"])).toBe(2);
    expect(await main(["event", "--file", file, "--event", "-x y"])).toBe(2);
    expect(err.text()).toBe(
      "error: no transition from 'apply' on '-'\n"
      + "error: no transition from 'apply' on '-1'\n"
      + "error: no transition from 'apply' on '-x y'\n",
    );
    err.restore();
  });

  it("accepts a negative --max, which argparse also treats as a value", async () => {
    // 實測:`--max -1` -> max == -1(negative-number matcher),不是缺值。
    const file = cpFile({ phase: "gate" });
    const out = spy("stdout");
    const rc = await main(["event", "--file", file, "--event", "gate_pass", "--max", "-1"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=escalated iteration=1\n");
  });

  // ---- F3: --file "" ----------------------------------------------------
  it('treats --file "" as a literal path, not as an absent flag (F3)', async () => {
    // PY(實測)archive / units-status / event 都是 exit 1(Path("") -> "." ->
    // IsADirectoryError,未捕捉)。TS(修前)是 exit 2 "<cmd> requires --file"。
    // TS(修後)loadCheckpoint("") 拋 ENOENT,一樣不被 main 接住 -> 行程 exit 1。
    await expectRejects(main(["units-status", "--file", ""]), 'units-status --file ""');
    await expectRejects(main(["event", "--file", "", "--event", "apply_done"]),
      'event --file ""');
    await expectRejects(main(["archive", "--file", ""]), 'archive --file ""');
    // gate 也走同一條規則(它用的是 rawFlag,不是已被刪掉的 requiredFlag)。
    // PY(實測)`gate --file "" --cmd /usr/bin/true`:IsADirectoryError: '.',exit 1。
    await expectRejects(main(["gate", "--file", "", "--cmd", "/usr/bin/true"]),
      'gate --file ""');
  });

  it('keeps model --stage "" at exit 2, the way argparse\'s choices do', async () => {
    // PY(實測):devloop model: error: argument --stage: invalid choice: ''
    // TS:resolveModel 對非法 stage 拋錯,cmdModel 接住回 2。訊息文字不同
    // (既有的已認可分歧),exit code 相同。
    const err = spy("stderr");
    const rc = await main(["model", "--stage", ""]);
    err.restore();
    expect(rc).toBe(2);
  });

  it("surfaces the parse error from EVERY dispatch branch, not just event", async () => {
    // parseArgs 的 error 檢查在四支命令裡各寫了一次;只測 event 的話,漏掉
    // 其中一支的分支會靜默通過(實測:拿掉 archive 那一支,整個 suite 仍全綠)。
    // PY 對這四條一律 exit 2 "argument --X: expected one argument"。
    const err = spy("stderr");
    expect(await main(["archive", "--file"]), "archive").toBe(2);
    expect(await main(["units-status", "--file"]), "units-status").toBe(2);
    expect(await main(["model", "--stage"]), "model").toBe(2);
    expect(await main(["event", "--file"]), "event").toBe(2);
    const msg = err.text();
    err.restore();
    expect(msg).toBe(
      "error: argument --file: expected one argument\n"
      + "error: argument --file: expected one argument\n"
      + "error: argument --stage: expected one argument\n"
      + "error: argument --file: expected one argument\n",
    );
  });

  it("still reports a genuinely absent required flag as exit 2", async () => {
    const err = spy("stderr");
    expect(await main(["units-status"])).toBe(2);
    expect(await main(["archive"])).toBe(2);
    expect(await main(["model"])).toBe(2);
    err.restore();
  });

  // ---- F4: argparse long-option abbreviation ----------------------------
  it("accepts an unambiguous long-option abbreviation, as argparse does", async () => {
    // 實測 argparse:--fil -> --file、--even -> --event、--ma -> --max
    const file = cpFile();
    const out = spy("stdout");
    const rc = await main(["event", "--fil", file, "--even", "apply_done"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe("phase=gate iteration=0\n");
  });

  it("rejects an ambiguous abbreviation with argparse's wording", async () => {
    // 實測:devloop event: error: ambiguous option: --fi could match --file, --finish-mode
    const file = cpFile();
    const err = spy("stderr");
    const rc = await main(["event", "--fi", file, "--event", "apply_done"]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: ambiguous option: --fi could match --file, --finish-mode\n");
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("still rejects an abbreviation that matches nothing", async () => {
    const file = cpFile();
    const err = spy("stderr");
    const rc = await main(["event", "--file", file, "--event", "apply_done", "--zz", "1"]);
    err.restore();
    expect(rc).toBe(2);
    expect(loadCheckpoint(file).phase).toBe("apply");
  });

  it("leaves a bare -- in the unrecognized bucket rather than treating it as ambiguous", async () => {
    // "--" 是每一個長選項的前綴;若讓它參與縮寫比對就會變成 ambiguous。
    // 實測 PY:`event --file cp --event e --` -> exit 2 "unrecognized arguments: --"
    const file = cpFile();
    const err = spy("stderr");
    const rc = await main(["event", "--file", file, "--event", "apply_done", "--"]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe("error: unrecognized arguments: --\n");
    expect(loadCheckpoint(file).phase).toBe("apply");
  });
});

/**
 * watcher 生命週期三支命令(watch / arm-local / watcher-status)。
 *
 * 每條的預期值都抄自 Python 的實測輸出(`python3 -m devloop.cli ...`,每個
 * 引擎各自一個全新的暫存目錄——arm-local 會寫 watcher.pid、watch 會寫 log,
 * 共用目錄量到的全是假的),不是從 TS 實作反推的。
 *
 * 這是第一組會真的 spawn detached 背景行程的測試:凡是不需要 watcher 活著的
 * 地方一律用 `/usr/bin/true`(跑完立刻結束),只有「already running」那條需要
 * 一個活的行程,用短命的 sleep 並在測試裡殺掉。
 */
describe("watch", () => {
  it("runs the exec command once when it succeeds and appends one log line", async () => {
    // PY(實測):stdout 空、exit 0,watcher-log.jsonl 一行
    // {"ts": ..., "exit_code": 0, "output_tail": "", "action": "stop", "heartbeat": 1}
    const dir = mkdtempSync(join(tmpdir(), "cli-watch-"));
    const log = join(dir, "w.jsonl");
    expect(await main([
      "watch", "--exec", "/usr/bin/true", "--heartbeat", "1", "--log", log,
    ])).toBe(0);
    const lines = readFileSync(log, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.action).toBe("stop");
    expect(entry.exit_code).toBe(0);
    expect(entry.heartbeat).toBe(1);
  });

  it("splits --exec with shlex, so a quoted argument stays one argv element", async () => {
    // resume_exec 的典型值是 `claude -p '/dev-loop resume'`——切錯的話 watcher
    // 每次重試都跑一個錯的命令,而且只有 watcher-log.jsonl 看得到。
    //
    // 執行檔本身也加引號是刻意的:切錯時 head 會是帶引號的 `'/bin/sh'`,兩個
    // 引擎都當場 FileNotFoundError/ENOENT 而死(實測 PY run_watcher 對
    // `"'/bin/sh' -c ...".split(" ")` -> RAISED FileNotFoundError "'/bin/sh'")。
    // 若只給 `/bin/sh -c '...'`,切錯的版本會變成一個**永遠失敗、每秒重試的
    // 無窮迴圈**——測試不是紅,是掛住,而且留下背景行程。實測過:那個變異體
    // 讓 crossEngine 的同款 case 跑了 10 分鐘沒結束。
    const dir = mkdtempSync(join(tmpdir(), "cli-watch-"));
    const marker = join(dir, "marker");
    expect(await main([
      "watch", "--exec", `'/bin/sh' -c 'printf x > ${marker}'`, "--heartbeat", "1",
    ])).toBe(0);
    expect(readFileSync(marker, "utf-8")).toBe("x");
  });

  it("requires --exec (it is optional only for arm-local)", async () => {
    // PY(實測):"devloop watch: error: the following arguments are required: --exec", exit 2
    const s = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rc = await main(["watch", "--heartbeat", "1"]);
    s.mockRestore();
    expect(rc).toBe(2);
  });
});

describe("arm-local", () => {
  function fixture(fields: Record<string, unknown> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-arm-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }), file);
    return file;
  }

  function capture(stream: "stdout" | "stderr"): { text: () => string; restore: () => void } {
    const s = vi.spyOn(process[stream], "write").mockImplementation(() => true);
    return {
      text: () => s.mock.calls.map(([msg]) => String(msg)).join(""),
      restore: () => s.mockRestore(),
    };
  }

  /** 收尾:把剛 spawn 的 watcher 殺掉,測試不留孤兒行程。 */
  function killWatcher(file: string): void {
    const pidPath = join(dirname(file), "watcher.pid");
    if (!existsSync(pidPath)) {
      return;
    }
    try {
      process.kill(Number(readFileSync(pidPath, "utf-8").trim()), "SIGKILL");
    } catch {
      // 已經自己結束了
    }
  }

  it("arms, then reports already on the second call", async () => {
    // PY(實測,resume_exec="/bin/sh -c 'sleep 5'"):
    //   第一次 "watcher armed (pid=91018)" exit 0
    //   第二次 "watcher already running (pid=91018)" exit 0
    //   watcher-status  "watcher: running (pid=91018)" exit 0
    // sleep 讓 watcher 活著足以量到 "already";測試結束前殺掉。
    const file = fixture({ resume_exec: "/bin/sh -c 'sleep 5'" });
    try {
      const out = capture("stdout");
      const rc = await main(["arm-local", "--file", file, "--heartbeat", "1"]);
      const first = out.text();
      out.restore();
      expect(rc).toBe(0);
      expect(first).toMatch(/^watcher armed \(pid=\d+\)\n$/);
      expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(true);

      const out2 = capture("stdout");
      const rc2 = await main(["arm-local", "--file", file, "--heartbeat", "1"]);
      const second = out2.text();
      out2.restore();
      expect(rc2).toBe(0);
      expect(second).toBe(first.replace("watcher armed", "watcher already running"));

      // 同一個活著的 watcher 也把 watcher-status 的 "running" 分支釘住:
      // 需要 watcher 而它在位 -> exit 0、沒有 hint。
      const out3 = capture("stdout");
      const rc3 = await main(["watcher-status", "--file", file]);
      const status = out3.text();
      out3.restore();
      expect(rc3).toBe(0);
      expect(status).toMatch(/^watcher: running \(pid=\d+\)\n/);
      expect(status).not.toContain("hint:");
    } finally {
      killWatcher(file);
    }
  });

  it("exits 2 when there is no resume command anywhere", async () => {
    // PY(實測):stderr "error: no resume command (checkpoint.resume_exec empty
    // and no --exec)", exit 2,不寫 watcher.pid
    const file = fixture();
    const err = capture("stderr");
    const rc = await main(["arm-local", "--file", file]);
    const msg = err.text();
    err.restore();
    expect(rc).toBe(2);
    expect(msg).toBe(
      "error: no resume command (checkpoint.resume_exec empty and no --exec)\n");
    expect(existsSync(join(dirname(file), "watcher.pid"))).toBe(false);
  });

  it("accepts --exec as an override when the checkpoint has no resume command", async () => {
    // PY(實測):"watcher armed (pid=94125)" exit 0 —— --exec 對 arm-local 是
    // optional 而不是 required,這條擋住把兩支命令的 required 寫反。
    const file = fixture();
    const out = capture("stdout");
    const rc = await main([
      "arm-local", "--file", file, "--exec", "/usr/bin/true", "--heartbeat", "1"]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toMatch(/^watcher armed \(pid=\d+\)\n$/);
    killWatcher(file);
  });
});

describe("watcher-status", () => {
  function fixture(
    fields: Record<string, unknown> = {},
    extras: { pid?: number; log?: string } = {},
  ): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-wstatus-"));
    const file = join(dir, "cp.json");
    saveCheckpoint(
      makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }), file);
    if (extras.pid !== undefined) {
      writeFileSync(join(dir, "watcher.pid"), String(extras.pid), "utf-8");
    }
    if (extras.log !== undefined) {
      writeFileSync(join(dir, "watcher-log.jsonl"), extras.log, "utf-8");
    }
    return file;
  }

  function capture(stream: "stdout" | "stderr"): { text: () => string; restore: () => void } {
    const s = vi.spyOn(process[stream], "write").mockImplementation(() => true);
    return {
      text: () => s.mock.calls.map(([msg]) => String(msg)).join(""),
      restore: () => s.mockRestore(),
    };
  }

  /**
   * `expect(p).rejects` 在 vitest 對 ReferenceError 也算通過(整支測試檔沒有
   * 型別檢查),所以自己把錯誤抓出來並排除 ReferenceError。
   */
  async function expectRejects(p: Promise<unknown>, label: string): Promise<unknown> {
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught, `${label}: 必須拋錯`).toBeInstanceOf(Error);
    expect(caught, `${label}: 拋的是 ReferenceError —— 測試自己壞了`)
      .not.toBeInstanceOf(ReferenceError);
    return caught;
  }

  it("reports not armed and exits 1 when a watcher is needed but missing", async () => {
    // PY(實測)stdout 四行、exit 1:
    //   watcher: not armed / resume_exec: /usr/bin/true / last attempt: (none)
    //   hint: devloop arm-local --file <cp>
    const file = fixture({ resume_exec: "/usr/bin/true" });
    const out = capture("stdout");
    const rc = await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toBe(
      "watcher: not armed\nresume_exec: /usr/bin/true\nlast attempt: (none)\n"
      + `hint: devloop arm-local --file ${file}\n`);
  });

  it("exits 0 in the done phase even with no watcher", async () => {
    // PY(實測):同樣三行、**沒有** hint、exit 0。
    const file = fixture({ phase: "done", resume_exec: "/usr/bin/true" });
    const out = capture("stdout");
    const rc = await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toBe(
      "watcher: not armed\nresume_exec: /usr/bin/true\nlast attempt: (none)\n");
  });

  it("exits 0 with no resume command, because no watcher is needed", async () => {
    // PY(實測):"resume_exec: (none)" exit 0。
    const file = fixture();
    const out = capture("stdout");
    const rc = await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toContain("resume_exec: (none)\n");
    expect(printed).not.toContain("hint:");
  });

  it("treats an empty-container resume_exec as absent, like Python's bool()", async () => {
    // 實測 checkpoint {"resume_exec": []}:
    //   PY  -> "resume_exec: (none)", exit 0
    //   TS(用 `||`/`Boolean`) -> "resume_exec: ", exit 1 + hint
    // 而 [0] 兩邊都 truthy,PY 的 `%s` 印 "[0]"、`String([0])` 印 "0"。
    const empty = fixture({ resume_exec: [] as unknown as string });
    const out = capture("stdout");
    const rc = await main(["watcher-status", "--file", empty]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(0);
    expect(printed).toContain("resume_exec: (none)\n");

    const nonEmpty = fixture({ resume_exec: [0] as unknown as string });
    const out2 = capture("stdout");
    const rc2 = await main(["watcher-status", "--file", nonEmpty]);
    const printed2 = out2.text();
    out2.restore();
    expect(rc2).toBe(1);
    expect(printed2).toContain("resume_exec: [0]\n");
  });

  it("reports a stale pid as dead", async () => {
    // 一個已經被 reap 的 pid:spawn 一個立刻結束的行程並等它收屍,那個 pid
    // 於是保證不存在(隨手挑一個大數字可能剛好撞到別人的行程)。
    // PY(實測):"watcher: dead (stale pid=90703)" + hint, exit 1
    const reaped = spawnSync("/usr/bin/true", [], { encoding: "utf-8" });
    const dead = reaped.pid as number;
    const file = fixture({ resume_exec: "/usr/bin/true" }, { pid: dead });
    const out = capture("stdout");
    const rc = await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(rc).toBe(1);
    expect(printed).toContain(`watcher: dead (stale pid=${dead})`);
  });

  it("prints the last attempt and its output tail", async () => {
    // PY(實測):
    //   last attempt: 2026-08-02T00:00:00Z exit=1 retry
    //   output tail: boom
    const file = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({
        ts: "2026-08-02T00:00:00Z", exit_code: 1, output_tail: "boom",
        action: "retry", heartbeat: 1,
      }) + "\n",
    });
    const out = capture("stdout");
    await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(printed).toContain("last attempt: 2026-08-02T00:00:00Z exit=1 retry\n");
    expect(printed).toContain("output tail: boom\n");
  });

  it("rstrips the attempt line with Python's whitespace set, not JavaScript's", async () => {
    // 實測(log 最後一行的 action 帶尾綴):
    //   action "stop\x1c" -> PY 'last attempt: T exit=0 stop'(\x1c 被 rstrip 掉)
    //   action "stop﻿" -> PY 'last attempt: T exit=0 stop﻿'(BOM 留著)
    // JS 的 /\s+$/ 兩條都給相反的答案。
    const sep = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({ ts: "T", exit_code: 0, action: "stop\x1c" }) + "\n",
    });
    const out = capture("stdout");
    await main(["watcher-status", "--file", sep]);
    const printed = out.text();
    out.restore();
    expect(printed).toContain("last attempt: T exit=0 stop\n");

    const bom = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({ ts: "T", exit_code: 0, action: "stop﻿" }) + "\n",
    });
    const out2 = capture("stdout");
    await main(["watcher-status", "--file", bom]);
    const printed2 = out2.text();
    out2.restore();
    expect(printed2).toContain("last attempt: T exit=0 stop﻿\n");
  });

  it("formats the attempt fields with Python's %s, not String()", async () => {
    // 實測 {"ts": null, "exit_code": true, "action": null}:
    //   PY -> 'last attempt: None exit=True None'
    //   String() -> 'last attempt: null exit=true null'
    const file = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({ ts: null, exit_code: true, action: null }) + "\n",
    });
    const out = capture("stdout");
    await main(["watcher-status", "--file", file]);
    const printed = out.text();
    out.restore();
    expect(printed).toContain("last attempt: None exit=True None\n");
  });

  it("propagates instead of printing '?' when a log line is a bare scalar", async () => {
    // Python 的 last.get(...) 對一個 int 會 AttributeError:排障工具在這裡
    // 大聲失敗(實測 exit 1,且 "watcher:"/"resume_exec:" 兩行已經印出去)。
    // TS 若用 `obj.ts` 只會拿到 undefined 然後印 "?",變成兩個引擎對同一個
    // 壞掉的 log 給出不同結論。
    const file = fixture({ resume_exec: "/usr/bin/true" }, { log: "42\n" });
    const out = capture("stdout");
    const exc = await expectRejects(
      main(["watcher-status", "--file", file]), "bare scalar log line");
    const printed = out.text();
    out.restore();
    expect((exc as Error).message).toContain("has no attribute 'get'");
    expect(printed).toContain("resume_exec: /usr/bin/true\n");
    expect(printed).not.toContain("last attempt:");
  });

  it("propagates for a JSON array log line, which typeof calls an object", async () => {
    // `42` 只考到 pyDictGet 的 `typeof !== "object"` 那一半;陣列是唯一能把
    // `Array.isArray` 那一半考出來的輸入(`typeof ["a"] === "object"`)。實測:
    //   PY -> 前兩行照印,然後 AttributeError: 'list' object has no attribute
    //         'get',exit 1
    //   TS(拿掉 Array.isArray)-> 印 "last attempt: ? exit=?" 然後繼續
    const file = fixture({ resume_exec: "/usr/bin/true" }, { log: '["a"]\n' });
    const out = capture("stdout");
    const exc = await expectRejects(
      main(["watcher-status", "--file", file]), "array log line");
    const printed = out.text();
    out.restore();
    expect((exc as Error).message).toContain("has no attribute 'get'");
    expect(printed).toContain("resume_exec: /usr/bin/true\n");
    expect(printed).not.toContain("last attempt:");
  });

  it("strips the output tail with Python's whitespace set, not trim()", async () => {
    // 實測:
    //   output_tail "\x1cboom\x1c" -> PY "output tail: boom"(剝掉分隔符)
    //   output_tail "﻿boom﻿"       -> PY "output tail: ﻿boom﻿"(BOM 留著)
    // JS 的 trim() 兩條都給相反的答案。這是 attempt 那行的 pyRstrip 的姊妹,
    // 少了這條就只有其中一邊被釘住。
    const sep = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({
        ts: "T", exit_code: 0, action: "stop", output_tail: "\x1cboom\x1c",
      }) + "\n",
    });
    const out = capture("stdout");
    await main(["watcher-status", "--file", sep]);
    const printed = out.text();
    out.restore();
    expect(printed).toContain("output tail: boom\n");

    const bom = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({
        ts: "T", exit_code: 0, action: "stop", output_tail: "﻿boom﻿",
      }) + "\n",
    });
    const out2 = capture("stdout");
    await main(["watcher-status", "--file", bom]);
    const printed2 = out2.text();
    out2.restore();
    expect(printed2).toContain("output tail: ﻿boom﻿\n");
  });

  it("propagates when output_tail is truthy but not a string", async () => {
    // 實測 {"output_tail": 5}:PY 印完 "last attempt: ..." 那行之後
    // AttributeError: 'int' object has no attribute 'strip',exit 1。
    // `String(x).trim()` 會靜默印 "output tail: 5"。
    const file = fixture({ resume_exec: "/usr/bin/true" }, {
      log: JSON.stringify({ ts: "T", exit_code: 0, action: "stop", output_tail: 5 }) + "\n",
    });
    const out = capture("stdout");
    const exc = await expectRejects(
      main(["watcher-status", "--file", file]), "non-string output_tail");
    const printed = out.text();
    out.restore();
    expect((exc as Error).message).toContain("has no attribute 'strip'");
    expect(printed).toContain("last attempt: T exit=0 stop\n");
    expect(printed).not.toContain("output tail:");
  });
});

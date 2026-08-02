import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  pidAlive, watcherState, watcherPidPath, watcherLogPath,
  ensureArmed, lastWatcherAttempt, ensureArmedAfterSave,
} from "./watcher.js";
import { makeCheckpoint, saveCheckpoint } from "./checkpoint.js";

function fixture(fields: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "watcher-"));
  const file = join(dir, "cp.json");
  saveCheckpoint(
    makeCheckpoint({ phase: "apply", change_id: "c1", branch: "b", ...fields }),
    file,
  );
  return file;
}

/** 真的產生一個已被收屍的 pid——比猜一個大數字可靠。 */
function reapedPid(): number {
  const proc = spawnSync("/usr/bin/true");
  expect(proc.status).toBe(0);
  return proc.pid as number;
}

/**
 * 「這個呼叫必須拋錯」的斷言。**不要**直接用 `expect(fn).toThrow()`。
 *
 * 裸的 toThrow() 連「測試自己壞掉」都算通過:呼叫一個不存在的名字會拋
 * ReferenceError,那也是一個 throw。實測把 `pidAlive` 改成 `pidAliveTYPO`、
 * 把 `ensureArmed` 改成 `ensureArmedTYPO`,兩條測試都照樣全綠——也就是說它們
 * 當時根本沒有在測任何東西。Python 那側是同一個洞的另一種長相(存取不存在的
 * 模組屬性拋 AttributeError,正好落在 pytest.raises 的預期集合裡)。
 *
 * 這裡把 ReferenceError 明確排除,踩到就會紅。
 */
function expectThrows(fn: () => unknown, label: string): unknown {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, `${label}: 必須拋錯`).toBeInstanceOf(Error);
  expect(caught, `${label}: 拋的是 ReferenceError —— 測試自己壞了,不是受測行為`)
    .not.toBeInstanceOf(ReferenceError);
  return caught;
}

async function waitFor(pred: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !pred(); i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("pidAlive", () => {
  it("reports the current process as alive", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("reports a reaped pid as dead (ESRCH)", () => {
    // spawnSync 回來時子行程已被收屍,它的 pid 不再存在。
    expect(pidAlive(reapedPid())).toBe(false);
  });

  it("propagates an unrepresentable pid instead of reporting it dead", () => {
    // Python 的 _pid_alive 只 except (ProcessLookupError, PermissionError,
    // OSError);os.kill(2**63, 0) 是 OverflowError,會往外拋。實測:
    //   >>> os.kill(2**63, 0)
    //   OverflowError: Python int too large to convert to C int
    // Node 對應的是 TypeError ERR_INVALID_ARG_TYPE(實測)。吞掉它會讓
    //「pid 檔壞掉」被誤判成「watcher 死了」,於是重複 spawn。
    expectThrows(() => pidAlive(2 ** 63), "pidAlive(2**63)");
  });
});

describe("watcherState", () => {
  it("is absent when there is no pid file", () => {
    expect(watcherState(fixture())).toEqual(["absent", null]);
  });

  it("is absent when the pid file is not an integer", () => {
    // Python: int(...) 拋 ValueError -> ("absent", None)
    const file = fixture();
    writeFileSync(watcherPidPath(file), "not-a-pid", "utf-8");
    expect(watcherState(file)).toEqual(["absent", null]);
  });

  it("is running for a live pid and dead for a reaped one", () => {
    const file = fixture();
    writeFileSync(watcherPidPath(file), String(process.pid), "utf-8");
    expect(watcherState(file)).toEqual(["running", process.pid]);

    const dead = reapedPid();
    writeFileSync(watcherPidPath(file), String(dead), "utf-8");
    expect(watcherState(file)).toEqual(["dead", dead]);
  });
});

describe("ensureArmed", () => {
  it("skips when there is no resume command anywhere", () => {
    expect(ensureArmed(fixture())).toEqual(["skipped", null]);
  });

  it("treats an empty container resume_exec as no resume command, the way Python does", () => {
    // loadCheckpoint 不做任何型別收斂,resume_exec 帶的是磁碟 JSON 的原樣。
    // `[]` / `{}` 在 Python 是 falsy、在 JS 是 truthy。實測 checkpoint
    // {"phase":"apply","change_id":"c","branch":"b","resume_exec":[]}:
    //   PY  watcher.ensure_armed(...) -> ('skipped', None)
    //   TS(修前)                     -> ["armed", <pid>],並留下 detached 行程
    for (const empty of [[], {}] as unknown[]) {
      const file = fixture({ resume_exec: empty });
      expect(ensureArmed(file, { heartbeat: 1 })).toEqual(["skipped", null]);
      // 沒 spawn 就不會有 pid 檔——這條才真的證明「沒留下行程」。
      expect(existsSync(watcherPidPath(file)), "不得 spawn").toBe(false);
    }
  });

  it("refuses a truthy non-string resume_exec instead of spawning a nonsense command", () => {
    // Python 的 shlex.split 對非字串拋 AttributeError,所以 ensure_armed 是
    // 「拋錯」而不是回一個狀態。實測 resume_exec=[0]:
    //   PY ensure_armed -> AttributeError: 'list' object has no attribute 'read'
    //   TS(修前)       -> ["armed", 28349],pid 檔寫下,detached 行程留著
    // 只斷言有拋錯是不夠的——會漏掉「拋錯但已經 spawn」,所以每個 case 都
    // 同時斷言沒有 pid 檔。
    for (const bad of [[0], ["a"], { a: 1 }, 1, 1.5, true] as unknown[]) {
      const file = fixture({ resume_exec: bad });
      expectThrows(() => ensureArmed(file, { heartbeat: 1 }), JSON.stringify(bad));
      expect(
        existsSync(watcherPidPath(file)),
        `${JSON.stringify(bad)}: 拒絕的路徑不得留下 pid 檔`,
      ).toBe(false);
    }
  });

  it("checks the running watcher before it refuses, exactly where Python's shlex.split sits", () => {
    // Python 是在 shlex.split 那一刻才炸,也就是在 "already" 早退之後。實測
    // watcher 還活著時,resume_exec=[0] 回 ('already', <pid>) 而不拋錯。
    // 守衛若提前到函式開頭,這條會變紅。
    const file = fixture({ resume_exec: [0] as unknown as string });
    writeFileSync(watcherPidPath(file), String(process.pid), "utf-8");
    expect(ensureArmed(file, { heartbeat: 1 })).toEqual(["already", process.pid]);
  });

  it("treats an empty container exec override as absent, the way Python's `or` does", () => {
    // Python 的 `exec_override or cp.resume_exec` 用的是 Python 的 falsy。
    // checkpoint 也沒有值,所以正確結果是 skipped;`||` 的版本會認為 []
    // 是 truthy,於是拿 [] 去 shlex.split 並真的 spawn 一個 watcher。
    const file = fixture();
    expect(
      ensureArmed(file, { heartbeat: 1, execOverride: [] as unknown as string }),
    ).toEqual(["skipped", null]);
    expect(existsSync(watcherPidPath(file)), "不得 spawn").toBe(false);
  });

  it("really spawns a detached watcher, writes its pid, and is idempotent", async () => {
    // --exec 用 /usr/bin/true:watcher 第一次嘗試就 exit 0 並自行結束,
    // 測試不會留下孤兒行程(最後一條斷言驗證這件事)。
    const file = fixture({ resume_exec: "/usr/bin/true" });
    const [status, pid] = ensureArmed(file, { heartbeat: 1 });
    expect(status).toBe("armed");
    expect(typeof pid).toBe("number");
    expect(readFileSync(watcherPidPath(file), "utf-8")).toBe(String(pid));

    // 第二次呼叫在行程還活著時必須回 already 而不是再 spawn 一個。
    const [second, secondPid] = ensureArmed(file, { heartbeat: 1 });
    expect(["already", "armed"]).toContain(second);
    if (second === "already") {
      expect(secondPid).toBe(pid);
    }

    // 等 watcher 自己跑完並寫下 log。
    await waitFor(() => existsSync(watcherLogPath(file)));
    expect(existsSync(watcherLogPath(file)), "watcher 應該寫下一行 log").toBe(true);
    const last = lastWatcherAttempt(file) as Record<string, unknown>;
    expect(last.exit_code).toBe(0);
    expect(last.action).toBe("stop");

    // 不留孤兒:action=stop 之後 watcher 應自行結束。
    await waitFor(() => !pidAlive(pid as number));
    expect(pidAlive(pid as number), "watcher 不得留下孤兒行程").toBe(false);
  }, 30000);

  it("prefers the exec override over the checkpoint's resume_exec", async () => {
    // Python: exec_str = exec_override or cp.resume_exec —— `or` 不是 `??`,
    // 空字串的 override 要讓位給 checkpoint 裡的值(這裡反過來:checkpoint
    // 是空字串,override 要接手)。
    const file = fixture({ resume_exec: "" });
    const [status, pid] = ensureArmed(file, { heartbeat: 1, execOverride: "/usr/bin/true" });
    expect(status).toBe("armed");
    await waitFor(() => !pidAlive(pid as number));
  }, 30000);

  it("lets the checkpoint value win when the override is an empty string", () => {
    // `or` 的另一半:空字串的 override 不能蓋掉 checkpoint。這裡 checkpoint
    // 也沒有值,所以結果是 skipped——`??` 寫法會讓 execStr 變成 ""(falsy,
    // 一樣 skipped),所以再補一個有值的 checkpoint 來真正區分兩者。
    expect(ensureArmed(fixture(), { execOverride: "" })).toEqual(["skipped", null]);

    const file = fixture({ resume_exec: "/usr/bin/true" });
    // 先塞一個活著的 pid,免得這條測試真的 spawn。
    writeFileSync(watcherPidPath(file), String(process.pid), "utf-8");
    expect(ensureArmed(file, { execOverride: "" })).toEqual(["already", process.pid]);
  });
});

describe("lastWatcherAttempt", () => {
  it("is null when the log is missing, empty, or entirely unparseable", () => {
    const file = fixture();
    expect(lastWatcherAttempt(file)).toBeNull();
    writeFileSync(watcherLogPath(file), "", "utf-8");
    expect(lastWatcherAttempt(file)).toBeNull();
    writeFileSync(watcherLogPath(file), "{oops\n\n", "utf-8");
    expect(lastWatcherAttempt(file)).toBeNull();
  });

  it("returns the last parseable line, skipping broken ones", () => {
    const file = fixture();
    writeFileSync(
      watcherLogPath(file),
      '{"n": 1}\nbroken\n{"n": 2}\n\n',
      "utf-8",
    );
    expect(lastWatcherAttempt(file)).toEqual({ n: 2 });
  });
});

describe("ensureArmedAfterSave", () => {
  it("does nothing without a resume command, in the done phase, or with auto_arm off", () => {
    const noResume = fixture();
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "apply", change_id: "c", branch: "b" }),
      noResume,
    );
    expect(existsSync(watcherPidPath(noResume))).toBe(false);

    const done = fixture({ resume_exec: "/usr/bin/true", phase: "done" });
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "done", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      done,
    );
    expect(existsSync(watcherPidPath(done)), "done 是終態,teardown 已 disarm,不得重新拉起").toBe(false);

    const off = fixture({ resume_exec: "/usr/bin/true" });
    writeFileSync(join(dirname(off), "config.json"), JSON.stringify({ auto_arm: false }), "utf-8");
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "apply", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      off,
    );
    expect(existsSync(watcherPidPath(off))).toBe(false);
  });

  it("treats an empty container resume_exec as no resume command", async () => {
    // 這個閘門看的是**傳進來的 cp 物件**,而 ensureArmed 之後是從磁碟重讀。
    // 所以磁碟上放一個真的 resume_exec、cp 物件放 []:閘門正確時什麼都不做,
    // 閘門用 JS 的 falsy 時 [] 是 truthy、會放行,ensureArmed 從磁碟讀到
    // "/usr/bin/true" 就真的 spawn 了。實測 PY(同一組輸入):
    //   cp 物件 resume_exec=[]              -> watcher.pid exists: False
    //   cp 物件 resume_exec={}              -> watcher.pid exists: False
    //   cp 物件 resume_exec="/usr/bin/true" -> watcher.pid exists: True
    for (const empty of [[], {}] as unknown[]) {
      const file = fixture({ resume_exec: "/usr/bin/true" });
      ensureArmedAfterSave(
        makeCheckpoint({
          phase: "apply", change_id: "c", branch: "b",
          resume_exec: empty as unknown as string,
        }),
        file,
      );
      expect(existsSync(watcherPidPath(file)), "不得 spawn").toBe(false);
    }

    // 對照組:cp 物件帶真的字串時,同一條路徑必須真的 arm——否則把整個
    // 閘門改成無條件 return 也不會有測試變紅。
    const armed = fixture({ resume_exec: "/usr/bin/true" });
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "apply", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      armed,
    );
    expect(existsSync(watcherPidPath(armed))).toBe(true);
    const pid = Number(readFileSync(watcherPidPath(armed), "utf-8"));
    await waitFor(() => !pidAlive(pid));
  }, 30000);

  it("swallows a refused resume_exec into a stderr warning, without spawning", () => {
    // Python 的 except Exception 把 shlex.split 的 AttributeError 收成一行
    // stderr 警告——實測 _ensure_armed_after_save 對 resume_exec=[0] 印
    // "warning: auto-arm failed: 'list' object has no attribute 'read'"
    // 且不寫 pid 檔。auto-arm 失敗不該讓已經成功的主命令變成失敗。
    const file = fixture({ resume_exec: [0] as unknown as string });
    const errs: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errs.push(String(chunk));
      return true;
    });
    try {
      ensureArmedAfterSave(
        makeCheckpoint({
          phase: "apply", change_id: "c", branch: "b",
          resume_exec: [0] as unknown as string,
        }),
        file,
      );
    } finally {
      spy.mockRestore();
    }
    expect(errs.join("")).toMatch(/^warning: auto-arm failed: /);
    expect(existsSync(watcherPidPath(file)), "不得 spawn").toBe(false);
  });

  it("does arm when nothing holds it back (the positive half of the gate)", async () => {
    // 三條早退各自都要有「不早退時真的會 arm」當對照,否則把任一條改成
    // 無條件 return 也不會有測試變紅。
    const file = fixture({ resume_exec: "/usr/bin/true" });
    ensureArmedAfterSave(
      makeCheckpoint({ phase: "apply", change_id: "c", branch: "b", resume_exec: "/usr/bin/true" }),
      file,
    );
    expect(existsSync(watcherPidPath(file))).toBe(true);
    const pid = Number(readFileSync(watcherPidPath(file), "utf-8"));
    await waitFor(() => !pidAlive(pid));
  }, 30000);
});

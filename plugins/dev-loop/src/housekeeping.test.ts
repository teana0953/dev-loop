import { describe, it, expect } from "vitest";
import {
  mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_FILES, archiveWorkfiles } from "./housekeeping.js";

function devloopDir(): string {
  const d = join(mkdtempSync(join(tmpdir(), "hk-")), ".devloop");
  mkdirSync(join(d, "changes"), { recursive: true });
  return d;
}

function write(dir: string, name: string, body = "{}"): string {
  const p = join(dir, name);
  writeFileSync(p, body, "utf-8");
  return p;
}

describe("archiveWorkfiles", () => {
  it("moves workfiles, keeps the residents, and snapshots the checkpoint", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    write(d, "config.json");
    write(d, "watcher.pid", "123");
    write(d, "history.jsonl", "{}\n");
    write(d, "zz-report.json");
    write(d, "a-report.json");
    write(join(d, "changes"), "c1.json");
    mkdirSync(join(d, "subdir"));
    write(join(d, "subdir"), "x.txt", "x");

    const archived = archiveWorkfiles(cp, "c1");

    expect(archived).toEqual([
      "a-report.json", "history.jsonl", "zz-report.json",
      "changes/c1.json", "checkpoint.json (snapshot)",
    ]);
    expect(readdirSync(d).sort()).toEqual(
      ["archive", "changes", "checkpoint.json", "config.json", "subdir", "watcher.pid"],
    );
    expect(readdirSync(join(d, "archive", "c1")).sort()).toEqual(
      ["a-report.json", "c1.json", "checkpoint.json", "history.jsonl", "zz-report.json"],
    );
    // 子目錄整個不動
    expect(readdirSync(join(d, "subdir"))).toEqual(["x.txt"]);
  });

  it("returns the moved files in name order", () => {
    // 回傳名單的順序是可觀察輸出,SKILL 會印出來給人看
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    for (const n of ["m.json", "b.json", "z.json", "a.json"]) write(d, n);
    expect(archiveWorkfiles(cp, "c1").slice(0, 4)).toEqual(
      ["a.json", "b.json", "m.json", "z.json"],
    );
  });

  it("preserves the checkpoint snapshot's mtime", () => {
    // copy2 的語意。歸檔是鑑識用的產物。
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    const when = new Date(1_000_000_000_000);
    utimesSync(cp, when, when);
    archiveWorkfiles(cp, "c1");
    expect(statSync(join(d, "archive", "c1", "checkpoint.json")).mtime.getTime())
      .toBe(when.getTime());
  });

  it("is idempotent: a second call only re-snapshots the checkpoint", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    write(d, "r.json");
    archiveWorkfiles(cp, "c1");
    expect(archiveWorkfiles(cp, "c1")).toEqual(["checkpoint.json (snapshot)"]);
  });

  it("works when there is no change meta", () => {
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    expect(archiveWorkfiles(cp, "no-such-change")).toEqual(["checkpoint.json (snapshot)"]);
  });

  it("leaves another change's meta untouched", () => {
    // Python 對照:test_archive_workfiles_other_change_untouched
    const d = devloopDir();
    const cp = write(d, "checkpoint.json");
    write(join(d, "changes"), "other-change.json");
    archiveWorkfiles(cp, "c1");
    expect(readdirSync(join(d, "changes"))).toEqual(["other-change.json"]);
  });

  it("keeps exactly the documented resident files", () => {
    expect([...KEEP_FILES]).toEqual(["config.json", "watcher.pid"]);
  });
});

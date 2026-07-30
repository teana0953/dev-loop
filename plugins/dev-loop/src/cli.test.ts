import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "cli.js");

function runStatus(cpPath: string): string {
  return execFileSync("node", [CLI, "status", "--file", cpPath], { encoding: "utf-8" });
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

  it("exits non-zero with stderr message for unknown subcommand", () => {
    let threw = false;
    try {
      execFileSync("node", [CLI, "bogus"], { encoding: "utf-8" });
    } catch (err) {
      threw = true;
      const e = err as { status: number; stderr: string };
      expect(e.status).not.toBe(0);
      expect(e.stderr).toMatch(/unknown/i);
    }
    expect(threw).toBe(true);
  });
});

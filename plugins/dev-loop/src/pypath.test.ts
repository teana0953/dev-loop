import { describe, it, expect } from "vitest";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pyResolve } from "./pypath.js";

describe("pyResolve", () => {
  it("resolves a symlinked parent even when the leaf does not exist", () => {
    // 實測(Python 3.14, macOS):
    //   >>> from pathlib import Path
    //   >>> Path("/tmp/does-not-exist-xyz-123").resolve()
    //   PosixPath("/private/tmp/does-not-exist-xyz-123")
    // /tmp 是 /private/tmp 的 symlink,而且不存在的路徑不拋錯 —— 只是把存在
    // 的前綴 realpath 掉,不存在的尾段原樣接回去。
    const real = pyResolve("/tmp");
    expect(real).toBe("/private/tmp");
    expect(pyResolve("/tmp/does-not-exist-xyz-123")).toBe(`${real}/does-not-exist-xyz-123`);
  });

  it("resolves a relative path against cwd", () => {
    // 實測(Python 3.14, macOS):
    //   >>> import os; from pathlib import Path
    //   >>> Path("relative/foo").resolve()
    //   PosixPath("<realpath(cwd)>/relative/foo")
    // cwd 本身也會被解過 symlink(在 /tmp 底下跑時能觀察到)。
    const got = pyResolve("relative/foo");
    expect(got).toBe(`${pyResolve(process.cwd())}/relative/foo`);
  });

  it("resolves an existing directory that is itself a symlink", () => {
    const base = mkdtempSync(join(pyResolve(tmpdir()), "pyresolve-"));
    const link = `${base}-link`;
    symlinkSync(base, link);
    expect(pyResolve(link)).toBe(base);
    expect(pyResolve(join(link, "child"))).toBe(join(base, "child"));
  });

  it("leaves an already-resolved absolute path unchanged", () => {
    expect(pyResolve("/")).toBe("/");
  });
});

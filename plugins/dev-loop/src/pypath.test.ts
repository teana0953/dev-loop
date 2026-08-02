import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pyResolve } from "./pypath.js";

// 每個實測值都是先跑 Python 3.14(macOS)拿到答案,再抄進斷言——不是從實作
// 反推。跑法見 fix-round-1 report。base 一律用 pyResolve(tmpdir()) 建立,
// 讓建出來的目錄本身沒有殘留 symlink 要解,後續案例只需要接字串,不用重新
// 對 Python 跑一次含隨機路徑的案例(已驗證這個接法對任意「已解過的 base」
// 都成立——同一結構、不同 base,Python 給的答案就是 `${resolvedBase}${suffix}`)。
let base: string;

beforeAll(() => {
  base = mkdtempSync(join(pyResolve(tmpdir()), "pyresolve-"));
  mkdirSync(join(base, "realdir"));
  symlinkSync(join(base, "no-such-target"), join(base, "link"));
  symlinkSync(join(base, "realdir"), join(base, "reallink"));
  symlinkSync(join(base, "reallink"), join(base, "chainlink"));
  symlinkSync("relative-target", join(base, "rellink"));
  symlinkSync(join(base, "b"), join(base, "a"));
  symlinkSync(join(base, "a"), join(base, "b"));
  symlinkSync(join(base, "self"), join(base, "self"));
});

describe("pyResolve", () => {
  it("resolves a symlinked parent even when the leaf does not exist", () => {
    // 實測(Python 3.14):
    //   >>> from pathlib import Path
    //   >>> Path(f"{base}/reallink/does-not-exist-xyz-123").resolve()
    //   PosixPath(f"{base}/realdir/does-not-exist-xyz-123")
    // 存在的前綴 realpath 掉,不存在的尾段原樣接回去,不拋錯。
    //
    // 這條原本寫死 `/tmp` -> `/private/tmp`,那是 macOS 專屬事實。CI 的 ts job
    // 跑 ubuntu-latest,那裡 /tmp 是真目錄,寫死的斷言必紅。改用 setup 自己
    // 建的 symlink,兩個平台都成立。
    expect(pyResolve(join(base, "reallink", "does-not-exist-xyz-123"))).toBe(
      join(base, "realdir", "does-not-exist-xyz-123"),
    );
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
    const link = `${base}-link`;
    symlinkSync(base, link);
    expect(pyResolve(link)).toBe(base);
    expect(pyResolve(join(link, "child"))).toBe(join(base, "child"));
  });

  it("leaves an already-resolved absolute path unchanged", () => {
    expect(pyResolve("/")).toBe("/");
  });

  // --- fix round 1: dangling-symlink and normalization edge cases ---
  //
  // 每一組都先在下面這個 setup 用真的 symlink 建出來,實測值抄自 Python
  // 3.14(macOS),用同一個 base 跑的原始輸出(見 report)。
  //   ln -sfn <base>/no-such-target <base>/link
  //   ln -sfn <base>/realdir        <base>/reallink
  //   ln -sfn <base>/reallink       <base>/chainlink
  //   ln -sfn relative-target       <base>/rellink        (relative target)
  //   ln -sfn <base>/b <base>/a ; ln -sfn <base>/a <base>/b   (mutual loop)
  //   ln -sfn <base>/self <base>/self                          (self loop)

  it("dereferences a dangling symlink to its (nonexistent) target, not its own name", () => {
    // Python: Path(f"{base}/link").resolve() == f"{base}/no-such-target"
    // 舊版「最長存在前綴」實作會回 f"{base}/link"(把 symlink 自己的名字當
    // 路徑保留,因為 lstat(link) 本身存在)——這正是本輪修的分歧。
    expect(pyResolve(join(base, "link"))).toBe(join(base, "no-such-target"));
  });

  it("appends the remainder after a dangling symlink's resolved target", () => {
    // Python: Path(f"{base}/link/child").resolve() == f"{base}/no-such-target/child"
    expect(pyResolve(join(base, "link", "child"))).toBe(join(base, "no-such-target", "child"));
  });

  it("follows a symlink whose target exists", () => {
    // Python: Path(f"{base}/reallink").resolve() == f"{base}/realdir"
    expect(pyResolve(join(base, "reallink"))).toBe(join(base, "realdir"));
  });

  it("follows a chain of symlinks to the final real target", () => {
    // Python: Path(f"{base}/chainlink").resolve() == f"{base}/realdir"
    // chainlink -> reallink -> realdir
    expect(pyResolve(join(base, "chainlink"))).toBe(join(base, "realdir"));
  });

  it("resolves a dangling symlink whose target is a relative path", () => {
    // Python: Path(f"{base}/rellink").resolve() == f"{base}/relative-target"
    // target is the literal string "relative-target" (no slash), resolved
    // relative to the symlink's own directory.
    expect(pyResolve(join(base, "rellink"))).toBe(join(base, "relative-target"));
  });

  it("terminates on a mutual symlink loop without raising", () => {
    // Python does NOT raise for Path.resolve()'s default strict=False —
    // verified directly:
    //   >>> os.symlink(f"{base}/b", f"{base}/a"); os.symlink(f"{base}/a", f"{base}/b")
    //   >>> Path(f"{base}/a").resolve()
    //   PosixPath(f"{base}/a")
    // It silently stops resolving and returns the loop member's own path.
    expect(() => pyResolve(join(base, "a"))).not.toThrow();
    expect(pyResolve(join(base, "a"))).toBe(join(base, "a"));
    expect(pyResolve(join(base, "a", "child"))).toBe(join(base, "a", "child"));
  });

  it("terminates on a self-referencing symlink without raising", () => {
    // Python: os.symlink(f"{base}/self", f"{base}/self"); Path(...).resolve()
    // -> PosixPath(f"{base}/self"), no exception.
    expect(() => pyResolve(join(base, "self"))).not.toThrow();
    expect(pyResolve(join(base, "self"))).toBe(join(base, "self"));
  });

  it("strips a trailing slash", () => {
    // Python: Path(f"{base}/realdir/").resolve() == f"{base}/realdir"
    expect(pyResolve(`${join(base, "realdir")}/`)).toBe(join(base, "realdir"));
  });

  it("collapses a . segment", () => {
    // Python: Path(f"{base}/./realdir").resolve() == f"{base}/realdir"
    expect(pyResolve(join(base, ".", "realdir"))).toBe(join(base, "realdir"));
  });

  it("resolves a .. segment against the resolved parent, not the literal one", () => {
    // Python: Path(f"{base}/realdir/..").resolve() == base
    expect(pyResolve(join(base, "realdir", ".."))).toBe(base);
  });

  it("collapses repeated slashes", () => {
    // Python: Path(f"{base}//realdir").resolve() == f"{base}/realdir"
    expect(pyResolve(`${base}//realdir`)).toBe(join(base, "realdir"));
  });

  it("resolves the empty string to cwd", () => {
    // Python: Path("").resolve() == Path(".").resolve() == realpath(cwd)
    expect(pyResolve("")).toBe(pyResolve(process.cwd()));
  });
});

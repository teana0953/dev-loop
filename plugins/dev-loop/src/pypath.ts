import { lstatSync, readlinkSync } from "node:fs";

const SEP = "/";

/**
 * Python `Path(p).resolve()` parity(3.6+ 的預設 strict=False)。
 *
 * `Path.resolve()` 底層就是 `os.path.realpath(p, strict=False)`(CPython
 * `posixpath.realpath`,3.13 起改寫成 stack-based 版本;此處是它的忠實移植,
 * 不是「猜語意」的近似)。它逐段解析路徑,每一段若是 symlink 就把它換成
 * `readlink` 的目標繼續解——**即使目標不存在也照樣替換**,而不是遇到不存在
 * 就停手。這跟「找最長存在前綴、其餘原樣接回去」的做法在 dangling symlink
 * 上會給出不同答案:
 *
 *   實測(Python 3.14, macOS,`ln -sfn /tmp/dang/no-such-target /tmp/dang/link`):
 *     Path("/tmp/dang/link").resolve()       -> /private/tmp/dang/no-such-target
 *     Path("/tmp/dang/link/child").resolve() -> /private/tmp/dang/no-such-target/child
 *
 *   「最長存在前綴」的做法會把 `link` 這個 symlink 本身當成路徑的一部分保留
 *   （因為 lstat(link) 是存在的,realpath 沿用 `link` 而非解開它指向哪裡),
 *   算出 `/private/tmp/dang/link`——兩者不同,而且都不報錯:靜默分歧。
 *
 * symlink 迴圈(a -> b, b -> a,或 self -> self):非嚴格模式下 Python **不
 * 拋錯**——實測 `Path("/tmp/looptest/a").resolve()` 直接回傳
 * `/private/tmp/looptest/a`(把迴圈成員自己的路徑當結果,停止繼續解)。
 * 這裡用 `seen` map 複刻同一個判斷:再次踩到「正在解析、還沒解完」的
 * symlink 就視為迴圈,回傳該 symlink 自己的路徑並停止——不丟例外,終止
 * 而非卡死。
 *
 * 這個差異在 macOS 上是常態而非邊角:`/tmp` 是 `/private/tmp` 的 symlink,而
 * `git worktree list --porcelain` 印的已經是解過的實體路徑。用 `resolve()` 比對
 * 的話,使用者給的 `/tmp/x` 永遠比不到 git 印的 `/private/tmp/x`——於是
 * `worktreeExists` 恆為 false、`pruneOrphanWorktrees` 的前綴比對恆不成立。
 * 而它是**靜默無作為**不是崩潰:孤兒 worktree 永遠不會被清掉,沒有錯誤訊息。
 */
export function pyResolve(p: string): string {
  // `rest` 是待處理的路徑片段堆疊(pop 從尾端取,對應 Python list.pop())。
  // `null` 是特殊標記:代表「上一個 push 進去的 symlink 路徑,它的目標已經
  // 解完」,彈出時把彈出的下一個元素(原 symlink 路徑)記進 seen。
  const rest: (string | null)[] = p.split(SEP).reverse();
  let partCount = rest.length;
  let path = p.startsWith(SEP) ? SEP : process.cwd();
  const seen = new Map<string, string | null>();

  while (partCount > 0) {
    const name = rest.pop();
    if (name === undefined) {
      // Unreachable for a faithful port: partCount only counts real
      // segments, so the stack always has something left to pop while it
      // is positive. Guard rather than loop forever if that invariant is
      // ever violated by a future edit.
      throw new Error("pyResolve: internal stack underflow");
    }
    if (name === null) {
      const symlinkPath = rest.pop() as string;
      seen.set(symlinkPath, path);
      continue;
    }
    partCount -= 1;
    if (name === "" || name === ".") {
      continue;
    }
    if (name === "..") {
      const idx = path.lastIndexOf(SEP);
      path = idx > 0 ? path.slice(0, idx) : SEP;
      continue;
    }
    const newPath = path === SEP ? path + name : path + SEP + name;
    let target: string;
    try {
      const st = lstatSync(newPath);
      if (!st.isSymbolicLink()) {
        path = newPath;
        continue;
      }
      if (seen.has(newPath)) {
        const cached = seen.get(newPath) as string | null;
        if (cached !== null) {
          path = cached;
          continue;
        }
        // 正在解析中卻又踩到同一個 symlink:迴圈。非嚴格模式不拋錯——把
        // 迴圈成員自己的路徑當結果,停止往下解(不會卡死)。
        path = newPath;
        continue;
      }
      target = readlinkSync(newPath);
    } catch {
      // lstat / readlink 失敗(路徑不存在等):非嚴格模式吞掉錯誤,把這段
      // 原樣接上,不再往下解。
      path = newPath;
      continue;
    }
    if (target.startsWith(SEP)) {
      path = SEP;
    }
    seen.set(newPath, null);
    rest.push(newPath);
    rest.push(null);
    const targetParts = target.split(SEP).reverse();
    rest.push(...targetParts);
    partCount += targetParts.length;
  }

  return path;
}

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Python `Path(p).resolve()` parity(3.6+ 的預設 strict=False)。
 *
 * Python 的 resolve() 會解 symlink **而且路徑不存在也不拋錯**。Node 這邊兩個
 * 函式各只做一半:`resolve()` 不解 symlink,`realpathSync()` 解但路徑不存在
 * 就拋 ENOENT。
 *
 * 這個差異在 macOS 上是常態而非邊角:`/tmp` 是 `/private/tmp` 的 symlink,而
 * `git worktree list --porcelain` 印的已經是解過的實體路徑。用 `resolve()` 比對
 * 的話,使用者給的 `/tmp/x` 永遠比不到 git 印的 `/private/tmp/x`——於是
 * `worktreeExists` 恆為 false、`pruneOrphanWorktrees` 的前綴比對恆不成立。
 * 而它是**靜默無作為**不是崩潰:孤兒 worktree 永遠不會被清掉,沒有錯誤訊息。
 *
 * 不存在的路徑:退回逐層解析——把存在的前綴 realpath 掉,其餘接回去。這是
 * Python 的做法,也是唯一能讓「父目錄是 symlink 但檔案還沒建」正確的做法。
 */
export function pyResolve(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // 逐層往上找到存在的前綴
    const parts = abs.split("/");
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const head = parts.slice(0, i).join("/") || "/";
      try {
        const real = realpathSync(head);
        const rest = parts.slice(i);
        // `real` can be exactly "/" (root, itself always resolvable): joining
        // ["/", ...rest] with "/" would double the leading slash ("//repo").
        // Python's Path.resolve() never produces that; verified against
        // Path("/repo").resolve() -> "/repo" on a path that does not exist.
        return real === "/" ? `/${rest.join("/")}` : [real, ...rest].join("/");
      } catch {
        continue;
      }
    }
    return abs;
  }
}

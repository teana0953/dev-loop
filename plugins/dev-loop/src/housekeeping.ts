import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync,
  renameSync, statSync, utimesSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

// 跨 change 的常駐檔,歸檔時不動(checkpoint 以實際檔名另列)
export const KEEP_FILES = ["config.json", "watcher.pid"] as const;

/**
 * 把該 change 的工作檔搬進 `<devloop-dir>/archive/<change_id>/`,回傳歸檔名單。
 *
 * 搬移:checkpoint 同目錄頂層所有檔案(報告、followup、history.jsonl、
 * watcher-log.jsonl…),常駐檔(config/checkpoint/watcher.pid)與子目錄除外;
 * 外加 `changes/<change_id>.json` meta。checkpoint 另複製一份快照進歸檔
 * (原檔保留,status 在 done 終態仍可讀)。
 *
 * 採「搬走所有非常駐檔」而非白名單 pattern:報告檔名由編排端決定,
 * 引擎不猜;跑得越多 `.devloop/` 越乾淨而不是越髒。
 */
export function archiveWorkfiles(checkpointPath: string, changeId: string): string[] {
  const cpName = basename(checkpointPath);
  const root = dirname(checkpointPath);
  const dest = join(root, "archive", String(changeId));
  const keep = new Set<string>([...KEEP_FILES, cpName]);
  const archived: string[] = [];

  // Python 的 sorted(root.iterdir()) 排的是路徑字串,同目錄下等同於按檔名排。
  // 顯式給比較器而不用 Array.sort() 的預設,是為了讓排序規則寫在明處——
  // 回傳名單的順序是這個函式的可觀察輸出。
  const names = readdirSync(root).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const p = join(root, name);
    if (!statSync(p).isFile() || keep.has(name)) {
      continue;
    }
    mkdirSync(dest, { recursive: true });
    renameSync(p, join(dest, name));
    archived.push(name);
  }

  const meta = join(root, "changes", `${changeId}.json`);
  if (existsSync(meta)) {
    mkdirSync(dest, { recursive: true });
    renameSync(meta, join(dest, basename(meta)));
    archived.push(`changes/${basename(meta)}`);
  }

  if (existsSync(checkpointPath)) {
    mkdirSync(dest, { recursive: true });
    const target = join(dest, cpName);
    copyFileSync(checkpointPath, target);
    // Python 用的是 shutil.copy2,它會連同 mode 與時間戳一起複製;
    // copyFileSync 兩者都不保留。歸檔是鑑識用的產物,時間戳不能在移植中歸零。
    const st = statSync(checkpointPath);
    chmodSync(target, st.mode);
    utimesSync(target, st.atime, st.mtime);
    archived.push(`${cpName} (snapshot)`);
  }

  return archived;
}

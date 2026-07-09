from __future__ import annotations

import shutil
from pathlib import Path

# 跨 change 的常駐檔,歸檔時不動(checkpoint 以實際檔名另列)
KEEP_FILES = ("config.json", "watcher.pid")


def archive_workfiles(checkpoint_path, change_id):
    """把該 change 的工作檔搬進 `<devloop-dir>/archive/<change_id>/`,回傳歸檔名單。

    搬移:checkpoint 同目錄頂層所有檔案(報告、followup、history.jsonl、
    watcher-log.jsonl…),常駐檔(config/checkpoint/watcher.pid)與子目錄除外;
    外加 `changes/<change_id>.json` meta。checkpoint 另複製一份快照進歸檔
    (原檔保留,status 在 done 終態仍可讀)。

    採「搬走所有非常駐檔」而非白名單 pattern:報告檔名由編排端決定,
    引擎不猜;跑得越多 `.devloop/` 越乾淨而不是越髒。
    """
    cp = Path(checkpoint_path)
    root = cp.parent
    dest = root / "archive" / str(change_id)
    keep = set(KEEP_FILES) | {cp.name}
    archived = []

    for p in sorted(root.iterdir()):
        if not p.is_file() or p.name in keep:
            continue
        dest.mkdir(parents=True, exist_ok=True)
        p.replace(dest / p.name)
        archived.append(p.name)

    meta = root / "changes" / ("%s.json" % change_id)
    if meta.exists():
        dest.mkdir(parents=True, exist_ok=True)
        meta.replace(dest / meta.name)
        archived.append("changes/%s" % meta.name)

    if cp.exists():
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cp, dest / cp.name)
        archived.append("%s (snapshot)" % cp.name)

    return archived

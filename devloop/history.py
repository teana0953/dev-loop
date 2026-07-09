from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def history_path(checkpoint_path) -> Path:
    """history.jsonl 與 checkpoint 同目錄。"""
    return Path(checkpoint_path).parent / "history.jsonl"


def append_history(checkpoint_path, event, from_phase, to_phase, iteration) -> None:
    """對 history.jsonl 追加一筆 transition 紀錄(append-only,一行一 JSON)。"""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "from": from_phase,
        "to": to_phase,
        "iteration": iteration,
    }
    path = history_path(checkpoint_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

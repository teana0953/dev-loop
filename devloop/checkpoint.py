from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Checkpoint:
    """Dev-loop 斷點狀態(規格 9A)。"""

    phase: str
    change_id: str
    branch: str
    iteration: int = 0
    last_artifact: str = ""
    non_blocking: list = field(default_factory=list)
    updated_at: str = ""
    resume_exec: str = None
    units: list = field(default_factory=list)
    review_legs: list = field(default_factory=list)
    propose_attempts: int = 0
    gate_failures: int = 0
    finish_mode: str = None

    def save(self, path) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path) -> "Checkpoint":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(**data)

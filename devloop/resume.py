from __future__ import annotations

from dataclasses import dataclass

MAX_SLEEP_SECONDS = 3600  # harness 單次 wakeup 上限


@dataclass
class ResumeAction:
    ready: bool          # 已達 reset → 立即跑 --resume
    sleep_seconds: int   # 未達時,睡多久後重檢
    phase: str           # 要 resume 回的階段(取自 checkpoint)


def plan_resume(checkpoint_phase, now, reset_at) -> ResumeAction:
    """本機 adapter 的排程決策(規格 9B)。"""
    if now >= reset_at:
        return ResumeAction(ready=True, sleep_seconds=0, phase=checkpoint_phase)
    remaining = (reset_at - now).total_seconds()
    return ResumeAction(
        ready=False,
        sleep_seconds=int(min(remaining, MAX_SLEEP_SECONDS)),
        phase=checkpoint_phase,
    )

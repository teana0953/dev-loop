from datetime import datetime, timedelta, timezone

from devloop.resume import MAX_SLEEP_SECONDS, ResumeAction, plan_resume


def _now():
    return datetime(2026, 6, 18, 12, 0, 0, tzinfo=timezone.utc)


def test_ready_when_reset_reached():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now)
    assert isinstance(action, ResumeAction)
    assert action.ready is True
    assert action.sleep_seconds == 0
    assert action.phase == "review"


def test_ready_when_past_reset():
    now = _now()
    action = plan_resume("fix", now=now, reset_at=now - timedelta(minutes=1))
    assert action.ready is True
    assert action.sleep_seconds == 0


def test_sleep_clamped_to_max_when_far():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now + timedelta(hours=5))
    assert action.ready is False
    assert action.sleep_seconds == MAX_SLEEP_SECONDS


def test_sleep_is_remaining_when_within_window():
    now = _now()
    action = plan_resume("review", now=now, reset_at=now + timedelta(minutes=10))
    assert action.ready is False
    assert action.sleep_seconds == 600

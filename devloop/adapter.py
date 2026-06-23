from __future__ import annotations

import subprocess
import time
from datetime import datetime, timezone

from devloop.checkpoint import Checkpoint
from devloop.resume import MAX_SLEEP_SECONDS, plan_resume

DEFAULT_HEARTBEAT = 1800  # 兩次重試間預設間隔(秒)


def _default_now():
    return datetime.now(timezone.utc)


def _default_run(cmd):
    return subprocess.run(cmd).returncode


def run_watcher(
    exec_command,
    heartbeat=DEFAULT_HEARTBEAT,
    sleep_fn=None,
    run_fn=None,
):
    """無 reset 時間 · 週期重試的續跑 watcher(規格 §9B、resume-trigger)。

    反覆執行 exec_command:回傳 0 即視為 loop 已被重新推進,停止並回傳 0;
    回傳非 0 視為仍被限流,睡一個 heartbeat 後重試。heartbeat 夾到
    MAX_SLEEP_SECONDS(harness wakeup 上限)。

    sleep_fn / run_fn 可注入以便測試。
    """
    sleep_fn = sleep_fn or time.sleep
    run_fn = run_fn or _default_run
    interval = min(heartbeat, MAX_SLEEP_SECONDS)
    while True:
        code = run_fn(exec_command)
        if code == 0:
            return 0
        sleep_fn(interval)


def run_adapter(
    checkpoint_path,
    reset_at,
    exec_command,
    now_fn=None,
    sleep_fn=None,
    run_fn=None,
):
    """本機 resume 觸發 adapter(規格 §9B)。

    這是 token 用罄時、agent 自身無法運行的情況下,由獨立 OS 程序
    執行的等待迴圈:反覆讀 checkpoint、用 plan_resume 決定還要睡多久,
    睡到 reset 時間點後執行 exec_command(使用者提供的續跑命令)。

    因 wakeup 上限 3600 秒,未到 reset 時每次最多睡 sleep_seconds 後重檢,
    形成週期性重排。回傳 exec_command 的 exit code。

    now_fn / sleep_fn / run_fn 可注入以便測試;預設用真實時間、time.sleep、
    subprocess。
    """
    now_fn = now_fn or _default_now
    sleep_fn = sleep_fn or time.sleep
    run_fn = run_fn or _default_run

    while True:
        cp = Checkpoint.load(checkpoint_path)
        action = plan_resume(cp.phase, now_fn(), reset_at)
        if action.ready:
            return run_fn(exec_command)
        sleep_fn(action.sleep_seconds)

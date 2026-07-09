from __future__ import annotations

import subprocess
import time

DEFAULT_HEARTBEAT = 1800  # 兩次重試間預設間隔(秒)
MAX_SLEEP_SECONDS = 3600  # 單次睡眠上限(harness wakeup 上限)


def _default_run(cmd):
    return subprocess.run(cmd).returncode


def run_watcher(
    exec_command,
    heartbeat=DEFAULT_HEARTBEAT,
    sleep_fn=None,
    run_fn=None,
):
    """無 reset 時間 · 週期重試的續跑 watcher(resume-trigger 規格)。

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

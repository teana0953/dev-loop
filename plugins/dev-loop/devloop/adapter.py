from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_HEARTBEAT = 1800  # 兩次重試間預設間隔(秒)
MAX_SLEEP_SECONDS = 3600  # 單次睡眠上限(harness wakeup 上限)
OUTPUT_TAIL_CHARS = 500  # log 保留的命令輸出尾巴長度


def _default_run(cmd):
    """執行續跑命令,回傳 (exit_code, 輸出尾巴)。detached watcher 的 stdout
    無人看,輸出改捕捉進 log 供排障。"""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    tail = ((proc.stdout or "") + (proc.stderr or ""))[-OUTPUT_TAIL_CHARS:]
    return proc.returncode, tail


def _append_log(log_path, entry) -> None:
    """best-effort 追加一行 JSON 到 watcher log;失敗靜默(不得反噬 watcher)。"""
    if not log_path:
        return
    try:
        p = Path(log_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def run_watcher(
    exec_command,
    heartbeat=DEFAULT_HEARTBEAT,
    sleep_fn=None,
    run_fn=None,
    log_path=None,
):
    """無 reset 時間 · 週期重試的續跑 watcher(resume-trigger 規格)。

    反覆執行 exec_command:回傳 0 即視為 loop 已被重新推進,停止並回傳 0;
    回傳非 0 視為仍被限流,睡一個 heartbeat 後重試。heartbeat 夾到
    MAX_SLEEP_SECONDS(harness wakeup 上限)。

    log_path 非空時,每次嘗試追加一行 JSON(ts/exit_code/output_tail/action)
    供 watcher-status 排障;寫入失敗靜默。

    sleep_fn / run_fn 可注入以便測試;run_fn 可回傳 exit code 或
    (exit_code, output_tail)。
    """
    sleep_fn = sleep_fn or time.sleep
    run_fn = run_fn or _default_run
    interval = min(heartbeat, MAX_SLEEP_SECONDS)
    while True:
        result = run_fn(exec_command)
        code, tail = result if isinstance(result, tuple) else (result, "")
        _append_log(log_path, {
            "ts": datetime.now(timezone.utc).isoformat(),
            "exit_code": code,
            "output_tail": tail,
            "action": "stop" if code == 0 else "retry",
            "heartbeat": interval,
        })
        if code == 0:
            return 0
        sleep_fn(interval)

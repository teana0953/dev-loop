import os
import subprocess
from pathlib import Path

from devloop.checkpoint import Checkpoint
from devloop.cli import main


def test_start_creates_checkpoint(tmp_path, capsys):
    f = tmp_path / "cp.json"
    code = main(["start", "--file", str(f), "--change-id", "add-foo", "--branch", "loop/add-foo"])
    assert code == 0
    cp = Checkpoint.load(f)
    assert cp.phase == "apply"
    assert cp.change_id == "add-foo"
    assert cp.branch == "loop/add-foo"
    assert cp.iteration == 0


def test_start_stores_resume_exec(tmp_path):
    f = tmp_path / "cp.json"
    code = main([
        "start", "--file", str(f),
        "--change-id", "add-foo", "--branch", "loop/add-foo",
        "--resume-exec", "claude -p '/dev-loop resume'",
    ])
    assert code == 0
    assert Checkpoint.load(f).resume_exec == "claude -p '/dev-loop resume'"


def test_start_resume_exec_defaults_none(tmp_path):
    f = tmp_path / "cp.json"
    main(["start", "--file", str(f), "--change-id", "c", "--branch", "b"])
    assert Checkpoint.load(f).resume_exec is None


def test_status_prints_phase_and_iteration(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=2).save(f)
    code = main(["status", "--file", str(f)])
    assert code == 0
    out = capsys.readouterr().out
    assert "review" in out
    assert "2" in out


def test_event_advances_and_persists(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "apply_done"])
    assert code == 0
    assert Checkpoint.load(f).phase == "gate"


def test_event_gate_pass_increments_iteration(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", iteration=0).save(f)
    main(["event", "--file", str(f), "--event", "gate_pass"])
    cp = Checkpoint.load(f)
    assert cp.phase == "review"
    assert cp.iteration == 1


def test_event_escalates_when_over_limit(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", iteration=3).save(f)
    main(["event", "--file", str(f), "--event", "gate_pass", "--max", "3"])
    assert Checkpoint.load(f).phase == "escalated"


def test_gate_subcommand_exit_code(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    # 全綠 gate → exit 0 且階段前進到 review
    code = main(["gate", "--file", str(f), "--cmd", "true"])
    assert code == 0
    assert Checkpoint.load(f).phase == "review"


def test_gate_subcommand_failure_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    code = main(["gate", "--file", str(f), "--cmd", "false"])
    assert code == 1
    assert Checkpoint.load(f).phase == "fix"


def test_gate_supports_multiword_commands(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    # 多字詞命令(如真實的 `pytest tests/`)須被正確切分為 argv,而非當成單一執行檔
    code = main(["gate", "--file", str(f), "--cmd", "sh -c 'exit 0'"])
    assert code == 0
    assert Checkpoint.load(f).phase == "review"


from datetime import timezone, datetime, timedelta
import json


def test_resume_ready_when_no_reset_at(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    code = main(["resume", "--file", str(f)])
    assert code == 0
    out = capsys.readouterr().out
    assert "ready=True" in out
    assert "sleep_seconds=0" in out
    assert "phase=review" in out


def test_resume_not_ready_when_reset_in_future(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="fix", change_id="c", branch="b").save(f)
    future = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    code = main(["resume", "--file", str(f), "--reset-at", future])
    assert code == 0
    out = capsys.readouterr().out
    assert "ready=False" in out
    assert "sleep_seconds=3600" in out


def test_review_no_blocking_advances_to_merge(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "non_blocking", "level": "code", "note": "rename x"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    cp = Checkpoint.load(f)
    assert cp.phase == "merge"
    assert cp.non_blocking == ["rename x"]


def test_review_blocking_code_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "code", "note": "bug"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    assert Checkpoint.load(f).phase == "fix"


def test_review_blocking_proposal_routes_to_propose(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", iteration=1).save(f)
    report = tmp_path / "r.json"
    report.write_text(json.dumps({"findings": [
        {"severity": "blocking", "level": "proposal", "note": "spec wrong"}
    ]}), encoding="utf-8")
    code = main(["review", "--file", str(f), "--report", str(report)])
    assert code == 0
    assert Checkpoint.load(f).phase == "propose"


def test_invalid_event_returns_clean_error(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="c", branch="b").save(f)
    code = main(["event", "--file", str(f), "--event", "gate_pass"])
    assert code == 2
    err = capsys.readouterr().err
    assert "error" in err.lower()
    # checkpoint 不應被改動
    assert Checkpoint.load(f).phase == "merge"


def test_gate_timeout_flag_routes_to_fix(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    code = main(["gate", "--file", str(f), "--cmd", "sh -c 'sleep 5'", "--timeout", "1"])
    assert code == 1
    assert Checkpoint.load(f).phase == "fix"


def test_validate_change_subcommand(tmp_path, monkeypatch, capsys):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="propose", change_id="add-foo", branch="b").save(f)
    seen = {}

    def fake_validate(change_id, runner=None):
        seen["id"] = change_id
        return OpenSpecResult(ok=True, command=["openspec", "validate", change_id], output="ok")

    monkeypatch.setattr(cli, "validate_change", fake_validate)
    code = cli.main(["validate-change", "--file", str(f)])
    assert code == 0
    assert seen["id"] == "add-foo"


def test_validate_change_failure_returns_1(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="propose", change_id="bad", branch="b").save(f)
    monkeypatch.setattr(
        cli, "validate_change",
        lambda change_id, runner=None: OpenSpecResult(ok=False, command=["openspec", "validate", change_id], output="invalid"),
    )
    assert cli.main(["validate-change", "--file", str(f)]) == 1


def test_archive_subcommand(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="add-foo", branch="b").save(f)
    seen = {}

    def fake_archive(change_id, runner=None):
        seen["id"] = change_id
        return OpenSpecResult(ok=True, command=["openspec", "archive", change_id], output="archived")

    monkeypatch.setattr(cli, "archive_change", fake_archive)
    code = cli.main(["archive", "--file", str(f)])
    assert code == 0
    assert seen["id"] == "add-foo"


def test_archive_failure_returns_1(tmp_path, monkeypatch):
    import devloop.cli as cli
    from devloop.openspec import OpenSpecResult

    f = tmp_path / "cp.json"
    Checkpoint(phase="merge", change_id="x", branch="b").save(f)
    monkeypatch.setattr(
        cli, "archive_change",
        lambda change_id, runner=None: OpenSpecResult(ok=False, command=["openspec", "archive", change_id], output="nope"),
    )
    assert cli.main(["archive", "--file", str(f)]) == 1


def test_auto_resume_subcommand(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b").save(f)
    captured = {}

    def fake_run_adapter(checkpoint_path, reset_at, exec_command, **kw):
        captured["path"] = str(checkpoint_path)
        captured["exec"] = exec_command
        captured["reset_year"] = reset_at.year
        return 0

    monkeypatch.setattr(cli, "run_adapter", fake_run_adapter)
    code = cli.main([
        "auto-resume",
        "--file", str(f),
        "--reset-at", "2026-06-18T15:00:00+00:00",
        "--exec", "claude -p '/dev-loop resume'",
    ])
    assert code == 0
    assert captured["path"] == str(f)
    # --exec 應被 shlex 切分成 argv
    assert captured["exec"] == ["claude", "-p", "/dev-loop resume"]
    assert captured["reset_year"] == 2026


def test_auto_resume_propagates_exit_code(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / "cp.json"
    Checkpoint(phase="fix", change_id="c", branch="b").save(f)
    monkeypatch.setattr(cli, "run_adapter", lambda *a, **k: 7)
    code = cli.main([
        "auto-resume", "--file", str(f),
        "--reset-at", "2026-06-18T15:00:00+00:00", "--exec", "true",
    ])
    assert code == 7


def test_arm_local_spawns_when_no_pidfile(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(
        phase="review", change_id="c", branch="b",
        resume_exec="claude -p '/dev-loop resume'",
    ).save(f)
    spawned = {}
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: (spawned.update(cmd=cmd), 4321)[1])

    code = cli.main(["arm-local", "--file", str(f)])
    assert code == 0
    assert spawned["cmd"] == ["claude", "-p", "/dev-loop resume"]
    assert (f.parent / "watcher.pid").read_text().strip() == "4321"


def test_arm_local_noop_when_watcher_alive(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", resume_exec="x").save(f)
    (f.parent / "watcher.pid").write_text("999")
    monkeypatch.setattr(cli, "_pid_alive", lambda pid: True)
    spawned = []
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: spawned.append(cmd) or 1)

    code = cli.main(["arm-local", "--file", str(f)])
    assert code == 0
    assert spawned == []
    assert (f.parent / "watcher.pid").read_text().strip() == "999"


def test_arm_local_respawns_on_stale_pid(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", resume_exec="x").save(f)
    (f.parent / "watcher.pid").write_text("999")
    monkeypatch.setattr(cli, "_pid_alive", lambda pid: False)
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: 5555)

    code = cli.main(["arm-local", "--file", str(f)])
    assert code == 0
    assert (f.parent / "watcher.pid").read_text().strip() == "5555"


def test_arm_local_errors_without_exec(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b").save(f)  # resume_exec=None
    spawned = []
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: spawned.append(cmd) or 1)

    code = cli.main(["arm-local", "--file", str(f)])
    assert code != 0
    assert spawned == []
    assert not (f.parent / "watcher.pid").exists()


def test_arm_local_exec_override(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b").save(f)  # resume_exec=None
    captured = {}
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: (captured.update(cmd=cmd), 7)[1])

    code = cli.main(["arm-local", "--file", str(f), "--exec", "true"])
    assert code == 0
    assert captured["cmd"] == ["true"]


def test_pid_alive_true_when_running(monkeypatch):
    import devloop.cli as cli

    monkeypatch.setattr(cli.os, "kill", lambda pid, sig: None)
    assert cli._pid_alive(123) is True


def test_pid_alive_false_when_no_such_process(monkeypatch):
    import devloop.cli as cli

    def boom(pid, sig):
        raise ProcessLookupError()

    monkeypatch.setattr(cli.os, "kill", boom)
    assert cli._pid_alive(123) is False


def test_pid_alive_true_on_permission_error(monkeypatch):
    # EPERM:行程存在但屬他人 → 視為存活
    import devloop.cli as cli

    def boom(pid, sig):
        raise PermissionError()

    monkeypatch.setattr(cli.os, "kill", boom)
    assert cli._pid_alive(123) is True


def test_arm_local_respawns_on_nonnumeric_pid(tmp_path, monkeypatch):
    import devloop.cli as cli

    f = tmp_path / ".devloop" / "cp.json"
    Checkpoint(phase="review", change_id="c", branch="b", resume_exec="x").save(f)
    (f.parent / "watcher.pid").write_text("garbage")
    monkeypatch.setattr(cli, "_spawn_watcher", lambda cmd, hb: 8888)

    code = cli.main(["arm-local", "--file", str(f)])
    assert code == 0
    assert (f.parent / "watcher.pid").read_text().strip() == "8888"


def test_watch_subcommand_runs_exec_real():
    # watch → run_watcher → 真實 subprocess:`true` 立即回 0,不 mock
    assert main(["watch", "--exec", "true"]) == 0


def test_arm_local_spawns_real_watcher(tmp_path):
    # 真實 spawn 路徑(無 mock):arm-local → detached watch → run_watcher → 跑 exec。
    # 用副作用(touch marker)驗證整條路徑確實執行,避免 zombie 導致的 pid 存活誤判。
    import time

    f = tmp_path / ".devloop" / "cp.json"
    marker = tmp_path / "ran.marker"
    Checkpoint(
        phase="review", change_id="c", branch="b",
        resume_exec="touch %s" % marker,
    ).save(f)

    assert main(["arm-local", "--file", str(f)]) == 0
    pid = int((f.parent / "watcher.pid").read_text().strip())

    try:
        for _ in range(50):
            if marker.exists():
                break
            time.sleep(0.1)
        assert marker.exists(), "watcher 未執行 resume_exec(marker 未出現)"
    finally:
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)  # reap,避免遺留 zombie
        except OSError:
            pass


def test_status_shows_change_id_and_branch(tmp_path, capsys):
    f = tmp_path / "cp.json"
    Checkpoint(phase="review", change_id="add-foo", branch="loop/add-foo", iteration=2).save(f)
    assert main(["status", "--file", str(f)]) == 0
    out = capsys.readouterr().out
    assert "change_id=add-foo" in out
    assert "branch=loop/add-foo" in out
    # 向後相容
    assert "phase=review" in out
    assert "iteration=2" in out


# ---------------------------------------------------------------------------
# units-init helpers
# ---------------------------------------------------------------------------

def _git(repo, *a):
    subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True)


def _repo(tmp_path):
    r = tmp_path / "repo"; r.mkdir()
    _git(r, "init", "-b", "main"); _git(r, "config", "user.email", "t@t")
    _git(r, "config", "user.name", "t")
    (r / "base.txt").write_text("x\n"); _git(r, "add", "."); _git(r, "commit", "-m", "init")
    return r


def test_units_init_creates_worktrees(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": [
        {"id": "g1", "tasks": ["1"], "files_hint": ["a/"]},
        {"id": "g2", "tasks": ["2"], "files_hint": ["b/"]},
    ]}), encoding="utf-8")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert [u["id"] for u in cp.units] == ["g1", "g2"]
    assert (repo / ".devloop/wt/g1").exists()
    assert cp.units[0]["status"] == "pending"


def test_units_init_serial_no_worktrees(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": []}), encoding="utf-8")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    assert Checkpoint.load(cp_path).units == []

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
    assert cp.phase == "qa"
    assert cp.iteration == 1


def test_event_escalates_when_over_limit(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b", iteration=3).save(f)
    main(["event", "--file", str(f), "--event", "gate_pass", "--max", "3"])
    assert Checkpoint.load(f).phase == "escalated"


def test_gate_subcommand_exit_code(tmp_path):
    f = tmp_path / "cp.json"
    Checkpoint(phase="gate", change_id="c", branch="b").save(f)
    # 全綠 gate → exit 0 且階段前進到 qa(內圈 gate→qa→review)
    code = main(["gate", "--file", str(f), "--cmd", "true"])
    assert code == 0
    assert Checkpoint.load(f).phase == "qa"


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
    assert Checkpoint.load(f).phase == "qa"


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


def test_units_init_single_group_is_serial(tmp_path, capsys):
    # Exactly ONE parallel_group still counts as serial — no worktrees created.
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": [
        {"id": "g1", "tasks": ["1"], "files_hint": ["a/"]},
    ]}), encoding="utf-8")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.units == []
    assert not (repo / ".devloop/wt").exists()
    out = capsys.readouterr().out
    assert "serial" in out


def test_unit_done_marks_done(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"},
                      {"id": "g2", "status": "pending"}]).save(cp_path)
    rc = main(["unit-done", "--file", str(cp_path), "--id", "g1"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.units[0]["status"] == "done"
    assert cp.units[1]["status"] == "pending"


def test_unit_done_unknown_id(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    rc = main(["unit-done", "--file", str(cp_path), "--id", "zzz"])
    assert rc == 2


def test_units_merge_success(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    # 手動建兩個不衝突的 unit 分支
    for gid, fname in (("g1", "g1.txt"), ("g2", "g2.txt")):
        wt = repo / (".devloop/wt/" + gid)
        from devloop.worktree import add_worktree
        add_worktree(repo, wt, "loop/x-" + gid, "loop/x")
        (wt / fname).write_text(gid + "\n")
        _git(wt, "add", "."); _git(wt, "commit", "-m", gid)
    cp = Checkpoint.load(cp_path)
    cp.units = [
        {"id": "g1", "worktree": str(repo / ".devloop/wt/g1"), "branch": "loop/x-g1", "status": "done"},
        {"id": "g2", "worktree": str(repo / ".devloop/wt/g2"), "branch": "loop/x-g2", "status": "done"},
    ]
    cp.save(cp_path)
    rc = main(["units-merge", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert all(u["status"] == "merged" for u in cp.units)
    assert (repo / "g1.txt").exists() and (repo / "g2.txt").exists()


def test_units_merge_conflict_marks_unit(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    (wt / "base.txt").write_text("g1\n"); _git(wt, "add", "."); _git(wt, "commit", "-m", "g1")
    # 短命分支也改 base.txt → 衝突
    (repo / "base.txt").write_text("main\n"); _git(repo, "add", "."); _git(repo, "commit", "-m", "main")
    cp = Checkpoint.load(cp_path)
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "done"}]
    cp.save(cp_path)
    rc = main(["units-merge", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 1
    assert Checkpoint.load(cp_path).units[0]["status"] == "conflict"


def test_units_merge_checkout_failure_aborts(tmp_path):
    # If checkout to cp.branch fails, abort without merging or mutating unit statuses.
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    # Use a branch name that does not exist
    Checkpoint(phase="apply", change_id="c", branch="nonexistent/branch").save(cp_path)
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    (wt / "g1.txt").write_text("g1\n")
    _git(wt, "add", "."); _git(wt, "commit", "-m", "g1")
    cp = Checkpoint.load(cp_path)
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "done"}]
    cp.save(cp_path)
    rc = main(["units-merge", "--file", str(cp_path), "--repo", str(repo)])
    assert rc == 2
    # unit status must remain unchanged ("done"), not "merged" or "conflict"
    assert Checkpoint.load(cp_path).units[0]["status"] == "done"


def test_units_cleanup_removes_merged(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="loop/x")
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "merged"}]
    cp.save(cp_path)
    rc = main(["units-cleanup", "--file", str(cp_path), "--repo", str(repo),
               "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    assert not wt.exists()


def test_units_cleanup_removes_orphan(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    orphan = repo / ".devloop/wt/ghost"
    add_worktree(repo, orphan, "loop/x-ghost", "loop/x")  # checkpoint 不記
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x", units=[]).save(cp_path)
    rc = main(["units-cleanup", "--file", str(cp_path), "--repo", str(repo),
               "--wt-root", str(repo / ".devloop/wt")])
    assert rc == 0
    assert not orphan.exists()


def test_units_cleanup_keeps_out_of_scope_worktree(tmp_path):
    # Worktrees outside wt_root must NOT be removed.
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    external = tmp_path / "external"
    add_worktree(repo, external, "loop/x-ext", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x", units=[]).save(cp_path)
    wt_root = repo / ".devloop/wt"
    rc = main(["units-cleanup", "--file", str(cp_path), "--repo", str(repo),
               "--wt-root", str(wt_root)])
    assert rc == 0
    assert external.exists()  # external worktree was NOT removed


# ---------------------------------------------------------------------------
# units-status tests
# ---------------------------------------------------------------------------

import io
from contextlib import redirect_stdout


def test_units_status_lists_pending(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b", units=[
        {"id": "g1", "status": "merged"},
        {"id": "g2", "status": "pending"},
        {"id": "g3", "status": "in_progress"},
    ]).save(cp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = main(["units-status", "--file", str(cp_path)])
    assert rc == 0
    out = buf.getvalue()
    assert "pending: g2,g3" in out


def test_units_status_none_pending(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "merged"}]).save(cp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = main(["units-status", "--file", str(cp_path)])
    assert "pending: -" in buf.getvalue()


def test_unit_resolve_marks_merged_and_removes_worktree(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    from devloop.worktree import add_worktree
    wt = repo / ".devloop/wt/g1"
    add_worktree(repo, wt, "loop/x-g1", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    cp = Checkpoint(phase="apply", change_id="c", branch="loop/x")
    cp.units = [{"id": "g1", "worktree": str(wt), "branch": "loop/x-g1", "status": "conflict"}]
    cp.save(cp_path)
    rc = main(["unit-resolve", "--file", str(cp_path), "--repo", str(repo), "--id", "g1"])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert cp.units[0]["status"] == "merged"
    assert not wt.exists()


def test_unit_resolve_unknown_id(tmp_path):
    repo = _repo(tmp_path)
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "conflict"}]).save(cp_path)
    rc = main(["unit-resolve", "--file", str(cp_path), "--repo", str(repo), "--id", "zzz"])
    assert rc == 2


def test_units_init_idempotent_skips_existing(tmp_path):
    repo = _repo(tmp_path)
    _git(repo, "checkout", "-b", "loop/x")
    cp_path = repo / ".devloop/checkpoint.json"
    Checkpoint(phase="apply", change_id="c", branch="loop/x").save(cp_path)
    meta = repo / ".devloop/changes/c.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps({"parallel_groups": [
        {"id": "g1", "tasks": ["1"]}, {"id": "g2", "tasks": ["2"]},
    ]}), encoding="utf-8")
    wt_root = repo / ".devloop/wt"
    # 預先建立 g1 的 worktree,模擬 crash 後重跑
    from devloop.worktree import add_worktree
    add_worktree(repo, wt_root / "g1", "loop/x-g1", "loop/x")
    rc = main(["units-init", "--file", str(cp_path), "--repo", str(repo),
               "--meta", str(meta), "--wt-root", str(wt_root)])
    assert rc == 0
    cp = Checkpoint.load(cp_path)
    assert [u["id"] for u in cp.units] == ["g1", "g2"]
    assert (wt_root / "g2").exists()


def test_unit_claim_marks_in_progress(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    rc = main(["unit-claim", "--file", str(cp_path), "--id", "g1"])
    assert rc == 0
    assert Checkpoint.load(cp_path).units[0]["status"] == "in_progress"


def test_unit_claim_unknown_id(tmp_path):
    cp_path = tmp_path / "cp.json"
    Checkpoint(phase="apply", change_id="c", branch="b",
               units=[{"id": "g1", "status": "pending"}]).save(cp_path)
    assert main(["unit-claim", "--file", str(cp_path), "--id", "zzz"]) == 2

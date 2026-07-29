import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "plugins/dev-loop/bin/check-deps.sh"


def _run(tmp_path, path_env):
    """以受控 PATH 跑 check-deps.sh,回 (returncode, stdout)。"""
    proc = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=str(tmp_path),
        env={"PATH": path_env},
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout


def _stub(dir_path, name):
    """在 dir_path 造一個叫 name 的可執行 stub,讓 command -v 找得到。"""
    dir_path.mkdir(parents=True, exist_ok=True)
    f = dir_path / name
    f.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    f.chmod(0o755)
    return f


def test_optional_tools_missing_reports_but_exits_zero(tmp_path):
    binp = tmp_path / "bin"
    for name in ("python3", "git", "openspec"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 可選增益未安裝:" in out
    assert "caveman" in out
    assert "code-review-graph" in out
    assert "dev-loop 前置缺少:" not in out


def test_optional_tools_present_no_optional_line(tmp_path):
    binp = tmp_path / "bin"
    for name in ("python3", "git", "openspec", "caveman", "code-review-graph"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_hard_prereq_missing_still_reported_separately(tmp_path):
    binp = tmp_path / "bin"
    for name in ("python3", "git", "caveman", "code-review-graph"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 前置缺少:" in out
    assert "openspec" in out
    assert "dev-loop 可選增益未安裝:" not in out

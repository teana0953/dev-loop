import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "plugins/dev-loop/bin/check-deps.sh"


def _run(tmp_path, path_env, config_dir=None, devloop=False, home=None):
    """以受控 PATH(與可選 CLAUDE_CONFIG_DIR/HOME)跑 check-deps.sh,回 (returncode, stdout)。

    devloop=True 會先在 tmp_path 造 .devloop/,模擬「已在用 dev-loop 的專案」
    ——可選增益提示只該在這種專案裡出現。

    config_dir 給時明講 CLAUDE_CONFIG_DIR;不給時(config_dir=None)讓腳本走
    `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` 的 fallback 半段——此時可另外給 home
    指定 $HOME,模擬「使用者根本沒設 CLAUDE_CONFIG_DIR」這個預設安裝路徑。
    """
    if devloop:
        (tmp_path / ".devloop").mkdir(parents=True, exist_ok=True)
    env = {"PATH": path_env}
    if config_dir is not None:
        env["CLAUDE_CONFIG_DIR"] = str(config_dir)
    if home is not None:
        env["HOME"] = str(home)
    proc = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=str(tmp_path),
        env=env,
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
    """caveman 未裝(乾淨的 CLAUDE_CONFIG_DIR,無 active-flag、無 marketplace 目錄)、
    ocr 不在 PATH,且專案有 .devloop/ → 兩者都該被列出。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec"):
        _stub(binp, name)
    empty_config = tmp_path / "claude-config-empty"
    empty_config.mkdir()
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=empty_config, devloop=True)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" in out
    assert "caveman" in out
    assert "open-code-review" in out
    assert "dev-loop 前置缺少:" not in out


def test_optional_tools_present_no_optional_line_active_flag(tmp_path):
    """caveman 的真實安裝流程寫的是 active-flag 檔(不是 PATH 執行檔),
    ocr 則確實裝到 PATH 上。兩者都在時不該印可選增益提示。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec", "ocr"):
        _stub(binp, name)
    config_dir = tmp_path / "claude-config"
    config_dir.mkdir()
    (config_dir / ".caveman-active").write_text("", encoding="utf-8")
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=config_dir, devloop=True)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_optional_tools_present_via_marketplace_dir(tmp_path):
    """caveman 有時只留下 marketplace 目錄、沒有 active-flag,仍該算已裝。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec", "ocr"):
        _stub(binp, name)
    config_dir = tmp_path / "claude-config"
    (config_dir / "plugins/marketplaces/caveman").mkdir(parents=True)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=config_dir, devloop=True)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_caveman_on_path_alone_is_not_considered_installed(tmp_path):
    """caveman 是 Claude Code plugin,裝完不會留執行檔在 PATH 上——就算 PATH 上
    剛好有個叫 caveman 的東西,沒有 active-flag/marketplace 目錄仍該視為未裝。
    這條鎖的是「偵測真正的安裝痕跡」這個需求,不是鎖 `command -v` 這個舊實作。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec", "caveman", "ocr"):
        _stub(binp, name)
    empty_config = tmp_path / "claude-config-empty"
    empty_config.mkdir()
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=empty_config, devloop=True)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" in out
    assert "caveman" in out


def test_hard_prereq_missing_still_reported_separately(tmp_path):
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "ocr"):
        _stub(binp, name)
    config_dir = tmp_path / "claude-config"
    config_dir.mkdir()
    (config_dir / ".caveman-active").write_text("", encoding="utf-8")
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=config_dir, devloop=True)
    assert code == 0
    assert "dev-loop 前置缺少:" in out
    assert "openspec" in out
    assert "dev-loop 可選增益未安裝:" not in out


def test_node_missing_reported_as_hard_prereq(tmp_path):
    """`node` 是 bin/devloop 的進入點(exec node dist/cli.js),所以跟 python3/git/
    openspec 一樣是硬前置——缺了只提示,不阻斷(exit 0)。"""
    binp = tmp_path / "bin"
    for name in ("python3", "git", "openspec"):
        _stub(binp, name)
    config_dir = tmp_path / "claude-config"
    config_dir.mkdir()
    (config_dir / ".caveman-active").write_text("", encoding="utf-8")
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=config_dir, devloop=True)
    assert code == 0
    assert "dev-loop 前置缺少:" in out
    assert "node" in out


def test_optional_line_suppressed_outside_devloop_project(tmp_path):
    """沒有 .devloop/ 的專案(還沒在用 dev-loop)不該被灌可選增益噪音,
    即使兩個可選工具都真的沒裝——SessionStart hook 每個專案每個 session 都會跑。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec"):
        _stub(binp, name)
    empty_config = tmp_path / "claude-config-empty"
    empty_config.mkdir()
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", config_dir=empty_config, devloop=False)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_home_claude_fallback_detects_caveman_when_config_dir_unset(tmp_path):
    """`CLAUDE_CONFIG_DIR` 未設是預設安裝路徑(使用者沒特別配置)——腳本此時要 fallback
    到 `$HOME/.claude`。既有測試全部明講 CLAUDE_CONFIG_DIR,這條路徑完全沒人鎖:把
    `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` 換成 `${CLAUDE_CONFIG_DIR}` 仍能讓整個既有
    suite 綠,但會弄壞每個沒設這個變數的使用者。這裡故意不傳 config_dir、只傳 home,
    驗證 marker 在 $HOME/.claude 下時視為已裝(不列可選增益)。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec", "ocr"):
        _stub(binp, name)
    home = tmp_path / "home-with-marker"
    (home / ".claude").mkdir(parents=True)
    (home / ".claude" / ".caveman-active").write_text("", encoding="utf-8")
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", devloop=True, home=home)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_home_claude_fallback_reports_caveman_missing_when_config_dir_unset(tmp_path):
    """同上一個測試,但 $HOME/.claude 下沒有 marker(乾淨帳號)——`CLAUDE_CONFIG_DIR`
    未設時仍要正確 fallback 去查 $HOME/.claude,查完發現沒裝,回報 caveman 缺。若
    fallback 被拿掉(改成裸 `${CLAUDE_CONFIG_DIR}`,未設時展開成空字串),腳本會去查
    `/.caveman-active`、`/plugins/marketplaces/caveman`(專案 cwd 底下)而不是
    `$HOME/.claude` 下——這兩個測試合起來鎖住:有 marker 判有裝、無 marker 判沒裝,
    都要透過真正的 $HOME/.claude fallback 路徑做到。"""
    binp = tmp_path / "bin"
    for name in ("node", "python3", "git", "openspec", "ocr"):
        _stub(binp, name)
    home = tmp_path / "home-without-marker"
    (home / ".claude").mkdir(parents=True)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin", devloop=True, home=home)
    assert code == 0
    assert "dev-loop 可選增益未安裝:" in out
    assert "caveman" in out

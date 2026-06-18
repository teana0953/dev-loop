from devloop.openspec import OpenSpecResult, archive_change, validate_change


def test_validate_change_builds_command():
    captured = {}

    def runner(cmd):
        captured["cmd"] = cmd
        return (0, "valid")

    result = validate_change("add-foo", runner=runner)
    assert isinstance(result, OpenSpecResult)
    assert result.ok is True
    assert captured["cmd"] == [
        "openspec",
        "validate",
        "add-foo",
        "--strict",
        "--no-interactive",
    ]
    assert "valid" in result.output


def test_validate_change_failure():
    result = validate_change("bad", runner=lambda cmd: (1, "boom"))
    assert result.ok is False
    assert result.command == [
        "openspec",
        "validate",
        "bad",
        "--strict",
        "--no-interactive",
    ]
    assert "boom" in result.output


def test_archive_change_builds_command():
    captured = {}

    def runner(cmd):
        captured["cmd"] = cmd
        return (0, "archived")

    result = archive_change("add-foo", runner=runner)
    assert result.ok is True
    assert captured["cmd"] == ["openspec", "archive", "add-foo", "--yes"]


def test_archive_change_failure():
    result = archive_change("x", runner=lambda cmd: (2, "err"))
    assert result.ok is False
    assert "err" in result.output

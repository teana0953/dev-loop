from devloop.gate import GateResult, run_gate


def test_all_commands_pass():
    result = run_gate([["true"], ["true"]])
    assert isinstance(result, GateResult)
    assert result.passed is True
    assert result.failed_command is None


def test_first_failing_command_short_circuits():
    result = run_gate([["true"], ["false"], ["true"]])
    assert result.passed is False
    assert result.failed_command == ["false"]


def test_captures_output_on_failure():
    result = run_gate([["sh", "-c", "echo boom >&2; exit 1"]])
    assert result.passed is False
    assert "boom" in result.output


def test_empty_commands_pass():
    assert run_gate([]).passed is True

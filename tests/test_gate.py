import sys
import time

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


def test_timeout_treated_as_failure():
    # 逾時的 gate 命令應視為失敗,而非永久阻塞
    result = run_gate([["sh", "-c", "sleep 5"]], timeout=1)
    assert result.passed is False
    assert result.failed_command == ["sh", "-c", "sleep 5"]
    assert "timeout" in result.output.lower()


def test_output_larger_than_one_mib_is_captured_whole():
    # subprocess.run 沒有輸出上限。TS 那側的 spawnSync 預設 maxBuffer 是 1 MiB,
    # 超過就 ENOBUFS,所以兩邊都得釘住這條(`pytest -v` 本身就常超過)。
    size = 2 * 1024 * 1024
    result = run_gate([[
        sys.executable, "-c",
        "import sys; sys.stdout.write('x' * %d); sys.exit(1)" % size,
    ]])
    assert result.passed is False
    assert len(result.output) == size


def test_timeout_zero_expires_immediately():
    # timeout 是 argparse type=int 沒有下界,0 是合法輸入。Python 的
    # subprocess.run(timeout=0) 立刻 TimeoutExpired(不是「不設限」)。
    started = time.monotonic()
    result = run_gate([["sh", "-c", "sleep 2"]], timeout=0)
    assert result.passed is False
    assert result.failed_command == ["sh", "-c", "sleep 2"]
    assert result.output == "timeout after 0s"
    assert time.monotonic() - started < 1.0


def test_negative_timeout_expires_immediately_and_keeps_the_sign():
    assert run_gate([["sh", "-c", "sleep 2"]], timeout=-1).output == "timeout after -1s"
    assert run_gate([["sh", "-c", "sleep 2"]], timeout=-5).output == "timeout after -5s"

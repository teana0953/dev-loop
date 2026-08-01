"""確保每個 fixtures/parity/*.json 都有人消費——F5。

每個 `test_parity_*.py` 檔內的 `SECTIONS` 只守住「檔內的 section」與「該檔
consumer 讀的 section」一致;但如果整個測試檔被刪掉(或忘了寫),
`fixtures/parity/` 下多出來的一個 module 檔案不會讓任何測試變紅。這裡補上
目錄層級的守門:parity 目錄下的 .json module 集合,必須恰好等於本側消費的
module 集合。

新增第五個 fixture 檔時,必須同步把 module 名字加進下面的 CONSUMED_MODULES,
否則這個測試會紅。
"""
from conftest import PARITY_DIR

CONSUMED_MODULES = {"adapter", "changemeta", "checkpoint", "cli", "config", "followup", "gate", "review", "shlex", "units", "worktree"}


def test_all_parity_fixture_modules_are_consumed():
    found = {p.stem for p in PARITY_DIR.glob("*.json")}
    assert found == CONSUMED_MODULES, (
        "fixtures/parity/*.json modules %s != consumed %s"
        % (sorted(found), sorted(CONSUMED_MODULES))
    )

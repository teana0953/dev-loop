import re

import devloop


def test_package_importable():
    assert hasattr(devloop, "__version__")
    # 不綁死版本號(每次 bump 才不會炸);一致性由 test_packaging 守(== plugin.json)
    assert re.fullmatch(r"\d+\.\d+\.\d+", devloop.__version__)

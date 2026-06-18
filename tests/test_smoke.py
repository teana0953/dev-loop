import devloop


def test_package_importable():
    assert hasattr(devloop, "__version__")
    assert devloop.__version__ == "0.1.0"

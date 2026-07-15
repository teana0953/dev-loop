.PHONY: test

# 全套測試(stdlib-only + pytest;pythonpath 由 pyproject 提供)
test:
	python3 -m pytest -q

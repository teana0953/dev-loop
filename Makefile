SKILL_DIR := $(HOME)/.claude/skills/dev-loop

.PHONY: test install check

test:
	python3 -m pytest -q

# 同步 repo → 全域 skill 安裝副本(引擎 + SKILL.md)。
# 先清舊 .py 再 cp:repo 刪掉的模組不得殘留在安裝側。
install:
	mkdir -p $(SKILL_DIR)/engine/devloop
	rm -f $(SKILL_DIR)/engine/devloop/*.py
	cp devloop/*.py $(SKILL_DIR)/engine/devloop/
	cp skills/dev-loop/SKILL.md $(SKILL_DIR)/SKILL.md
	@echo "installed -> $(SKILL_DIR)"

# 檢查安裝副本是否漂移(過期/殘留);有差 exit 1 並提示 make install。
check:
	@diff -r -x '__pycache__' -x '.DS_Store' devloop $(SKILL_DIR)/engine/devloop \
		&& diff skills/dev-loop/SKILL.md $(SKILL_DIR)/SKILL.md \
		&& echo "in sync: $(SKILL_DIR)" \
		|| { echo "DRIFT detected: run 'make install'"; exit 1; }

# Dev-Loop → Claude Code Plugin 打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 dev-loop 重構成「`plugins/dev-loop/` 即正本」的可直接安裝 Claude Code plugin,使用者 `/plugin marketplace add <repo>` + `/plugin install` 即可用。

**Architecture:** 方案 D——`git mv` 把引擎/skill/command 搬進 `plugins/dev-loop/` 當唯一正本,repo 根當 marketplace(`.claude-plugin/marketplace.json`)。引擎呼叫全改裸 `devloop`(靠 plugin `bin/` 進 PATH),夾帶 `bin/devloop` wrapper 自定位 PYTHONPATH。SessionStart hook 做首跑相依/專案就緒檢查,SKILL 首跑問答加 `finish`。`make install`/`make check` 移除。

**Tech Stack:** Python 3(stdlib only)、pytest、bash、git、Claude Code plugin 格式(`.claude-plugin/`、`${CLAUDE_PLUGIN_ROOT}`、`bin/` on PATH)。

**Spec:** `docs/superpowers/specs/2026-07-15-devloop-claude-code-plugin-design.md`

## Global Constraints

- 語言:繁體中文註解/docstring,對齊現有風格。
- 依賴:僅標準庫;不引第三方。
- plugin `version` = `0.1.0`,對齊 `devloop/__init__.py` 的 `__version__`(已是 0.1.0)。
- 唯一引擎行為改動:`next_hint` 前綴 `python3 -m devloop.cli` → `devloop`。唯一 SKILL 行為增強:首跑多問 `finish`。其餘為搬檔 + 打包,不改行為。
- 遷移後測試維持綠(基線 313 passed;Task 5 後 +2 = 315)。
- `bin/` 內腳本需可執行位(`chmod +x`,git 追蹤該 bit)。
- `.devloop/...` 相對路徑一律不動(屬使用者專案,非 plugin)。

---

### Task 1: 遷移檔案為 plugin 正本 + pyproject pythonpath

**Files:**
- Move: `devloop/` → `plugins/dev-loop/devloop/`
- Move: `skills/dev-loop/` → `plugins/dev-loop/skills/dev-loop/`
- Move: `.claude/commands/dev-loop.md` → `plugins/dev-loop/commands/dev-loop.md`
- Modify: `pyproject.toml:2`
- Test: 既有全套(`tests/`,不搬)

**Interfaces:**
- Produces: 引擎 import 名稱不變(`import devloop`),但實體位於 `plugins/dev-loop/devloop/`;pytest 靠 `pythonpath = ["plugins/dev-loop"]` 解析。後續所有 task 的引擎/skill/command 檔案路徑都以新位置為準。

- [ ] **Step 1: 搬檔(git mv,保留歷史)**

```bash
mkdir -p plugins/dev-loop
git mv devloop plugins/dev-loop/devloop
git mv skills/dev-loop plugins/dev-loop/skills/dev-loop
mkdir -p plugins/dev-loop/commands
git mv .claude/commands/dev-loop.md plugins/dev-loop/commands/dev-loop.md
```

- [ ] **Step 2: 改 pytest pythonpath**

`pyproject.toml` 第 2 行:

```toml
[tool.pytest.ini_options]
pythonpath = ["plugins/dev-loop"]
testpaths = ["tests"]
```

- [ ] **Step 3: 跑全套確認搬移未改行為**

Run: `python3 -m pytest -q`
Expected: `313 passed`(與搬移前一致;`import devloop` 由新 pythonpath 解析)。若有測試因 hardcode 舊路徑而紅,該測試的路徑改為新位置後再跑。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(plugin): 搬引擎/skill/command 進 plugins/dev-loop 正本 + pyproject pythonpath"
```

---

### Task 2: 引擎 next_hint 前綴改裸 `devloop`(TDD)

**Files:**
- Modify: `tests/test_statemachine.py:239`
- Modify: `tests/test_cli.py:1504`
- Modify: `plugins/dev-loop/devloop/statemachine.py`(9 處字串)

**Interfaces:**
- Consumes: Task 1 的新引擎位置。
- Produces: `next_hint` 印出的骨架前綴為 `devloop`(如 `next: devloop gate --file <cp>`),供 plugin 情境裸命令直接執行。

- [ ] **Step 1: 先改兩條全字串斷言(TDD:先讓測試表達新行為)**

`tests/test_statemachine.py:239`:

```python
    assert hint == "next: devloop gate --file cp.json"
```

`tests/test_cli.py:1504`:

```python
    assert lines[1] == "next: devloop gate --file %s" % cp_path
```

- [ ] **Step 2: 跑這兩條確認失敗**

Run: `python3 -m pytest "tests/test_statemachine.py::test_next_hint_gate_with_config_cmds_gives_full_command" "tests/test_cli.py::test_status_gate_hint_is_fully_executable_with_config_cmds" -q`
Expected: FAIL(斷言 `devloop gate` 但實際仍印 `python3 -m devloop.cli gate`)。

- [ ] **Step 3: 改 statemachine 的 9 處前綴**

`plugins/dev-loop/devloop/statemachine.py`,把全部 `python3 -m devloop.cli` 換成 `devloop`(行 51/53/55/57/59/87/90/95/100)。可用:

```bash
sed -i '' 's/python3 -m devloop\.cli/devloop/g' plugins/dev-loop/devloop/statemachine.py
```

改後該 9 行例:
- `lambda f: "next: devloop proposal-review --file %s --report <pr.json>" % f,`
- `lambda f: 'next: devloop gate --file %s --cmd "<test-cmd>" [--cmd "<lint-cmd>"]' % f,`
- `return "next: devloop gate --file %s" % checkpoint_path`
- `return ("next: devloop teardown --file %s --repo . --mode %s" ...`
- `"next: units pending: %s -> devloop units-status --file %s"`
- `"next: legs pending: %s -> devloop leg-done --file %s ..."`

- [ ] **Step 4: 跑全套確認綠**

Run: `python3 -m pytest -q`
Expected: `313 passed`(兩條斷言現通過,其餘不回歸)。

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-loop/devloop/statemachine.py tests/test_statemachine.py tests/test_cli.py
git commit -m "feat(engine): next_hint 前綴改裸 devloop(plugin bin/ on PATH)"
```

---

### Task 3: SKILL + command 內文改裸 `devloop`(機械)

**Files:**
- Modify: `plugins/dev-loop/skills/dev-loop/SKILL.md`(16 處)
- Modify: `plugins/dev-loop/commands/dev-loop.md`(8 處)

**Interfaces:**
- Consumes: Task 2 的裸命令約定。
- Produces: skill/command 內文所有引擎呼叫為裸 `devloop <args>`。

- [ ] **Step 1: 機械替換兩檔**

```bash
sed -i '' 's/python3 -m devloop\.cli/devloop/g' plugins/dev-loop/skills/dev-loop/SKILL.md
sed -i '' 's/python3 -m devloop\.cli/devloop/g' plugins/dev-loop/commands/dev-loop.md
```

- [ ] **Step 2: 驗證無殘留**

Run: `grep -rn "python3 -m devloop.cli" plugins/dev-loop/skills plugins/dev-loop/commands`
Expected: 無輸出(全部已替換)。

- [ ] **Step 3: 人工掃一遍**

讀兩檔的 diff,確認替換只動命令前綴、未誤改敘述文字(尤其 SKILL.md Resume 段的 `next:` 骨架說明、command 檔的 `$CP` 變數用法應完好)。

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-loop/skills/dev-loop/SKILL.md plugins/dev-loop/commands/dev-loop.md
git commit -m "docs(skill,command): 引擎呼叫改裸 devloop"
```

---

### Task 4: SKILL 首跑問答擴充 `finish`

**Files:**
- Modify: `plugins/dev-loop/skills/dev-loop/SKILL.md`(「## 設定」的 finish 條 + 核心迴圈步驟 1)

**Interfaces:**
- Produces: 首跑一次問齊由 `superpowers`/`auto_approve` 擴為含 `finish`;`config.finish` 為 None(未設)時才問。不動引擎(`resolve_finish` 不變)。

- [ ] **Step 1: 改「## 設定」的 finish 條**

把 SKILL.md「## 設定」段的 finish 條目末尾補上首跑說明。原句:

```markdown
- `finish`:收尾策略 `merge`|`pr`|`ask`(未設等同 `ask`);可被 `.devloop/changes/<id>.json` 的 `finish` override。
```

改為:

```markdown
- `finish`:收尾策略 `merge`|`pr`|`ask`(未設等同 `ask`);可被 `.devloop/changes/<id>.json` 的 `finish` override。**未設 → 第一次啟動時一併問使用者並寫回**(同 `superpowers`/`auto_approve`)。
```

- [ ] **Step 2: 改核心迴圈步驟 1 的首跑問答清單**

把步驟 1 中「`superpowers` 或 `auto_approve` 有未設的就 ✋ 一次問齊使用者(用不用 superpowers 流程;批准關卡要人工還是自動)並寫回 config」這句,擴為含 finish:

```markdown
沒有 checkpoint 就是第一次啟動——先讀 `.devloop/config.json`,`superpowers`、`auto_approve` 或 `finish` 有未設的就 ✋ 一次問齊使用者(用不用 superpowers 流程;批准關卡要人工還是自動;收尾策略 merge/pr/ask)並寫回 config(之後不再問),然後從「流程」步驟 1 開始。
```

- [ ] **Step 3: 人工檢查**

確認兩處措辭一致、`finish` 已納入首問清單、未改到其他語義。

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-loop/skills/dev-loop/SKILL.md
git commit -m "feat(skill): 首跑問答擴充 finish(一次問齊三鍵)"
```

---

### Task 5: plugin 骨架 + marketplace + 版本一致性測試

**Files:**
- Create: `plugins/dev-loop/.claude-plugin/plugin.json`
- Create: `plugins/dev-loop/bin/devloop`(chmod +x)
- Create: `plugins/dev-loop/bin/check-deps.sh`(chmod +x)
- Create: `plugins/dev-loop/hooks/hooks.json`
- Create: `.claude-plugin/marketplace.json`(repo 根)
- Create: `tests/test_packaging.py`

**Interfaces:**
- Consumes: `devloop.__version__`(= "0.1.0")。
- Produces: 完整可安裝 plugin 骨架;`tests/test_packaging.py` 守 version 一致 + marketplace 結構。

- [ ] **Step 1: 先寫失敗測試 `tests/test_packaging.py`**

```python
import json
from pathlib import Path

import devloop

ROOT = Path(__file__).resolve().parent.parent  # repo 根


def test_plugin_version_matches_dunder():
    manifest = json.loads(
        (ROOT / "plugins/dev-loop/.claude-plugin/plugin.json").read_text(encoding="utf-8"))
    assert manifest["version"] == devloop.__version__


def test_marketplace_lists_plugin_with_source():
    mkt = json.loads(
        (ROOT / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    entry = next(p for p in mkt["plugins"] if p["name"] == "dev-loop")
    assert entry["source"] == "./plugins/dev-loop"
```

- [ ] **Step 2: 跑確認失敗**

Run: `python3 -m pytest tests/test_packaging.py -q`
Expected: FAIL — `FileNotFoundError`(manifest 尚未建立)。

- [ ] **Step 3: 建 plugin.json**

`plugins/dev-loop/.claude-plugin/plugin.json`:

```json
{
  "name": "dev-loop",
  "version": "0.1.0",
  "description": "固定流程的 agent 開發 loop:brainstorm→OpenSpec→TDD→review→自動 merge,含 trunk-based 收尾與 teardown 清殘留。需 python3/git/openspec。",
  "author": { "name": "Tina Liang", "email": "teana0953@gmail.com" },
  "license": "MIT"
}
```

- [ ] **Step 4: 建 wrapper `plugins/dev-loop/bin/devloop`**

```bash
#!/usr/bin/env bash
# dev-loop 引擎 wrapper:自定位 plugin/repo 根(bin/ 的上一層),設 PYTHONPATH 後轉呼叫 CLI。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = plugins/dev-loop(內含 devloop/)
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m devloop.cli "$@"
```

`chmod +x plugins/dev-loop/bin/devloop`

- [ ] **Step 5: 建 `plugins/dev-loop/bin/check-deps.sh`**

```bash
#!/usr/bin/env bash
# dev-loop 首跑檢查:缺工具/專案未就緒只提示不阻斷(exit 0)。
missing=()
command -v python3  >/dev/null 2>&1 || missing+=("python3")
command -v git      >/dev/null 2>&1 || missing+=("git")
command -v openspec >/dev/null 2>&1 || missing+=("openspec(npm i -g openspec)")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'dev-loop 前置缺少:%s\n' "${missing[*]}" >&2
fi
if command -v openspec >/dev/null 2>&1 && [ ! -d openspec ]; then
  printf 'dev-loop:當前專案尚未初始化 OpenSpec,執行 `openspec init --tools claude`。\n' >&2
fi
exit 0
```

`chmod +x plugins/dev-loop/bin/check-deps.sh`

- [ ] **Step 6: 建 `plugins/dev-loop/hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/check-deps.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: 建 `.claude-plugin/marketplace.json`(repo 根)**

```json
{
  "name": "dev-loop",
  "owner": { "name": "Tina Liang", "email": "teana0953@gmail.com" },
  "description": "dev-loop plugin 的自帶 marketplace。",
  "plugins": [
    {
      "name": "dev-loop",
      "source": "./plugins/dev-loop",
      "description": "固定流程 agent 開發 loop(需 python3/git/openspec CLI)。"
    }
  ]
}
```

- [ ] **Step 8: 跑測試 + 驗 wrapper**

Run: `python3 -m pytest tests/test_packaging.py -q && python3 -m pytest -q`
Expected: `test_packaging.py` 2 passed;全套 `315 passed`。

驗 wrapper 從任意 cwd 可跑(用臨時 checkpoint):

```bash
tmp=$(mktemp -d); python3 -m pytest -q >/dev/null 2>&1
( cd "$tmp" && python3 -c "import json,sys" ) # sanity
plugins/dev-loop/bin/devloop start --file "$tmp/cp.json" --change-id x --branch b --phase apply >/dev/null && \
plugins/dev-loop/bin/devloop status --file "$tmp/cp.json" | head -2
```
Expected: status 印出 `phase=apply` 與第二行 `next: devloop ...`(wrapper 從 repo 外 cwd 仍 import 到引擎)。

- [ ] **Step 9: 驗 check-deps 行為**

```bash
plugins/dev-loop/bin/check-deps.sh; echo "exit=$?"          # 於 repo 根(有 openspec/)→ 靜默 exit=0
( cd /tmp && bash <repo>/plugins/dev-loop/bin/check-deps.sh ); echo "exit=$?"  # 無 openspec/ → stderr 印未 init 提示、exit=0
```
Expected: 皆 exit 0;第二次 stderr 有「尚未初始化 OpenSpec」。

- [ ] **Step 10: Commit**

```bash
git add plugins/dev-loop/.claude-plugin plugins/dev-loop/bin plugins/dev-loop/hooks .claude-plugin tests/test_packaging.py
git commit -m "feat(plugin): plugin.json/wrapper/check-deps/hooks/marketplace + 版本一致性測試"
```

---

### Task 6: Makefile 精簡 + README 改寫

**Files:**
- Modify: `Makefile`(移除 install/check,保留 test)
- Modify: `README.md`(安裝/使用改 plugin;移除全域 skill 敘述)

**Interfaces:**
- Consumes: 前述所有 plugin 檔案就位。

- [ ] **Step 1: 精簡 Makefile**

整檔replace為:

```makefile
.PHONY: test

# 全套測試(stdlib-only + pytest;pythonpath 由 pyproject 提供)
test:
	python3 -m pytest -q
```

> 移除 `install`/`check`:散布改走 plugin,不再有全域 skill 複製與 repo↔安裝副本漂移面(版本一致性由 `tests/test_packaging.py` 守)。

- [ ] **Step 2: 改 README 安裝段**

把 README 中「`dev-loop` 已安裝成使用者層級 skill(`~/.claude/skills/dev-loop/`)、`make install`」相關敘述(約 line 16、112、115-116、120)改為 plugin 安裝流程:

```markdown
## 安裝

前置:`python3`、`git`、`openspec`(`npm i -g openspec`)。

    /plugin marketplace add <本 repo 的 git URL 或本地路徑>
    /plugin install dev-loop@dev-loop
    /dev-loop        # 首跑會問 superpowers/auto_approve/finish;SessionStart 檢查前置與 openspec init

本 repo 根即 marketplace,plugin 正本在 `plugins/dev-loop/`;引擎、skill、command、wrapper 皆在其下,無 build、無安裝副本。
```

- [ ] **Step 3: 改 README 手動驅動範例路徑**

把 line 53-56、104 附近 `~/.claude/skills/dev-loop/devloop <子命令>` 的範例改為:plugin 情境用裸 `devloop <子命令>`;repo 內手動用 `PYTHONPATH=plugins/dev-loop python3 -m devloop.cli <子命令>`。移除 line 112「原始碼家 / 安裝副本」與 line 120「同步安裝副本」等已不適用敘述。

- [ ] **Step 4: 跑全套(確認文件改動未碰壞測試)**

Run: `python3 -m pytest -q`
Expected: `315 passed`。

- [ ] **Step 5: Commit**

```bash
git add Makefile README.md
git commit -m "docs(build,readme): 移除 make install/check,改 plugin 安裝敘述"
```

---

## Self-Review

**1. Spec coverage**(對照 `2026-07-15-...-design.md`):
- §2/§3 方案 D 遷移 → Task 1。✅
- §4.1 wrapper → Task 5 Step 4;§4.2 SKILL/command 裸命令 → Task 3;§4.3 引擎 hint + 測試 → Task 2。✅
- §5 plugin.json(version 0.1.0) → Task 5 Step 3。✅
- §6 marketplace.json(不帶 version) → Task 5 Step 7。✅
- §7.1/7.2 hooks + check-deps(相依 + openspec init) → Task 5 Step 5/6;§7.3 finish 首問 → Task 4。✅
- §8 Makefile 移除 install/check + 版本一致性測試 → Task 6 Step 1 + Task 5 Step 1。✅
- §9 README → Task 6 Step 2/3。✅
- §11 驗收各項散落於各 task 的 Step(全套綠、wrapper、check-deps、packaging 測試)。✅
- §12 open item(marketplace entry 是否需 version)→ 由最終人工 install 冒煙確認(見下)。

**2. Placeholder scan:** 無 TBD/TODO;每個 code step 給完整內容與可執行命令。README 改動以「原句→改為」具體呈現;`<repo>`/`<git URL>` 為使用者實填佔位,非計畫缺漏。

**3. Type consistency:** `devloop.__version__`(0.1.0)↔ plugin.json `version` 一致由 test_packaging 守;裸 `devloop` 前綴在 Task 2(引擎)/Task 3(prose)一致;wrapper `ROOT` 指向 `plugins/dev-loop`(含 `devloop/`)與 §3 佈局一致。

**最終人工步驟(不列為 subagent task,由使用者/控制者執行):** 本機 `/plugin marketplace add <repo 路徑>` + `/plugin install dev-loop@dev-loop`,冒煙 `/dev-loop` 啟動、裸 `devloop status` 可跑、SessionStart 提示正常;若 install 報 marketplace entry 需 `version`,補到 `.claude-plugin/marketplace.json` 的 plugins[0] 並讓 test_packaging 一併斷言(解 §12 open item)。

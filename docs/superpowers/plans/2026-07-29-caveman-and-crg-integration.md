# caveman + code-review-graph 整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 caveman(輸出壓縮)與 code-review-graph(結構圖選檔)接進 dev-loop plugin,兩者皆可選、缺失時優雅降級。

**Architecture:** caveman 純前置依賴(check-deps 偵測 + docs),不寫編排邏輯——它是 session hook,裝了自動作用於 loop 內所有 subagent。code-review-graph 是前置依賴 + 編排:SKILL.md 在三處主動呼叫 CLI(起手 build、apply 後 update、review 前算 blast-radius 選檔),全部寫在編排層而非 `devloop` 引擎 CLI——引擎守確定性狀態機,外部工具副作用失敗不該污染 checkpoint。

**Tech Stack:** bash(check-deps.sh)、markdown(SKILL.md / README / command doc)、Python 3.10+ 與 pytest(測試)。

## Global Constraints

- 兩工具皆**可選增益**,非硬前置。`check-deps.sh` 必須維持 `exit 0`,缺失只提示不阻斷。
- 缺失降級行為:caveman 缺 → loop 照跑不壓縮;code-review-graph 缺(或無 `.code-review-graph/`)→ build/update 靜默略過、review 退回讀整包 diff。
- 不改 `plugins/dev-loop/devloop/` 下任何引擎 Python 模組。
- 不接 code-review-graph 的 MCP server / daemon / watch / embedding / wiki。
- lint 規則集固定為 `select = ["E4","E7","E9","F"]`(pyproject 已設);新增測試須通過 `ruff check plugins/dev-loop/devloop tests`。
- 測試以 `python3 -m pytest -q` 全綠為準(現有 356 項不得回歸)。
- 已驗真實 CLI 接口,實作須照抄不得臆造:
  - `code-review-graph build -q`
  - `code-review-graph update -q --base <ref>`
  - `code-review-graph impact --files <file...> --depth 2 --max-results N`(輸出 JSON,含 `impacted_files`、`context_savings`)

---

### Task 1: check-deps.sh 加可選工具偵測

**Files:**
- Modify: `plugins/dev-loop/bin/check-deps.sh`
- Test: `tests/test_check_deps.py`(建立)

**Interfaces:**
- Consumes: 無(第一個 task)
- Produces: `check-deps.sh` 的新輸出契約——缺可選工具時印出開頭為 `dev-loop 可選增益未安裝:` 的一行;硬前置缺失維持既有 `dev-loop 前置缺少:` 行;兩者皆 `exit 0`。Task 4 的 README 文案需與此處提示字串一致。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/test_check_deps.py`:

```python
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "plugins/dev-loop/bin/check-deps.sh"


def _run(tmp_path, path_env):
    """以受控 PATH 跑 check-deps.sh,回 (returncode, stdout)。"""
    proc = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=str(tmp_path),
        env={"PATH": path_env},
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
    binp = tmp_path / "bin"
    for name in ("python3", "git", "openspec"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 可選增益未安裝:" in out
    assert "caveman" in out
    assert "code-review-graph" in out
    assert "dev-loop 前置缺少:" not in out


def test_optional_tools_present_no_optional_line(tmp_path):
    binp = tmp_path / "bin"
    for name in ("python3", "git", "openspec", "caveman", "code-review-graph"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 可選增益未安裝:" not in out


def test_hard_prereq_missing_still_reported_separately(tmp_path):
    binp = tmp_path / "bin"
    for name in ("python3", "git", "caveman", "code-review-graph"):
        _stub(binp, name)
    code, out = _run(tmp_path, f"{binp}:/usr/bin:/bin")
    assert code == 0
    assert "dev-loop 前置缺少:" in out
    assert "openspec" in out
    assert "dev-loop 可選增益未安裝:" not in out
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_check_deps.py -v`
Expected: FAIL — `test_optional_tools_missing_reports_but_exits_zero` 與 `test_hard_prereq_missing_still_reported_separately` 因輸出無 `可選增益未安裝` 字串而 assert 失敗。

- [ ] **Step 3: 改 check-deps.sh**

把 `plugins/dev-loop/bin/check-deps.sh` 改成:

```bash
#!/usr/bin/env bash
# dev-loop 首跑檢查:缺工具/專案未就緒只提示不阻斷(exit 0)。
missing=()
command -v python3  >/dev/null 2>&1 || missing+=("python3")
command -v git      >/dev/null 2>&1 || missing+=("git")
command -v openspec >/dev/null 2>&1 || missing+=("openspec(npm i -g @fission-ai/openspec)")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'dev-loop 前置缺少:%s\n' "${missing[*]}"
fi
# 可選增益:缺了 loop 照跑(caveman 不壓縮;code-review-graph 的 build/update
# 與 review 選檔靜默略過、退回讀整包 diff),故與硬前置分開列。
optional=()
command -v caveman           >/dev/null 2>&1 || optional+=("caveman(省 output token;裝法見 README)")
command -v code-review-graph >/dev/null 2>&1 || optional+=("code-review-graph(review 選檔;pip install code-review-graph)")
if [ ${#optional[@]} -gt 0 ]; then
  printf 'dev-loop 可選增益未安裝:%s\n' "${optional[*]}"
fi
# openspec init 提示只對「已在用 dev-loop 的專案」(有 .devloop/)發出,
# 避免對其他專案每個 session 注入噪音;新專案的引導由 /dev-loop 無參數說明負責。
if [ -d .devloop ] && command -v openspec >/dev/null 2>&1 && [ ! -d openspec ]; then
  printf 'dev-loop:當前專案尚未初始化 OpenSpec,執行 `openspec init --tools claude`。\n'
fi
exit 0
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_check_deps.py -v`
Expected: PASS(3 項全過)

- [ ] **Step 5: 跑全套測試不回歸**

Run: `python3 -m pytest -q`
Expected: 全綠,無 failure。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/bin/check-deps.sh tests/test_check_deps.py
git commit -m "feat: detect caveman and code-review-graph as optional deps"
```

---

### Task 2: .gitignore 排除圖資料

**Files:**
- Modify: `.gitignore`
- Test: `tests/test_packaging.py`(既有檔,加一個測試函式)

**Interfaces:**
- Consumes: 無
- Produces: repo 根 `.gitignore` 含 `.code-review-graph/` 一行。Task 4 README 會提示使用者專案比照辦理。

- [ ] **Step 1: 寫失敗測試**

在 `tests/test_packaging.py` 末尾追加:

```python
def test_gitignore_excludes_code_review_graph_data():
    lines = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".code-review-graph/" in [ln.strip() for ln in lines]
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_packaging.py::test_gitignore_excludes_code_review_graph_data -v`
Expected: FAIL with AssertionError

- [ ] **Step 3: 改 .gitignore**

把 `.gitignore` 改成:

```
__pycache__/
*.pyc
.pytest_cache/
.devloop/
.code-review-graph/
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest tests/test_packaging.py -v`
Expected: PASS(3 項全過)

- [ ] **Step 5: Commit**

```bash
git add .gitignore tests/test_packaging.py
git commit -m "chore: gitignore code-review-graph data dir"
```

---

### Task 3: SKILL.md 三個 code-review-graph 編排接點

**Files:**
- Modify: `plugins/dev-loop/skills/dev-loop/SKILL.md`
- Test: `tests/test_skill_doc.py`(建立)

**Interfaces:**
- Consumes: Task 1 建立的「可選工具」語意(缺失即降級)
- Produces: SKILL.md 內三段編排指示,分別出現於「核心迴圈」第 1 點、「流程」步驟 5、「流程」步驟 8。測試以字串比對鎖住三個 CLI 命令與降級敘述。

本 task 只改文件(SKILL.md 是 agent 的編排指示,即產品行為),測試用文件內容比對確保指示不遺漏、命令不被改寫成臆造形式。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/test_skill_doc.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "plugins/dev-loop/skills/dev-loop/SKILL.md"


def _text():
    return SKILL.read_text(encoding="utf-8")


def test_skill_documents_graph_build_on_first_start():
    t = _text()
    assert "code-review-graph build -q" in t
    assert ".code-review-graph/" in t


def test_skill_documents_graph_update_after_apply():
    assert "code-review-graph update -q --base" in _text()


def test_skill_documents_graph_impact_for_review():
    t = _text()
    assert "code-review-graph impact --files" in t
    assert "impacted_files" in t


def test_skill_documents_graceful_degradation():
    """缺工具/缺圖時必須明講降級,不能只寫 happy path。"""
    t = _text()
    assert "退回" in t and "整包 diff" in t
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_skill_doc.py -v`
Expected: FAIL(4 項全失敗,SKILL.md 尚無這些字串)

- [ ] **Step 3: 改 SKILL.md — 接點 A(起手 build)**

在「## 核心迴圈」第 1 點末尾(`然後從「流程」步驟 1 開始。` 之後)接上這段:

```markdown
   **順手備妥 code-review-graph(可選)**:若 `command -v code-review-graph` 成功且專案無 `.code-review-graph/`,跑 `code-review-graph build -q` 建圖(供步驟 8 review 選檔用);已有圖或工具未安裝就跳過。此步驟純增益,失敗一律忽略、不影響 loop 推進,也不寫 checkpoint。
```

- [ ] **Step 4: 改 SKILL.md — 接點 B(apply 後 update)**

「## 流程」步驟 5 最後一行原為:

```markdown
   - 完成後 `event --event apply_done`。
```

改成:

```markdown
   - **同步 code-review-graph(可選)**:完成後、送事件前,若工具在且專案有 `.code-review-graph/`,跑 `code-review-graph update -q --base <trunk>` 增量同步(平行 worktree 已 merge 回短命分支後跑一次即可)。工具或圖不在就跳過;失敗忽略,不影響 loop。
   - 完成後 `event --event apply_done`。
```

- [ ] **Step 5: 改 SKILL.md — 接點 C(review 選檔)**

「## 流程」步驟 8 開頭原為:

```markdown
8. **Review(code ‖ uiux 平行 legs)**:`legs-init --kinds code[,uiux]`
```

在該步驟的 `legs-init` 說明之前插入選檔段落,使步驟 8 開頭變成:

```markdown
8. **Review(code ‖ uiux 平行 legs)**:
   **先決定 reviewer 的閱讀範圍**:若 `command -v code-review-graph` 成功且專案有 `.code-review-graph/`,跑

   ```
   code-review-graph impact --files <本次改動檔...> --depth 2 --max-results 50
   ```

   取回 JSON 的 `impacted_files`(caller/dependent/test 相關檔),把 `impacted_files ∪ 改動檔` 當各 leg subagent 的閱讀範圍,取代讀整包 diff(JSON 另附 `context_savings` 省 token 估算,僅供參考)。**工具不在、圖不在或命令非 0 退出 → 退回現行做法:讀整包 diff**。code leg 與 uiux leg 同吃這份範圍。

   接著 `legs-init --kinds code[,uiux]`
```

(步驟 8 其餘內容——uiux 條件、model 決策、coverage-first、`--from-legs` 分級前進——原樣保留不動。)

- [ ] **Step 6: 跑測試確認通過**

Run: `python3 -m pytest tests/test_skill_doc.py -v`
Expected: PASS(4 項全過)

- [ ] **Step 7: 跑全套測試不回歸**

Run: `python3 -m pytest -q`
Expected: 全綠。

- [ ] **Step 8: Commit**

```bash
git add plugins/dev-loop/skills/dev-loop/SKILL.md tests/test_skill_doc.py
git commit -m "feat: wire code-review-graph into loop build/update/review"
```

---

### Task 4: README 與 command doc 同步文案

**Files:**
- Modify: `README.md`(「安裝(參考)」的前置行、「準備專案」段)
- Modify: `plugins/dev-loop/commands/dev-loop.md`(「順手檢查前置」段)
- Test: `tests/test_docs_consistency.py`(建立)

**Interfaces:**
- Consumes: Task 1 的提示字串語意(可選增益)、Task 2 的 `.gitignore` 慣例、Task 3 的 CLI 命令
- Produces: 使用者可見的安裝說明。測試鎖住 README 與 command doc 都列出兩個可選工具及其正確安裝命令。

- [ ] **Step 1: 寫失敗測試**

建立 `tests/test_docs_consistency.py`:

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
CMD = ROOT / "plugins/dev-loop/commands/dev-loop.md"


def test_readme_lists_optional_tools_with_install_commands():
    t = README.read_text(encoding="utf-8")
    assert "pip install code-review-graph" in t
    assert "caveman" in t
    assert "JuliusBrussee/caveman" in t


def test_readme_tells_projects_to_gitignore_graph_data():
    assert ".code-review-graph/" in README.read_text(encoding="utf-8")


def test_command_doc_mentions_optional_tools():
    t = CMD.read_text(encoding="utf-8")
    assert "caveman" in t
    assert "code-review-graph" in t
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest tests/test_docs_consistency.py -v`
Expected: FAIL(3 項全失敗)

- [ ] **Step 3: 改 README 前置行**

README 現有這行:

```markdown
前置:`python3`(3.10+)、`git`、`openspec`(`npm i -g @fission-ai/openspec`)。
```

改成:

```markdown
前置:`python3`(3.10+)、`git`、`openspec`(`npm i -g @fission-ai/openspec`)。

可選增益(缺了 loop 照跑,只是少了對應好處):

- `caveman`——壓縮 agent 輸出省 token,裝了自動作用於 loop 內所有 subagent。安裝:`curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash`(需 Node ≥18)。
- `code-review-graph`——建專案結構圖,review 階段只餵相關檔給 reviewer subagent。安裝:`pip install code-review-graph`(需 Python 3.10+)。loop 起手會自動 build、apply 後自動 update;缺它則 review 退回讀整包 diff。
```

- [ ] **Step 4: 改 README「準備專案」段**

README Quickstart 第 2 步現為:

```markdown
2. **準備專案**(每個新專案一次):

   ```bash
   cd /your/project
   git init                       # 若還不是 git repo
   openspec init --tools claude   # 初始化 OpenSpec
   ```
```

改成:

```markdown
2. **準備專案**(每個新專案一次):

   ```bash
   cd /your/project
   git init                       # 若還不是 git repo
   openspec init --tools claude   # 初始化 OpenSpec
   echo '.code-review-graph/' >> .gitignore   # 有裝 code-review-graph 才需要
   ```
```

- [ ] **Step 5: 改 command doc 前置檢查段**

`plugins/dev-loop/commands/dev-loop.md` 現有這行:

```markdown
  - `python3` / `git` / `openspec` 都在嗎?(缺 openspec:`npm i -g @fission-ai/openspec`)
```

在其後插入一行:

```markdown
  - 可選增益 `caveman`(省 token)/ `code-review-graph`(review 選檔)在嗎?缺了照跑,想裝見 README。
```

- [ ] **Step 6: 跑測試確認通過**

Run: `python3 -m pytest tests/test_docs_consistency.py -v`
Expected: PASS(3 項全過)

- [ ] **Step 7: 跑全套測試 + lint**

Run: `python3 -m pytest -q && python3 -m ruff check plugins/dev-loop/devloop tests`
Expected: 測試全綠;ruff 印 `All checks passed!`

- [ ] **Step 8: Commit**

```bash
git add README.md plugins/dev-loop/commands/dev-loop.md tests/test_docs_consistency.py
git commit -m "docs: document caveman and code-review-graph as optional deps"
```

---

### Task 5: 版號 bump 與收尾驗證

**Files:**
- Modify: `plugins/dev-loop/.claude-plugin/plugin.json`
- Modify: `plugins/dev-loop/devloop/__init__.py`

**Interfaces:**
- Consumes: Task 1–4 的全部改動
- Produces: 版本 0.6.0(新增功能,minor bump)。`tests/test_packaging.py::test_plugin_version_matches_dunder` 要求兩檔版號一致——兩處必須同時改,只改一處會紅。

- [ ] **Step 1: 確認現況版號**

Run: `grep -n version plugins/dev-loop/.claude-plugin/plugin.json plugins/dev-loop/devloop/__init__.py`
Expected: 兩處皆 `0.5.1`

- [ ] **Step 2: 改 plugin.json**

把 `plugins/dev-loop/.claude-plugin/plugin.json` 的:

```json
  "version": "0.5.1",
```

改成:

```json
  "version": "0.6.0",
```

- [ ] **Step 3: 改 __init__.py**

把 `plugins/dev-loop/devloop/__init__.py` 的:

```python
__version__ = "0.5.1"
```

改成:

```python
__version__ = "0.6.0"
```

- [ ] **Step 4: 跑全套測試 + lint 確認一致**

Run: `python3 -m pytest -q && python3 -m ruff check plugins/dev-loop/devloop tests`
Expected: 測試全綠(含 `test_plugin_version_matches_dunder`);ruff 印 `All checks passed!`

- [ ] **Step 5: 手動冒煙驗降級路徑**

Run:

```bash
env PATH=/usr/bin:/bin bash plugins/dev-loop/bin/check-deps.sh; echo "exit=$?"
```

Expected: 印出前置缺少與可選增益未安裝兩行,末行 `exit=0`(缺工具不阻斷)。

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-loop/.claude-plugin/plugin.json plugins/dev-loop/devloop/__init__.py
git commit -m "chore: bump version to 0.6.0"
```

---

## 實作後驗收

全部 task 完成後應成立:

- `python3 -m pytest -q` 全綠(原有 356 項 + 新增 10 項)。
- `python3 -m ruff check plugins/dev-loop/devloop tests` 印 `All checks passed!`
- 兩工具都沒裝時跑 check-deps.sh 仍 `exit 0`,loop 行為等同現行 dev-loop。
- `plugins/dev-loop/devloop/` 下無任何引擎模組被改動(`git diff --stat` 驗證)。

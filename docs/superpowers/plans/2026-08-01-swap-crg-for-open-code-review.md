# 以 open-code-review 取代 code-review-graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 review 階段的可選增益從 `code-review-graph`(波及範圍)換成 `open-code-review`(分檔型審查 checklist),並確保沒有半套遷移。

**Architecture:** 只動編排層與文件——SKILL.md、README、command doc、`check-deps.sh`、`.gitignore` 與測試。不碰引擎。

**Tech Stack:** Markdown、bash、pytest。不新增任何程式相依。

**Spec:** `docs/superpowers/specs/2026-08-01-swap-crg-for-open-code-review-design.md`

## Global Constraints

- **不碰引擎。** `plugins/dev-loop/devloop/` 與 `plugins/dev-loop/src/` 一個字都不改。這個 plan 與 L1 TS 移植線無交集。
- **review 的檔案清單不變。** 仍是 `git diff <trunk>...HEAD --name-only`。OCR 只提供 checklist,**不決定審哪些檔**。任何讓 OCR 縮小審查範圍的實作都是錯的。
- **`.json` 路徑不送進 `ocr delegate rule`。** 該規則的內容是「檢查 key 的拼字、忽略 json-values 的內容」,而 `fixtures/parity/*.json` 的意義全在 value。這不影響 `.json` 進 review。
- 所有事實已對 **ocr v1.8.4** 實測(spec 有完整記錄)。若行為與 plan 不符,**先停下來回報**。
- pytest 從 repo 根跑:`make test`,必須全綠。
- 本 plan 不動 `plugins/dev-loop/dist/`,該路徑不該有任何變動。

---

## File Structure

| 檔案 | 動作 | Task |
|---|---|---|
| `plugins/dev-loop/skills/dev-loop/SKILL.md` | 刪步驟 1 的 CRG 段;重寫步驟 8 的閱讀範圍段 | 1 |
| `tests/test_skill_doc.py` | 刪 13 個 CRG 測試,留 1 個改名,加 5 個新的 | 1 |
| `plugins/dev-loop/bin/check-deps.sh` | CRG 偵測換成 `ocr` | 2 |
| `.gitignore` | 移除 `.code-review-graph/` | 2 |
| `README.md` | 移除 gitignore 引導行;可選工具說明換掉 | 2 |
| `plugins/dev-loop/commands/dev-loop.md` | 提及換掉 | 2 |
| `tests/test_check_deps.py` | stub 與斷言換掉 | 2 |
| `tests/test_docs_consistency.py` | 三條斷言換掉 | 2 |
| `tests/test_packaging.py` | 刪 gitignore 斷言 | 2 |
| `tests/test_no_crg_residue.py` | **新增** 全域殘留守衛 | 3 |

---

### Task 1: SKILL.md 的 review 流程

**Files:**
- Modify: `plugins/dev-loop/skills/dev-loop/SKILL.md`
- Modify: `tests/test_skill_doc.py`

**Interfaces:**
- Produces:SKILL 步驟 8 的新錨點字串 `**reviewer 的閱讀材料**` 與 `**(可選)補上分檔型審查 checklist**`,Task 3 的殘留守衛會用到前者作為 slice 邊界。

- [ ] **Step 1: 刪掉步驟 1 的 CRG 準備段**

`plugins/dev-loop/skills/dev-loop/SKILL.md` 第 45 行整行刪除(該行以三個空白縮排開頭):

```
   **順手備妥 code-review-graph(可選)**:若 `command -v code-review-graph` 成功且專案無 `.code-review-graph/`,跑 `code-review-graph build -q` 建圖(供步驟 8 review 選檔用);已有圖或工具未安裝就跳過。此步驟純增益,失敗一律忽略、不影響 loop 推進,也不寫 checkpoint。
```

不留任何替代段落——OCR 無狀態,沒有東西要在 loop 起手時準備。

- [ ] **Step 2: 重寫步驟 8 的閱讀範圍段**

在 SKILL.md 中,從 `   **先決定 reviewer 的閱讀範圍**:` 開始、到 `   接著 \`legs-init --kinds code[,uiux]\`` 之前(不含)的整段,全部替換成:

````markdown
   **reviewer 的閱讀材料**:本次改動的完整 diff。

   ```
   git diff <trunk>...HEAD
   ```

   審查必須看完每個真的改了的檔案——這個範圍不縮小,也不假裝縮小。

   **(可選)補上分檔型審查 checklist**:若 `command -v ocr` 成功,取本次改動檔清單,向 open-code-review 要各檔的審查規則:

   ```
   git diff <trunk>...HEAD --name-only
   ocr delegate rule <上一步輸出的檔案,排除 .json>
   ```

   把輸出**原樣**併進 **code leg** 的 prompt(不解析、不摘要)。uiux leg 不給——它審的是 UX 驗收準則,NPE/SQL-injection 那類 checklist 對它是噪音。

   三件必須照做的事:

   - **路徑要逐一作為獨立參數傳遞。** 把整串路徑當成單一參數傳入時,`ocr` 仍 **exit 0** 並回傳單一通用規則組,沒有任何錯誤訊號——這個錯誤無法靠 exit code 偵測,只能靠正確傳參避免。
   - **排除 `.json`。** 該規則的內容是「檢查 json-key 的拼字、忽略 json-values 的內容」,而 `fixtures/parity/*.json` 這類檔案的意義全在 value;讓那句指令不要進 prompt。這**不影響** `.json` 檔進 review,只是不向 OCR 要它們的規則。
   - **這是加法,不是減法。** OCR 只補充「該注意什麼」,不決定「審哪些檔」。檔案清單永遠是上面那條 `git diff`。OCR 自己的 `delegate preview` 會排除測試檔與 `.md`,**不要用它選檔**。

   **降級(任一成立即略過整段,照常審查)**:`ocr` 不在 PATH、命令非 0 退出、或逾時(30 秒)。review 本身恆不可裁,OCR 缺席不影響 loop 推進。code leg 與 uiux leg 同吃上面那份 diff。
````

- [ ] **Step 3: 刪掉 13 個 CRG 測試**

`tests/test_skill_doc.py` 刪除下列函式(整個函式含 docstring):

```
test_skill_documents_graph_build_on_first_start
test_skill_documents_graph_update_before_impact
test_skill_no_longer_updates_graph_at_apply_step
test_skill_documents_graph_impact_for_review
test_skill_documents_graceful_degradation_anchor_a_build
test_skill_documents_graceful_degradation_anchor_c_review
test_skill_documents_stale_graph_miss_falls_back_too
test_skill_clarifies_two_explicit_reading_inputs_for_legs
test_skill_review_scope_a_is_honest_about_no_reduction
test_skill_review_scope_b_is_filename_list_not_full_content
test_skill_review_scope_bounded_not_more_than_fallback
test_skill_no_longer_claims_context_savings_reduces_scope
test_skill_documents_impacted_files_path_normalization
```

`_slice` 輔助函式**保留**(新測試會用)。

- [ ] **Step 4: 保留並改名唯一存活的測試**

`test_skill_documents_impact_files_source_is_explicit` 的斷言在新設計下仍然成立且仍然重要——檔案清單的來源必須是明確可執行的命令,不能留給 agent 猜。改名並更新 docstring:

```python
def test_skill_documents_changed_file_source_is_explicit():
    """改動檔清單必須有明確、可執行的來源命令,而不是留給 agent 自己猜。
    這條命令同時是 review 範圍的定義——OCR 不參與決定審哪些檔。"""
    t = _text()
    assert "git diff <trunk>...HEAD --name-only" in t
```

- [ ] **Step 5: 加 5 個新測試**

在 `tests/test_skill_doc.py` 末尾追加。這 5 條分別守住 spec 裡的 5 個裁決:

```python
REVIEW_SEG_START = "**reviewer 的閱讀材料**"
REVIEW_SEG_END = "接著 `legs-init"


def test_skill_documents_ocr_rule_lookup_for_review():
    """review 段必須有可執行的 ocr 命令,而不是泛泛說「用 OCR」。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "ocr delegate rule" in seg
    assert "command -v ocr" in seg


def test_skill_ocr_section_documents_degradation():
    """沿用既有規矩:每個可選工具段落都要能自證降級,不能只在別處交代。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "降級" in seg
    assert "恆不可裁" in seg


def test_skill_excludes_json_from_ocr_rule_lookup():
    """.json 的規則是「忽略 json-values 的內容」,而 fixtures/parity/*.json
    的意義全在 value——那句指令不得進 reviewer 的 prompt。必須連理由一起寫,
    否則日後有人會以為這是隨手加的例外而拿掉。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "排除 .json" in seg
    assert "json-values" in seg


def test_skill_says_ocr_does_not_select_files():
    """OCR 的 delegate preview 會排除測試檔與 .md。SKILL 必須明講不用它選檔,
    否則日後照官方流程「補上 preview」會靜默縮小審查範圍。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "加法,不是減法" in seg
    assert "delegate preview" in seg
    assert "不要用它選檔" in seg


def test_skill_warns_ocr_arg_error_is_silent():
    """傳參錯誤時 ocr exit 0 並回通用規則組,沒有錯誤訊號——這個坑必須寫在
    命令旁邊,因為它無法靠 exit code 偵測。"""
    seg = _slice(_text(), REVIEW_SEG_START, REVIEW_SEG_END)
    assert "獨立參數" in seg
    assert "exit 0" in seg
```

- [ ] **Step 6: 跑測試**

Run: `make test`
Expected: PASS。`test_skill_doc.py` 應為 6 個測試(1 個改名保留 + 5 個新增)。

- [ ] **Step 7: 驗證新測試非空轉**

逐條驗證,不要只跑一次全綠就算數。針對 `test_skill_excludes_json_from_ocr_rule_lookup`:暫時把 SKILL 裡「排除 .json」四個字改成「包含 .json」,跑 `python3 -m pytest tests/test_skill_doc.py -q`。
Expected: FAIL,且失敗的是這一條。
還原,確認回綠。

同樣手法對 `test_skill_says_ocr_does_not_select_files` 做一次(刪掉「加法,不是減法」那句)。
Expected: FAIL 在該條。還原。

- [ ] **Step 8: Commit**

```bash
git add plugins/dev-loop/skills/dev-loop/SKILL.md tests/test_skill_doc.py
git commit -m "docs(skill): swap the review-scope helper from code-review-graph to open-code-review

The graph gave a blast-radius filename list; open-code-review gives per-file
review checklists instead. The changed-file list is untouched — OCR supplies
what to look for, never which files to look at. Its own preview command drops
test files and markdown, so the skill says in so many words not to use it for
selection.

Thirteen of this file's fourteen assertions existed to guard the graph's
scope-reduction reasoning and go with it. The one that survives is the one
that pins where the changed-file list comes from, which is now also the
definition of review scope."
```

---

### Task 2: 前置偵測與文件

**Files:**
- Modify: `plugins/dev-loop/bin/check-deps.sh`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `plugins/dev-loop/commands/dev-loop.md`
- Modify: `tests/test_check_deps.py`
- Modify: `tests/test_docs_consistency.py`
- Modify: `tests/test_packaging.py`

**Interfaces:**
- Consumes:Task 1 已完成的 SKILL 文字(README 的說明要與之一致)
- Produces:無

- [ ] **Step 1: check-deps.sh**

第 13-14 行的註解,把 CRG 那半句換掉:

```bash
# 可選增益:缺了 loop 照跑(caveman 不壓縮;code-review-graph 的 build/update
# 與 review 選檔靜默略過、退回讀整包 diff),故與硬前置分開列。
```

改成:

```bash
# 可選增益:缺了 loop 照跑(caveman 不壓縮;open-code-review 的審查 checklist
# 靜默略過,review 照常進行),故與硬前置分開列。
```

第 28 行:

```bash
  command -v code-review-graph >/dev/null 2>&1 || optional+=("code-review-graph(review 選檔;pip install code-review-graph)")
```

改成:

```bash
  command -v ocr >/dev/null 2>&1 || optional+=("open-code-review(review checklist;npm i -g @alibaba-group/open-code-review)")
```

- [ ] **Step 2: .gitignore**

刪除第 7 行 `.code-review-graph/`。**不新增任何替代條目**——實測確認 `ocr delegate rule` 不寫任何檔案(spec 有記錄)。

- [ ] **Step 3: README**

第 26 行整行刪除:

```
   grep -qxF '.code-review-graph/' .gitignore 2>/dev/null || echo '.code-review-graph/' >> .gitignore   # 有裝 code-review-graph 才需要,重跑不會重複加
```

第 67 行整條可選工具說明換成:

```markdown
- `open-code-review`——review 階段多給 reviewer 一份分檔型審查 checklist(依副檔名解析出的規則組:typo、dead code、重複邏輯、hardcoding 等)。安裝:`npm i -g @alibaba-group/open-code-review`。只用它的 `delegate rule`,**不用**它的 `delegate preview` 選檔——後者會排除測試檔與 `.md`,而 dev-loop 的 review 必須看完每個改動檔。缺它則 review 照常進行,只是少一份 checklist。
```

- [ ] **Step 4: command doc**

`plugins/dev-loop/commands/dev-loop.md` 第 28 行:

```
  - 可選增益 `caveman`(省 token)/ `code-review-graph`(review 時多給波及範圍線索)在嗎?缺了照跑,想裝見 README。
```

改成:

```
  - 可選增益 `caveman`(省 token)/ `open-code-review`(review 時多給分檔型審查 checklist)在嗎?缺了照跑,想裝見 README。
```

- [ ] **Step 5: test_check_deps.py**

把所有 stub 清單裡的 `"code-review-graph"` 換成 `"ocr"`,斷言裡的 `"code-review-graph"` 換成 `"open-code-review"`(那是 check-deps 印出的字串)。逐一檢視每個 `for name in (...)` 與其後的斷言——有些測試刻意省略某個工具作為測試重點,不要把那個省略也一起補上。

- [ ] **Step 6: test_docs_consistency.py**

```python
def test_readme_lists_optional_tools_with_install_commands():
    t = README.read_text(encoding="utf-8")
    assert "npm i -g @alibaba-group/open-code-review" in t
    assert "caveman" in t
    assert "JuliusBrussee/caveman" in t


def test_readme_says_ocr_is_not_used_for_file_selection():
    """OCR 的 delegate preview 會排除測試檔與 .md。README 必須講明我們不用它選檔,
    否則使用者照官方文件「補上 preview」會靜默縮小審查範圍。"""
    assert "不用" in README.read_text(encoding="utf-8")
    assert "delegate preview" in README.read_text(encoding="utf-8")


def test_command_doc_mentions_optional_tools():
    t = CMD.read_text(encoding="utf-8")
    assert "caveman" in t
    assert "open-code-review" in t
```

`test_readme_tells_projects_to_gitignore_graph_data` 整個刪除。

- [ ] **Step 7: test_packaging.py**

刪除 `test_gitignore_excludes_code_review_graph_data` 整個函式。不新增替代——沒有東西要 gitignore。

- [ ] **Step 8: 跑測試 + 實跑 check-deps**

Run: `make test`
Expected: PASS

實際跑一次偵測(`ocr` 已安裝,所以它**不該**出現在缺少清單):

```bash
cd /tmp && rm -rf cdcheck && mkdir cdcheck && cd cdcheck && mkdir .devloop
bash /Users/tliang/workspace/claude/code/dev-loop/plugins/dev-loop/bin/check-deps.sh
```

Expected:輸出不含 `open-code-review`。若含,表示偵測寫錯了——停下來回報。

再驗一次反向(把 `ocr` 從 PATH 拿掉):

```bash
cd /tmp/cdcheck && PATH=/usr/bin:/bin bash /Users/tliang/workspace/claude/code/dev-loop/plugins/dev-loop/bin/check-deps.sh
```

Expected:輸出含 `open-code-review` 與安裝命令。

- [ ] **Step 9: Commit**

```bash
git add plugins/dev-loop/bin/check-deps.sh .gitignore README.md \
        plugins/dev-loop/commands/dev-loop.md \
        tests/test_check_deps.py tests/test_docs_consistency.py tests/test_packaging.py
git commit -m "docs: point prerequisites and docs at open-code-review

Detection moves to command -v ocr, which was verified to work after the npm
global install — unlike caveman, which ships no PATH binary and whose
detection was wrong for a while because nobody checked.

The .gitignore entry disappears with no replacement: delegate mode was
measured to write nothing, to the repo or to the home directory."
```

---

### Task 3: 全域殘留守衛與端對端驗收

半套遷移是這次改動最可能的失敗模式:改了 10 個檔,留一句 SKILL 指令指向已不再偵測的工具,不會有任何測試變紅。

**Files:**
- Create: `tests/test_no_crg_residue.py`

**Interfaces:**
- Consumes:Task 1、2 的全部改動
- Produces:無

- [ ] **Step 1: 寫殘留守衛**

建立 `tests/test_no_crg_residue.py`:

```python
"""遷移完整性守衛:code-review-graph 不得殘留在活的編排面上。

這次遷移橫跨 SKILL.md、README、command doc、check-deps.sh、.gitignore 與四個
測試檔。半套遷移不會讓任何既有測試變紅——留一句 SKILL 指令指向一個已經不再被
偵測的工具,loop 照跑,只是那句話永遠不會生效。這條測試是唯一會發現的東西。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 歷史 spec 與 plan 記錄的是當時的決策,本來就該保留 code-review-graph 的字樣。
EXEMPT_PREFIXES = ("docs/superpowers/",)

# 掃描範圍:活的編排面與設定。刻意不掃整個 repo——node_modules 與 .git 沒有意義。
SCAN_ROOTS = (
    "plugins/dev-loop/skills",
    "plugins/dev-loop/commands",
    "plugins/dev-loop/bin",
    "openspec",
    "tests",
)
SCAN_FILES = ("README.md", ".gitignore", "Makefile")


def _candidates():
    for rel in SCAN_FILES:
        p = ROOT / rel
        if p.is_file():
            yield p
    for root in SCAN_ROOTS:
        base = ROOT / root
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.suffix in (".md", ".sh", ".py", ".json", ".yml", ".yaml"):
                yield p


def test_no_code_review_graph_residue():
    hits = []
    for p in _candidates():
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(EXEMPT_PREFIXES) or rel == "tests/test_no_crg_residue.py":
            continue
        if "code-review-graph" in p.read_text(encoding="utf-8"):
            hits.append(rel)
    assert not hits, "code-review-graph 殘留在:%s" % ", ".join(sorted(hits))
```

`tests/test_no_crg_residue.py` 自己要豁免——它的檔名與內容必然包含那個字串。

- [ ] **Step 2: 驗證守衛真的會咬**

先確認它現在是綠的,再故意製造殘留:

Run: `python3 -m pytest tests/test_no_crg_residue.py -q`
Expected: PASS

暫時在 `README.md` 末尾加一行 `code-review-graph`,重跑。
Expected: FAIL,訊息含 `README.md`。
還原,重跑確認回綠。

**這一步不能省。** 一條掃檔案的測試若路徑或副檔名清單寫錯,會永遠是綠的而什麼都沒掃到。

- [ ] **Step 3: 端對端驗收**

實際跑一次新流程的兩條命令,確認 SKILL 寫的東西真的可執行:

```bash
cd /Users/tliang/workspace/claude/code/dev-loop
FILES=("${(@f)$(git diff main~1..HEAD --name-only | grep -v '\.json$')}")
ocr delegate rule "${FILES[@]}" | head -20
```

Expected:輸出多個 `### Rule Group`,且 `Applies to:` 每個檔案獨立一行(不是全部擠在一行——那是傳參錯誤的徵兆)。

**注意 shell**:此專案的預設 shell 是 zsh,**未加引號的變數不會斷詞**。`ocr delegate rule $FILES` 會把整串路徑當成單一參數傳入,而 `ocr` 對此 exit 0 並回傳單一通用規則組,沒有任何錯誤訊號。用陣列展開 `"${FILES[@]}"`。

- [ ] **Step 4: 全套測試 + dist 未動確認**

Run: `make test`
Expected: PASS

Run: `git status --porcelain plugins/dev-loop/dist`
Expected: **無輸出**。本 plan 不碰引擎,dist 不該有任何變動。

Run: `git diff --stat main..HEAD -- plugins/dev-loop/devloop/ plugins/dev-loop/src/`
Expected: **無輸出**。

- [ ] **Step 5: Commit**

```bash
git add tests/test_no_crg_residue.py
git commit -m "test: guard against a half-finished migration

Removing a tool that was wired into ten files fails quietly: leave one skill
instruction pointing at something nobody detects any more and the loop still
runs, the instruction simply never fires. Nothing else in the suite would go
red. Verified the guard actually scans by planting a mention and watching it
fail — a file-walking test with a wrong path list is green forever."
```

---

## Self-Review

**1. Spec coverage**

| Spec 要求 | 對應 |
|---|---|
| 採用 `delegate rule`,不採用 `delegate preview` 選檔 | Task 1 Step 2 的三件事之三 + Step 5 的 `test_skill_says_ocr_does_not_select_files` |
| 檔案清單仍由 `git diff --name-only` 決定 | Task 1 Step 2、Step 4 保留的測試 |
| `.json` 排除 | Task 1 Step 2、Step 5 的 `test_skill_excludes_json_from_ocr_rule_lookup` |
| 只給 code leg | Task 1 Step 2 |
| 降級三條件 + timeout 30 秒 | Task 1 Step 2 |
| 傳參錯誤靜默降級的警告 | Task 1 Step 2、Step 5 的 `test_skill_warns_ocr_arg_error_is_silent` |
| 偵測改 `command -v ocr` | Task 2 Step 1、Step 8 的正反向實跑 |
| 不需要 `.gitignore` 條目 | Task 2 Step 2、Step 7 |
| 移除 CRG 的完整表面 | Task 1、2 逐檔列出;Task 3 的殘留守衛兜底 |
| 不碰引擎 | Global Constraints;Task 3 Step 4 明確驗證 |

**與 spec 的一處數字修正**:spec 說「移除 7 條斷言」。實際盤點 `test_skill_doc.py` 的 14 個測試函式中有 13 個是 CRG 專屬,加上 `test_docs_consistency.py` 2 條與 `test_packaging.py` 1 條,實際移除量遠大於 7。spec 的估計是在細讀測試檔之前寫的。plan 以實際盤點為準。

**2. Placeholder scan** —— 無 TBD、無「類似 Task N」、無只描述不給內容的步驟。每處修改都給了原文與改後文字。

**3. Type consistency** —— Task 1 定義的錨點 `**reviewer 的閱讀材料**` 被 Step 5 的 `REVIEW_SEG_START` 使用;`_slice` 在 Step 3 明確保留;Task 3 的豁免清單涵蓋 `docs/superpowers/` 與守衛自身。

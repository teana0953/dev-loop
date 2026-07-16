> **歷史設計文件(point-in-time)**:記錄該輪設計當下的決策與脈絡,不再更新。現行行為以 `openspec/specs/` 為準。

# Dev-Loop 設計規格 — 打包成可直接安裝的 Claude Code plugin

- **日期**:2026-07-15
- **基線**:現行 dev-loop(skill `skills/dev-loop/SKILL.md` + command `.claude/commands/dev-loop.md` + 引擎 `devloop/*.py`),最新到 trunk-based 收尾(`e7b4cfe`)
- **產物形態**:設計文件 / 規格(spec);本份不含實作
- **切分**:一個 OpenSpec change(`claude-code-plugin`),一輪 dev-loop

## 1. 動機

現行散布靠 `make install` 複製到 `~/.claude/skills/dev-loop/`,只適合本機、且靠 cwd/PYTHONPATH 讓 `python3 -m devloop.cli` 找到引擎。要「可直接裝、可分享」,正解是打包成 **Claude Code plugin**——dev-loop 的大腦(SKILL 編排、dispatch subagent)本來就只能在 Claude agent harness 裡跑,plugin 是最貼合的散布單元。

**查證到的關鍵事實(官方 plugin 文件):**
- plugin 目錄 `.claude-plugin/plugin.json`(`name`+`version` 必要);`skills/`、`commands/`、`hooks/hooks.json`、`bin/`、以及任意夾帶檔案(如 `devloop/` package)放在 plugin **根目錄**;skills/commands **自動探索**。
- plugin 安裝時整包**複製到 cache**,`${CLAUDE_PLUGIN_ROOT}` 才是安裝後根;不可用相對/repo 外路徑。
- **`bin/` 會加入 Bash 工具的 PATH**——plugin 啟用時任何 Bash 呼叫(含 skill/command 內文、hook)可用**裸命令名**執行 `bin/` 內可執行檔。
- 安裝:`/plugin marketplace add <git-repo 或本地路徑>` → `/plugin install <name>@<marketplace>`。Claude Code **clone repo、讀已 commit 的檔案**(不會幫你跑 build);marketplace catalog 是 `.claude-plugin/marketplace.json`,`source` 指向 plugin 子目錄。
- 無相依宣告機制;`python3`/`git`/`openspec` 需靠 README + SessionStart 檢查 hook 處理。

## 2. 設計總覽(方案 D:plugin 子樹即正本)

**把要 ship 的檔案重構成唯一正本 `plugins/dev-loop/`,repo 根目錄本身當 marketplace。** 沒有 build 步驟、沒有重複副本、不會漂移;`/plugin marketplace add <repo>` 直接可裝。

- **結構**:`devloop/`、`skills/dev-loop/`、`.claude/commands/dev-loop.md` 搬進 `plugins/dev-loop/` 之下當正本;`tests/`、`docs/`、`openspec/`、`Makefile`、`pyproject.toml`、README 留 repo 根當開發資產(不 ship)。repo 根 `.claude-plugin/marketplace.json` 列出 plugin,`source: ./plugins/dev-loop`。
- **引擎呼叫統一裸 `devloop`**:利用 `bin/` 進 PATH,把 SKILL/command 內文與引擎 `next_hint` 印出的 `python3 -m devloop.cli` 全改成裸 `devloop <args>`;plugin 夾帶 `bin/devloop` wrapper(自定位 PYTHONPATH → `python3 -m devloop.cli`)。同一份 SKILL/引擎既能當 plugin 跑、也能本機 dogfood(dogfood 即安裝本機這份 plugin)。
- **首跑引導強化**:`hooks/hooks.json` 掛 SessionStart → `bin/check-deps.sh`,檢查 `python3`/`git`/`openspec` 與「當前專案是否 `openspec init` 過」,缺就非阻斷提示;SKILL 首跑問答由兩鍵擴充為含 `finish` 三鍵(§7)。
- **散布決定**:plugin `version` 初值 **0.1.0**(對齊既有 `devloop/__init__.py` `__version__`);`make install`(舊全域 skill 複製)**deprecate**,散布統一走 plugin。

## 3. 目錄結構(遷移後)

```
# repo 根 = marketplace 根
.claude-plugin/
└── marketplace.json                 # catalog:plugin dev-loop,source ./plugins/dev-loop
plugins/dev-loop/                     # ← 唯一正本,原樣 ship
├── .claude-plugin/plugin.json        # version 0.1.0
├── skills/dev-loop/SKILL.md          # 由 skills/dev-loop/ 搬入
├── commands/dev-loop.md              # 由 .claude/commands/dev-loop.md 搬入
├── hooks/hooks.json                  # 新增(SessionStart → bin/check-deps.sh)
├── bin/
│   ├── devloop                       # 新增 wrapper(自定位 PYTHONPATH → python3 -m devloop.cli)
│   └── check-deps.sh                 # 新增(相依 + 專案就緒檢查,非阻斷)
└── devloop/                          # 由 repo 根 devloop/ 搬入(引擎正本)
    ├── __init__.py                   # __version__ = "0.1.0"(已是)
    ├── cli.py
    └── ...
# 開發資產(留 repo 根,不 ship):
tests/                                # 仍在根;pytest pythonpath 指向 plugins/dev-loop
docs/  openspec/  README.md  Makefile
pyproject.toml                        # pythonpath = ["plugins/dev-loop"]
.devloop/                             # 本 repo 自身 loop 的執行狀態
.claude/                              # opsx commands + openspec-* skills(與 dev-loop 無關,保留)
```

**遷移動作**:`git mv devloop → plugins/dev-loop/devloop`、`git mv skills/dev-loop → plugins/dev-loop/skills/dev-loop`、`git mv .claude/commands/dev-loop.md → plugins/dev-loop/commands/dev-loop.md`。引擎 path-agnostic(已查證無 hardcode 路徑),搬移不影響邏輯。

## 4. 引擎呼叫:統一裸 `devloop`

### 4.1 wrapper `plugins/dev-loop/bin/devloop`

```bash
#!/usr/bin/env bash
# dev-loop 引擎 wrapper:自定位 plugin/repo 根(bin/ 的上一層),設 PYTHONPATH 後轉呼叫 CLI。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = plugins/dev-loop(內含 devloop/)
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m devloop.cli "$@"
```

自定位不依賴 cwd,plugin cache 內或 repo 內都能 import 到 `devloop`。需 `chmod +x`。

### 4.2 內文改寫(裸命令)

- `plugins/dev-loop/skills/dev-loop/SKILL.md`:16 處 `python3 -m devloop.cli <args>` → `devloop <args>`。
- `plugins/dev-loop/commands/dev-loop.md`:8 處同上改寫。
- `.devloop/...` 相對路徑**不動**(相對於被開發的目標專案,checkpoint/config 屬使用者專案,非 plugin)。

### 4.3 引擎 `next_hint` 前綴改寫(含測試)

`plugins/dev-loop/devloop/statemachine.py` 的 `_DETERMINISTIC_HINTS` 與相關 hint 字串前綴 `python3 -m devloop.cli` → `devloop`,使引擎印給模型照跑的 `next:` 骨架在 plugin 情境(裸命令在 PATH)可直接執行。

**受影響測試**:`tests/test_statemachine.py`、`tests/test_cli.py` 中斷言 hint 內含 `python3 -m devloop.cli` 的案例改斷言 `devloop `。這是本設計唯一的引擎行為改動,以 TDD 先改斷言再改字串。

### 4.4 dogfood 與本機開發

- **dogfood**:`/plugin marketplace add <本 repo 路徑或 git URL>` + `/plugin install dev-loop@dev-loop`,用**實際 ship 的 plugin** 跑 loop。
- **手動跑引擎 / 跑測試**:pytest 以 in-process `main([...])` 呼叫引擎,`pyproject.toml` 的 `pythonpath = ["plugins/dev-loop"]` 讓 `import devloop` 從新位置解析;開發者手動可 `PYTHONPATH=plugins/dev-loop python3 -m devloop.cli ...`,或把 `plugins/dev-loop/bin` 加進 PATH 用裸 `devloop`。
- 裸命令改寫僅影響 §4.3 的字串斷言,不影響測試執行方式。

## 5. plugin.json(`plugins/dev-loop/.claude-plugin/plugin.json`)

```json
{
  "name": "dev-loop",
  "version": "0.1.0",
  "description": "固定流程的 agent 開發 loop:brainstorm→OpenSpec→TDD→review→自動 merge,含 trunk-based 收尾與 teardown 清殘留。需 python3/git/openspec。",
  "author": { "name": "Tina Liang", "email": "teana0953@gmail.com" },
  "license": "MIT"
}
```

`version` 為權威版本,對齊 `devloop/__init__.py` 的 `__version__`;發布時兩處一起 bump(§8 以測試守一致)。

## 6. marketplace.json(`.claude-plugin/marketplace.json`,repo 根)

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

**不在 marketplace entry 重複 `version`**(以 plugin.json 為單一權威,少一個漂移面)。若安裝流程實測要求 entry 帶 version,則加上並由 §8 的一致性測試守齊——plan 階段以本機 install 驗證確定。

## 7. 首跑引導(相依 + 專案就緒 + 設定)

現況(查證):首跑已有 SKILL 互動問一次 `superpowers`/`auto_approve` 並寫回 config、gate_cmds 惰性捕捉;但**無環境/相依檢查**、**無「專案是否 `openspec init` 過」守門**。本節補齊到適合發給新使用者。

### 7.1 `plugins/dev-loop/hooks/hooks.json`

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

### 7.2 `plugins/dev-loop/bin/check-deps.sh`(相依 + 專案就緒,非阻斷)

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
# 專案就緒:openspec 在但當前目錄未 init 時提示(僅提示,不自動 init)
if command -v openspec >/dev/null 2>&1 && [ ! -d openspec ]; then
  printf 'dev-loop:當前專案尚未初始化 OpenSpec,執行 `openspec init --tools claude`。\n' >&2
fi
exit 0
```

需 `chmod +x`。openspec 版本假設 ≥1.5.0(archive 內建 sync 主規格)。

### 7.3 首跑設定問答擴充 `finish`

SKILL 核心迴圈步驟 1 的首跑問答,現問 `superpowers`/`auto_approve` 兩鍵;**擴充為同時問 `finish`**(merge/pr/ask),一次問齊三鍵寫回 `.devloop/config.json`。

- 判定「未設」:`config.finish` 為 `None`(缺鍵)時才問;已設沿用(可被 change meta override,語義不變)。
- 屬 **SKILL.md 編排層改動**(prose + 寫 config),**不動引擎**:`resolve_finish` 值域與 override 邏輯完全不變。
- 對應同步:`plugins/dev-loop/skills/dev-loop/SKILL.md`「## 設定」段與核心迴圈步驟 1,把 `finish` 併入「一次問齊」清單。

## 8. Makefile 與版本一致性(取代 install/check)

- **`make test`**:`python3 -m pytest -q`(不變;pythonpath 由 pyproject 提供)。
- **`make install` / `make check`**:**移除**(deprecate)。散布改走 plugin;不再有全域 skill 複製、也不再有「repo↔安裝副本」漂移面。
- **版本一致性守門**:改以一支測試(`tests/test_packaging.py`)斷言 `devloop.__version__ == plugins/dev-loop/.claude-plugin/plugin.json` 的 `version`,並可順帶驗 `marketplace.json` 結構(有 `plugins[0].source == "./plugins/dev-loop"`)。取代舊 `make check` 的漂移職責,且併入 CI 的 `make test`。

## 9. 安裝與使用流程(README 要改寫)

```
# 前置:python3、git、openspec(npm i -g openspec)
/plugin marketplace add <本 repo 的 git URL 或本地路徑>
/plugin install dev-loop@dev-loop
# SessionStart 檢查前置/專案就緒;/dev-loop 即可啟動(首跑問 superpowers/auto_approve/finish)
/dev-loop
```

README 同步:移除「已安裝成 `~/.claude/skills/dev-loop/`、`make install`」敘述,改為 plugin 安裝;引擎手動範例路徑改 `plugins/dev-loop/bin/devloop` 或裸 `devloop`(plugin 情境)。

## 10. 不做(YAGNI)

- 不做傳統 VS Code `.vsix`,也不把編排改寫成 Claude API(最初否決的 B/C 方案)。
- 不自動安裝外部相依、不自動 `openspec init`;只檢查、提示。
- 行為改動刻意最小且明列:唯一引擎改動是 §4.3 hint 前綴字串;唯一 SKILL 行為增強是 §7.3 首跑多問一鍵 `finish`。其餘純搬檔 + 打包。
- 不做 `devloop doctor` 引擎子命令;首跑檢查以 SessionStart shell 腳本為之。
- 不保留 `make install`/全域 skill 複製(deprecate),不做 build 步驟/committed 副本(方案 D 本就無重複)。
- 不公開發佈到第三方 marketplace(自帶 marketplace,公開/私有/本地由使用者自行 add)。

## 11. 測試 / 驗收

- **引擎**:`next_hint` 前綴改裸 `devloop` 後,`tests/test_statemachine.py`、`tests/test_cli.py` 字串斷言更新且全綠;其餘不回歸。
- **遷移**:`git mv` 後 `pyproject.toml` pythonpath 指向 `plugins/dev-loop`,**全套測試維持綠**(搬移不改行為)。
- **版本一致性**:`tests/test_packaging.py` 斷言 `devloop.__version__ == plugin.json.version`;marketplace.json 結構正確。
- **wrapper**:`plugins/dev-loop/bin/devloop status --file <tmp cp>` 從任意 cwd 能 import 引擎並執行。
- **check-deps**:三工具皆在且 cwd 有 `openspec/` → 靜默 exit 0;缺工具 → stderr 列出且 exit 0;工具在但無 `openspec/` → 印未 init 提示且 exit 0;openspec 不在時不重複印專案未 init。
- **首跑 finish 問答**(SKILL prose,人工冒煙):空 config 首跑問答涵蓋 superpowers/auto_approve/**finish** 並寫回;`config.finish` 已設時不再問。
- **人工冒煙**:本機 `/plugin marketplace add <repo>` + install 後,`/dev-loop` 能啟動、`devloop` 裸命令可跑、缺相依或專案未 init 時 SessionStart 有對應提示。

## 12. 風險 / 待定

- `bin/` PATH 注入為官方文件所載;若行為變動,fallback 是 SKILL/hint 改回 `${CLAUDE_PLUGIN_ROOT}/bin/devloop` 絕對路徑(設計相容此退路)。
- marketplace entry 是否必須帶 `version`:plan 階段以本機 install 實測確定;需要則補上 + 一致性測試守齊。
- 遷移 churn(`git mv` + pyproject pythonpath + README/Makefile 路徑)為一次性;引擎 path-agnostic 已降低風險。
- dogfooding 改為「裝本機 plugin」:遷移完成、plugin 安裝驗證通過前,本 repo 的 `/dev-loop` 依賴舊全域安裝副本,需在切換時一併處理(README 註明)。

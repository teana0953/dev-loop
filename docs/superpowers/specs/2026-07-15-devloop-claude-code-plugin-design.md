# Dev-Loop 設計規格 — 打包成可直接安裝的 Claude Code plugin

- **日期**:2026-07-15
- **基線**:現行 dev-loop(skill `skills/dev-loop/SKILL.md` + command `.claude/commands/dev-loop.md` + 引擎 `devloop/*.py`),最新到 trunk-based 收尾(`e7b4cfe`)
- **產物形態**:設計文件 / 規格(spec);本份不含實作
- **切分**:一個 OpenSpec change(`claude-code-plugin`),一輪 dev-loop

## 1. 動機

現行散布方式是 `make install` 把 skill + 引擎複製到 `~/.claude/skills/dev-loop/`,只適合本機、且靠使用者 cwd/PYTHONPATH 讓 `python3 -m devloop.cli` 能 import 到引擎。要「可直接裝、可分享」,正解是打包成 **Claude Code plugin**——因為 dev-loop 的大腦(SKILL 編排、dispatch subagent)本來就只能在 Claude agent harness 裡跑,plugin 是最貼合的散布單元。

**查證到的關鍵事實(官方 plugin 文件):**
- plugin 目錄 `.claude-plugin/plugin.json`(`name`+`version` 必要);`skills/`、`commands/`、`hooks/hooks.json`、`bin/`、以及任意夾帶檔案(如 `devloop/` Python package)放在 plugin **根目錄**;skills/commands **自動探索**。
- plugin 安裝時整包**複製到 cache**,`${CLAUDE_PLUGIN_ROOT}` 才是安裝後根目錄;不可用相對/repo 外路徑。
- **`bin/` 會加入 Bash 工具的 PATH**——plugin 啟用時,任何 Bash 呼叫(含 skill/command 內文、hook)都能用**裸命令名**執行 `bin/` 內的可執行檔。
- 無相依宣告機制;`python3`/`git`/`openspec` 這類外部工具需靠 README + SessionStart 檢查 hook 處理。
- 安裝:`/plugin marketplace add <git-repo 或本地路徑>` → `/plugin install <name>@<marketplace>`;marketplace catalog 是 `.claude-plugin/marketplace.json`,`source` 指向 plugin 子目錄;本地/私有 git repo 皆可直接裝。

## 2. 設計總覽

- **散布形態**:同 repo 內自帶一份 marketplace,`make package` 從 repo 原始碼**建置**出乾淨 plugin 子樹並 commit 進 repo;`make check` 守漂移。使用者 `/plugin marketplace add <這個 repo 或本地路徑>` 即可直接裝。
- **引擎呼叫統一裸 `devloop`**:利用 `bin/` 進 PATH,把 SKILL/command 內文與引擎 `next_hint` 印出的 `python3 -m devloop.cli` 全部改成裸 `devloop <args>`;plugin 夾帶一個 `bin/devloop` wrapper(自定位 PYTHONPATH → 轉呼叫 `python3 -m devloop.cli`)。**同一份 SKILL/引擎既能當 plugin 跑、也能本機 dogfood**(dogfood 即安裝本機建出的 plugin)。
- **首跑引導強化**:`hooks/hooks.json` 掛 SessionStart → `bin/check-deps.sh`,檢查 `python3`/`git`/`openspec` 與「當前專案是否 `openspec init` 過」,缺就非阻斷提示;SKILL 首跑問答由兩鍵擴充為含 `finish` 三鍵(§7)。

## 3. 目錄結構

### 3.1 repo 原始碼新增(開發真相來源)

```
bin/
├── devloop                     # wrapper:自定位根 → PYTHONPATH → python3 -m devloop.cli "$@"
└── check-deps.sh               # SessionStart 相依檢查(非阻斷)
hooks/
└── hooks.json                  # SessionStart → bin/check-deps.sh
.claude-plugin/
└── plugin.json                 # plugin manifest(dev 端也放,make package 直接複製)
```

`marketplace/.claude-plugin/marketplace.json` 由 `make package` 從 plugin.json 產生(§6),不另存模板。

`devloop/*.py`、`skills/dev-loop/SKILL.md`、`.claude/commands/dev-loop.md` 維持原位,**內文改用裸 `devloop`**(§4)。

### 3.2 `make package` 建置輸出(committed,`make check` 守漂移)

```
marketplace/
├── .claude-plugin/marketplace.json          # 由 §6 產生;plugins[].source = ./plugins/dev-loop
└── plugins/dev-loop/
    ├── .claude-plugin/plugin.json           # 複製自 repo .claude-plugin/plugin.json
    ├── skills/dev-loop/SKILL.md             # 複製自 skills/dev-loop/SKILL.md
    ├── commands/dev-loop.md                 # 複製自 .claude/commands/dev-loop.md
    ├── hooks/hooks.json                     # 複製自 hooks/hooks.json
    ├── bin/devloop                          # 複製自 bin/devloop(保留可執行位)
    ├── bin/check-deps.sh                    # 複製自 bin/check-deps.sh
    └── devloop/*.py                         # 複製自 devloop/(先清後複製,刪掉的模組不殘留)
```

**不含** tests/、docs/、openspec/、Makefile、.git——ship 面乾淨。

## 4. 引擎呼叫:統一裸 `devloop`

### 4.1 wrapper `bin/devloop`

```bash
#!/usr/bin/env bash
# dev-loop 引擎 wrapper:自定位 plugin/repo 根(bin/ 的上一層),設 PYTHONPATH 後轉呼叫 CLI。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m devloop.cli "$@"
```

自定位讓它不依賴 cwd,plugin cache 內或 repo 內都能 import 到 `devloop`。需 `chmod +x`。

### 4.2 內文改寫(裸命令)

- `skills/dev-loop/SKILL.md`:16 處 `python3 -m devloop.cli <args>` → `devloop <args>`。
- `.claude/commands/dev-loop.md`:8 處同上改寫。
- `.devloop/...` 相對路徑**不動**(相對於被開發的目標專案,兩情境皆正確;checkpoint/config 屬使用者專案,不屬 plugin)。

### 4.3 引擎 `next_hint` 前綴改寫(含測試)

`devloop/statemachine.py` 的 `_DETERMINISTIC_HINTS` 與相關 hint 字串把前綴 `python3 -m devloop.cli` → `devloop`,使引擎印給模型照跑的 `next:` 骨架在 plugin 情境(裸命令在 PATH)可直接執行。

**受影響測試**:`tests/test_statemachine.py`(斷言 hint 內含 `python3 -m devloop.cli` 的案例)、`tests/test_cli.py`(status 第二行 hint 斷言)須同步改為斷言 `devloop `。這是本設計唯一的引擎行為改動,以 TDD 先改斷言再改字串。

### 4.4 dogfood 與本機開發

- **dogfood**:`make package` 後 `/plugin marketplace add ./marketplace` + `/plugin install dev-loop@dev-loop`,用**實際 ship 的 plugin** 跑 loop(最忠實)。
- **手動跑引擎**(非透過 skill):開發者仍可 `python3 -m devloop.cli ...`(從 repo 根),或把 repo `bin/` 加進 PATH 後用裸 `devloop`。
- pytest 全程以 in-process `main([...])` 呼叫引擎,不經 `devloop` 命令,故裸命令改寫不影響測試執行(僅 §4.3 的字串斷言需更新)。

## 5. plugin.json

```json
{
  "name": "dev-loop",
  "version": "2.2.0",
  "description": "固定流程的 agent 開發 loop:brainstorm→OpenSpec→TDD→review→自動 merge,含 trunk-based 收尾與 teardown 清殘留。需 python3/git/openspec。",
  "author": { "name": "Tina Liang", "email": "teana0953@gmail.com" },
  "license": "MIT"
}
```

`version` 語意:設了之後使用者只在版本變動時才更新;每次發布要 bump。初值 `2.2.0`(承 v2.1 + 多輪改善 + trunk 收尾),可再議。

## 6. marketplace.json(自帶 catalog)

```json
{
  "name": "dev-loop",
  "owner": { "name": "Tina Liang", "email": "teana0953@gmail.com" },
  "description": "dev-loop plugin 的自帶 marketplace。",
  "plugins": [
    {
      "name": "dev-loop",
      "source": "./plugins/dev-loop",
      "description": "固定流程 agent 開發 loop(需 python3/git/openspec CLI)。",
      "version": "2.2.0"
    }
  ]
}
```

實作採「repo 存一份最終 `marketplace/.claude-plugin/marketplace.json`,由 `make package` 產生/覆寫」;version 與 plugin.json 同步(package 時從 plugin.json 帶入,避免兩處手改漂移)。

## 7. 首跑引導(相依 + 專案就緒 + 設定)

現況(查證):首跑已有 SKILL 互動問一次 `superpowers`/`auto_approve` 並寫回 config、gate_cmds 惰性捕捉;但**無環境/相依檢查**、**無「專案是否 `openspec init` 過」守門**,openspec 沒裝或專案沒 init 都是跑到 loop 中途才炸。本節把首跑體驗補齊到適合發給新使用者。

### 7.1 `hooks/hooks.json`

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

### 7.2 `bin/check-deps.sh`(相依 + 專案就緒,非阻斷)

除三個外部工具,**也檢查當前專案是否 `openspec init` 過**(cwd 有無 `openspec/` 目錄);缺就提示對應修法。全部非阻斷(exit 0),只印 stderr。

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
# 專案就緒:當前目錄未 openspec init 時提示(僅提示,不自動 init)
if command -v openspec >/dev/null 2>&1 && [ ! -d openspec ]; then
  printf 'dev-loop:當前專案尚未初始化 OpenSpec,執行 `openspec init --tools claude`。\n' >&2
fi
exit 0
```

需 `chmod +x`。openspec 版本假設 ≥1.5.0(archive 內建 sync 主規格)。openspec CLI 不存在時跳過專案檢查(避免與「缺 openspec」訊息重複)。

### 7.3 首跑設定問答擴充 `finish`

SKILL 核心迴圈步驟 1 的首跑問答,現在問 `superpowers`/`auto_approve` 兩鍵;**擴充為同時問 `finish`**(收尾策略 merge/pr/ask),一次問齊三鍵並寫回 `.devloop/config.json`,讓新使用者一開始就設定好收尾方式,而非預設悶著走 `ask`。

- 判定「未設」:`config.finish` 為 `None`(缺鍵)時才問;已設則沿用(可被 change meta override,語義不變)。
- 這是 **SKILL.md 編排層改動**(prose + 寫 config),**不動引擎**:`resolve_finish` 值域與 override 邏輯完全不變,只是 config.finish 更可能在首跑就被填。
- 對應同步:`skills/dev-loop/SKILL.md`「## 設定」段與核心迴圈步驟 1 的首跑敘述,把 `finish` 併入「一次問齊」清單。

## 8. `make package` 與 `make check`

### 8.1 `make package`

從 repo 原始碼組裝 §3.2 的 `marketplace/` 子樹:
- `mkdir -p marketplace/plugins/dev-loop/{.claude-plugin,skills/dev-loop,commands,hooks,bin,devloop}`
- 複製 plugin.json / SKILL.md / dev-loop.md / hooks.json / bin/*(保留可執行位)/ `devloop/*.py`(**先 `rm -f` 目標 devloop/*.py 再複製**,repo 刪掉的模組不得殘留於 ship 側,比照現行 `make install`)。
- 由 plugin.json 的 `version` 產生 / 覆寫 `marketplace/.claude-plugin/marketplace.json`。
- 印 `packaged -> marketplace/`。

### 8.2 `make check`(延伸現行漂移守門)

現行 `make check` 比對 repo↔`~/.claude/skills/dev-loop`。延伸為:**再跑一次 `make package` 到暫存並 diff `marketplace/`**(或等效:package 後 `git diff --exit-code marketplace/`),有差即 `DRIFT detected: run 'make package'` 且 exit 1。確保 committed 的 `marketplace/` 永遠等於原始碼建出的結果。

### 8.3 `make install` 去留

現行 `make install`(複製到 `~/.claude/skills/`)在裸 `devloop` 改寫後會失效(該路徑無 `bin/` 進 PATH)。**處置**:保留 `make install` 但改為「本機開發捷徑」——同時把 `bin/devloop` 連結進使用者 PATH(如 `~/.local/bin/devloop`),或直接標記 deprecated、README 導向 plugin 安裝。傾向後者(散布統一走 plugin,減少多套路徑)。此決策在 plan 階段定案。

## 9. 安裝與使用流程(README 要寫)

```
# 前置:python3、git、openspec(npm i -g openspec)
/plugin marketplace add <這個 repo 的 git URL 或本地路徑>
/plugin install dev-loop@dev-loop
# SessionStart 會檢查前置;/dev-loop 即可啟動
/dev-loop
```

## 10. 不做(YAGNI)

- 不做傳統 VS Code `.vsix` extension,也不把編排改寫成 Claude API(對照本主題最初的 B/C 方案,已否決)。
- 不自動安裝外部相依,也不自動 `openspec init`;只檢查、提示,由使用者執行。
- 行為改動刻意最小且明列:唯一引擎改動是 §4.3 hint 前綴字串;唯一 SKILL 行為增強是 §7.3 首跑多問一鍵 `finish`。除此之外純打包,不引入 plugin 專屬新功能。
- 不做 `devloop doctor` 引擎子命令;首跑檢查以 SessionStart shell 腳本(§7.2)為之,夠用即可。
- 不公開發佈到第三方 marketplace(自帶 marketplace,公開/私有/本地由使用者自行 add)。

## 11. 測試 / 驗收

- **引擎**:`next_hint` 前綴改裸 `devloop` 的字串斷言更新後,`tests/test_statemachine.py`、`tests/test_cli.py` 全綠;其餘測試不回歸。
- **打包**:`make package` 產出的 `marketplace/` 結構符合 §3.2;`marketplace/plugins/dev-loop/devloop/` 與 `devloop/` 內容一致;`make check` 對 clean 樹回 in-sync、對故意改動回 exit 1。
- **wrapper**:`bin/devloop status --file <tmp cp>` 從任意 cwd 都能 import 引擎並執行(以臨時 checkpoint 驗證)。
- **check-deps**:三工具皆在且 cwd 有 `openspec/` → 靜默 exit 0;缺工具 → stderr 列出且 exit 0;工具在但專案無 `openspec/` → 印「未初始化 OpenSpec」提示且 exit 0;openspec CLI 不存在時**不**重複印專案未 init(僅印缺 openspec)。
- **首跑 finish 問答**:屬 SKILL prose 改動,以人工冒煙驗——空 config 首跑時問答涵蓋 superpowers/auto_approve/**finish** 三鍵並寫回;`config.finish` 已設時不再問。
- **人工冒煙**:本機 `/plugin marketplace add ./marketplace` + install 後,`/dev-loop` 能啟動、`devloop status` 裸命令可跑、缺 openspec 或專案未 init 時 SessionStart 有對應提示、首跑問答含 finish。

## 12. 風險 / 待定

- `bin/` PATH 注入為官方文件所載;若未來行為變動,fallback 是 SKILL/hint 改回 `${CLAUDE_PLUGIN_ROOT}/bin/devloop` 絕對路徑(設計已相容此退路)。
- committed `marketplace/` 會複製一份引擎 .py(derived-but-committed),以 `make check` 守漂移,取捨同現行 `make install`/`make check` 哲學。
- plugin `version` 需在每次發布 bump,否則使用者端不更新;plan 內加發布備忘。

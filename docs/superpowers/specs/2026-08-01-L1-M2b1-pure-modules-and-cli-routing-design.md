# L1 M2b-1 設計:純模組移植 + CLI 路由交接

日期:2026-08-01
狀態:待實作(L1 TS 重寫,接在 M2a 與 parity fixtures 之後)

## 背景

L1 TS 重寫採雙軌:Python 引擎(`plugins/dev-loop/devloop/`)是生產路徑,TS(`plugins/dev-loop/src/`)在旁長起來。M1 移植了 checkpoint/statemachine 與唯讀 `status`,M2a 移植了 config/history/changemeta/finish/openspec/jsonio 並解決交付阻斷點(esbuild 單檔 bundle 進版控),隨後補上跨引擎 parity fixtures。

M2b 原定一次移植 `gate`/`review`/`worktree`/`units`/`housekeeping`/`teardown`/`adapter`/`watcher` 八個模組。實測相依後切成兩塊,本 spec 只做 M2b-1。

## 關鍵發現:auto-arm 是閘門

每一個會改 checkpoint 的子命令,最後都走
`_save_with_history` → `watcher._ensure_armed_after_save` → `ensure_armed`
→ `subprocess.Popen(argv, start_new_session=True)`。

所以「移植模組就順手接上對應子命令」在 M2b-1 只能兌現一部分:

| 模組 | 對應子命令 | M2b-1 能接? |
|---|---|---|
| `housekeeping` | `archive` | ✅ 不碰 watcher |
| `units` | `units-status` | ✅ 唯讀 |
| `units` | `units-init` / `unit-done` / `unit-claim` / `units-merge` / `units-cleanup` / `unit-resolve` | ❌ 六個都要 auto-arm |
| `review` | `review` / `qa` / `proposal-review` | ❌ 三個都要 auto-arm |

`devloop model` 是額外的:它只用 `load_config` + `resolve_model`,兩者 M2a 都移植好了,不需要本 spec 的任何新模組。

**裁決**:M2b-1 移植三個模組,只接不碰 watcher 的三個子命令。`review` 的 CLI 與 `units` 的六個變更型命令,跟 `watcher` 一起進 M2b-2。

## 範圍

**移植(共 184 行 Python)**
- `units.py`(37)—— `build_units` / `pending_units` / `mark` / `all_done` / `all_merged`
- `review.py`(102)—— `classify` / `classify_proposal` / `classify_qa` / `non_blocking_notes` / `parse_review_report` / `aggregate_findings` / `ReportError`
- `housekeeping.py`(45)—— `archive_workfiles` / `KEEP_FILES`

**接上 CLI**
- `devloop archive` —— `housekeeping.archiveWorkfiles` + M2a 的 `openspec.archiveChange`。這是 M2a 那批模組第一次真正上線。
- `devloop units-status`
- `devloop model`

## CLI 路由:TS 當前門,未移植的委派給 Python

現況 `bin/devloop` 無條件 `exec python3 -m devloop.cli "$@"`,SKILL.md 全部走 `devloop <子命令>`。也就是說 **TS 的 `dist/cli.js` 至今從未被 plugin 呼叫過**,連 `status` 都沒有——只有手動 `node dist/cli.js` 跑得到。

改為:

1. `bin/devloop` 改成 `exec node "$ROOT/dist/cli.js" "$@"`
2. `cli.ts` 認得的子命令自己處理
3. 不認得的委派:`spawnSync("python3", ["-m", "devloop.cli", ...argv], { stdio: "inherit", env: { ...process.env, PYTHONPATH: root + 既有值 } })`,透傳 exit code;被 signal 中止時回 `128 + signal`(對齊 shell 慣例)

**為什麼路由表放 TS 而不是留在 bash**:有型別、測得到、M2c 只要刪掉 fallback 分支就完成切換。留在 bash 的話,路由清單與 TS 實際支援的命令集合會各自漂移,而且沒有任何測試看得到。

**必須擋住的失敗模式**:`dist/cli.js` 若是舊的、少認得一個命令,呼叫會靜默落回 Python 而沒有任何人發現——功能正常,但「已移植」是假的。所以要有測試斷言「TS 宣稱擁有的命令集合」與「實際實作的集合」完全相符。

**代價**:node 從此是硬前置(`check-deps.sh` 與 README 同步)。實際衝擊小——openspec 與 caveman 本來就需要 node。未移植的命令多跑一層 node 啟動(約數十毫秒),在以分鐘計的迴圈裡可忽略。

## 測試策略

### parity fixtures:`review.json` 與 `units.json`

沿用既有格式(`fixtures/parity/README.md`),兩側各自消費。

**`review.json`** sections:`classify`、`classifyProposal`、`classifyQa`、`nonBlockingNotes`、`parseReviewReport`、`aggregateFindings`。

要釘的:
- `classify_proposal` 的 design > proposal 優先序
- finding 缺 `severity` 鍵時視為非 blocking(`dict.get` 語意)
- 空 findings 的三個分類結果
- `parse_review_report` 的全部拒收路徑,含新加的 note 型別檢查
- `non_blocking_notes` 對缺席 `note` 回空字串

**`units.json`** sections:`buildUnits`、`pendingUnits`、`mark`、`allDone`、`allMerged`。

要釘的:
- **`all_done([])` / `all_merged([])` 是 `False`**。Python 寫的是 `bool(units) and all(...)`;TS 若直覺寫成 `units.every(...)`,空陣列回 `true`——一個沒有任何 unit 的 checkpoint 會被判定「全部完成」直接放行進 merge。與已修的 `auto_arm` 同屬 `bool()` 坑,後果更重。
- `build_units` 的 `g.get("tasks", [])`:缺鍵與顯式 null 不同(`pyGet` 那條線)
- `g["id"]` 缺鍵在 Python 是 KeyError;TS 要拋錯,不得產出 id 為 `undefined` 的 unit
- `mark` 對未知 unit_id 拋錯
- `pending_units` 的狀態集合 `("pending", "in_progress")`

### `housekeeping` 走兩側各自的檔案系統測試

不進 fixture(初始目錄樹與結果佈局用 fixture 描述會比測試本身更難讀)。兩側寫成對照組,涵蓋同一批情境。三個必須對齊的細節:

- `sorted(root.iterdir())` 決定回傳 `archived` 名單的順序——兩側都顯式按名稱排序,不靠各自語言的預設比較
- `p.replace()` 是原子 rename;Node 用 `renameSync`
- `shutil.copy2` **保留 mtime**,Node 的 `copyFileSync` 不會——補 `utimesSync`。歸檔是鑑識用的產物,時間戳不得在移植中悄悄歸零

### `fixtures/parity/cli.json`:CLI 層的逐字輸出

新增的一類 fixture。三個接上的子命令,每個 case 描述初始檔案狀態與參數,`expect` 是**逐字 stdout 與 exit code**。兩側各自呼叫自己的 `main()` 比對同一張表。

理由:模組層 parity 綠不代表 CLI 層一致。輸出格式、錯誤訊息、exit code 都是 SKILL.md 在解析的契約(`status` 的第二行 `next:` hint、`archive` 的 `archived workfiles: N -> path`)。這層沒釘的話,一個格式漂移會讓編排端讀錯,而兩邊的測試全綠。

### 委派鏈的端對端 smoke test

用 `bin/devloop` 跑一個**還沒移植的**命令,確認委派真的通(PYTHONPATH 正確、exit code 透傳、stdout 沒被吞)。這條路徑沒有任何單元測試覆蓋得到,而它現在是所有未移植命令的唯一通路。

## 風險

1. **`bin/devloop` 換 node 是這輪的爆炸半徑。** bundle 壞掉不再只是 `status` 壞,是全部壞。既有防護:bundle 進版控 + CI stale guard + `pretest` 自動重打包。新增防護:上述 smoke test。
2. **node 成為硬前置。** `check-deps.sh`、README 同步。
3. **PYTHONPATH 交接。** 從 bash 設改成 TS 設,設錯則所有未移植命令當場 `ModuleNotFoundError`。委派測試要真的跑起來,不能只斷言參數。
4. **`archive` 的失敗語意很細**:openspec archive 失敗回 1,但 housekeeping 失敗只印 warning、**不反噬** archive 的結果(回 0)。刻意如此,照抄。

## 不做(YAGNI / 範圍外)

- 不接 `review`/`qa`/`proposal-review` 的 CLI(要 auto-arm)
- 不移植 `gate`/`worktree`/`adapter`/`teardown`/`watcher`(M2b-2)
- 不做 `DEVLOOP_ENGINE` 之類的整體引擎切換開關——它要求 TS 先做完全部 24 個子命令才用得起來,與漸進曝險的目的相悖
- **不改 SKILL.md 的任何呼叫方式**。對編排端完全透明是本設計的重點
- 不動 Python 引擎,除非 parity 又揭露 bug(已發生兩次:`??` 與 `Boolean()`)

## 待實作時決定

- `cli.ts` 的子命令註冊與參數解析形狀(目前是手寫 `indexOf("--file")`,加到四個命令後需要一個小的解析器;不引入依賴)
- `review.ts` 的 `ReportError` 對應形式(自訂 Error 子類,供未來 CLI 以 `instanceof` 分辨)
- `cli.json` fixture 描述初始檔案狀態的欄位形狀

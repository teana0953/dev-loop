# 以 open-code-review 取代 code-review-graph

日期:2026-08-01
狀態:待實作

## 背景

dev-loop 的 review 階段目前有一個可選增益 `code-review-graph`(CRG):loop 起手建圖、review 開始時同步、產出「波及範圍」檔名清單交給 reviewer。整合表面橫跨 SKILL.md、README、command doc、`check-deps.sh`、`.gitignore` 與四個測試檔。

改採 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)(以下 OCR)。Go 寫的 CLI,Apache-2.0,`npm install -g @alibaba-group/open-code-review` 後提供 `ocr` 命令。

## 這不是等價替換

兩個工具做的不是同一件事,必須先講明白:

| 職責 | CRG | OCR delegation |
|---|---|---|
| 波及範圍(哪些**沒被改到**的檔可能被弄壞) | ✅ 唯一貢獻 | ❌ 沒有 |
| 該審哪些檔 | ❌ | `delegate preview` |
| 分檔型審查 checklist | ❌ | `delegate rule` |

**失去**波及範圍分析。**得到**分檔型的審查規則集(NPE、thread-safety、XSS、SQL injection 等)。

失去的東西價值有限,SKILL 現行文字自己就界定過:範圍化 diff「對範圍沒有縮小效果,必然等於整包 diff」,真正的增益只是一份波及檔名清單、讓 reviewer 需要時自行 Read。

## 核心決策:採用 `delegate rule`,不採用 `delegate preview` 的選檔

OCR 的 delegation mode 官方流程是 preview(選檔)→ rule(規則)→ agent 自取 diff 審查。**本設計只取 rule 那一半。**

理由:OCR 的檔案選擇對 dev-loop 是**靜默縮小審查範圍**。實測其原始碼:

`internal/config/allowlist/default_exclude_patterns.json` 排除測試檔:
```
"**/*_test.go", "**/*.test.{js,jsx,ts,tsx}", "**/*.spec.{js,jsx,ts,tsx}",
"**/__tests__/**", "**/*_test.py", "**/*Test.java", "**/*_test.rs", ...
```

`internal/config/allowlist/supported_file_types.json` 的副檔名 allowlist **不含 `.md`**。

套在 dev-loop 自己的 repo 上:

| 會被排除 | 命中什麼 |
|---|---|
| `plugins/dev-loop/src/*.test.ts`(全部 TS 測試) | `**/*.test.{js,jsx,ts,tsx}` |
| `SKILL.md`、`commands/dev-loop.md`、所有 spec 與 plan | `.md` 不在 allowlist |
| `tests/test_*.py` | **不**命中(`test_` 前綴 ≠ `_test.py` 後綴)——排除是不對稱的 |

兩份清單都 `//go:embed` 進 binary,`IsExcludedPath` 只讀那份嵌入清單;`--exclude` 只能追加模式,**不能移除預設**。關不掉。

這與 dev-loop 的既有不變量直接衝突——SKILL 白紙黑字:「審查本來就得看完每個真的改了的檔案」。而 dev-loop 迄今最有價值的 review 發現大多來自測試檔與文件檔(例如「這條一致性測試抓不到它自己註解宣稱要抓的失敗模式」、「這個 fixture case 在天真實作下也會拋錯,什麼都沒釘」)。

**所以檔案清單仍由 `git diff <trunk>...HEAD --name-only` 決定,這條完全不動。** 把該清單餵給 `ocr delegate rule` 取回 checklist,併進 reviewer 的 prompt。

`delegate rule` 接受任意路徑、不套 preview 的過濾(原始碼 `executeDelegateRule` → `delegate.GroupRules(resolver, paths)`),所以這樣用是它支援的。查不到規則的檔案回空,不影響它進 review。

**OCR 在此是加法,不是減法。**

## 也不採用 OCR 的 Claude Code plugin / skill

OCR 自帶 `.claude-plugin/` 與 `delegate-review.md` 命令。不接,只用 CLI。

它那份命令的 Step 4 是「Automatically fix High and Medium issues that are safe and well-defined」——與 dev-loop 的狀態機正面衝突:fix 在這裡是獨立 phase,由 `classify()` 的結果驅動並寫進 checkpoint,不是 reviewer 當場動手。它的 High/Medium/Low 分級同樣不採用;dev-loop 的 findings schema(`severity` × `level`)直接餵狀態機,不需要轉換層。

## 整合細節

**偵測**:`command -v ocr`。與 caveman 不同——caveman 是 Claude Code plugin、不在 PATH 留執行檔(當初假設 `command -v caveman` 成立,實際整個偵測是壞的),`ocr` 是 npm 全域安裝的真執行檔,PATH 偵測正確。仍須在實作時實測確認(見下)。

**呼叫時機**:只在 SKILL 步驟 8 review 開始、dispatch legs 之前跑一次。沒有 loop 起手的準備步驟——OCR 無狀態,沒有圖要建。

**給哪個 leg**:只給 code leg。uiux leg 審的是 UX 驗收準則,NPE/SQL-injection 類 checklist 對它是噪音。

**降級**(任一成立即照現行方式審,loop 不受影響,review 本身恆不可裁):
- `ocr` 不在 PATH
- `ocr delegate rule` 非 0 退出
- 命令逾時(閾值待實測後定,見下)

**空輸出不是失敗**。CRG 的降級條件裡有一條是「exit 0 但 `impacted_files` 與 `changed_nodes` 皆為空」,因為那代表圖不認得這批檔(圖 miss),不能當成「真的沒有波及檔」。OCR 沒有這個問題:空輸出代表這批檔案沒有對應規則(例如全是 `.md`),是合法結果。那條容易誤判的降級條件直接消失。

**dev-loop 永遠不解析 OCR 的輸出**。`delegate rule` 輸出 markdown,原樣併進 prompt。對比 CRG 需要解析 JSON 的 `impacted_files`、還得把絕對路徑正規化成 repo-relative 才能與 `git diff --name-only` 比對(SKILL 有一整段警告同一檔案兩種寫法會被重複計)——整段消失。副作用是這個整合對上游改版耐受:輸出格式變了不會弄壞 dev-loop,因為消費者是 LLM 不是 parser。該 repo 目前仍在頻繁更新,這點不是小事。

**信任邊界**:OCR 輸出進入 reviewer 的 prompt。規則來自其內建規則集與可能的 repo 內規則檔;後者是該 repo 自己的內容,而 reviewer 本來就在讀那個 repo,無新增實質注入面。

## 整合表面的增刪

**移除(CRG 整條)**
- SKILL 步驟 1 的「順手備妥 code-review-graph」段
- SKILL 步驟 8 的 `update -q --base`、`impact --files`、波及檔清單處理、`context_savings` 註記、兩個退回條件
- `.gitignore` 的 `.code-review-graph/`
- `check-deps.sh` 的偵測行與註解
- README 的可選工具說明與 `.gitignore` 引導行
- `commands/dev-loop.md` 的提及

**新增**
- `check-deps.sh` 偵測 `ocr`,附安裝命令
- SKILL 步驟 8 一段 `ocr delegate rule`(命令 + 降級敘述)
- README 與 command doc 同步

**淨效果是簡化**:graph 的建圖/同步/失效三種狀態換成一個無狀態命令;可選工具數量不變(caveman + ocr)。

## 測試

**移除的斷言(7 條)**

`tests/test_skill_doc.py` 6 條:`build -q` 與 `.code-review-graph/` 存在、`update` 排在 `impact` 之前、步驟 5 不得出現 `update`、build 段與 impact 段各自自帶降級敘述、`context_savings` 註記。
`tests/test_docs_consistency.py` 與 `tests/test_packaging.py` 各自的 CRG 斷言。
`tests/test_check_deps.py` 的 stub 清單與相關斷言。

**新增的斷言**

正面:check-deps 把 `ocr` 列為可選並附安裝命令;README 與 command doc 提及;SKILL 步驟 8 含 `ocr delegate rule` 且自帶降級敘述(沿用「每個可選工具段落都要能自證降級」的既有規矩)。

負面(最重要):**全 repo 不得再出現 `code-review-graph`**,`docs/superpowers/` 下的歷史 spec 與 plan 除外。此次改動橫跨 10 個檔,半套遷移是最可能的失敗模式——留一句 SKILL 指令指向已不再偵測的工具,不會有任何測試變紅。

## 實作時必須實測(不准用猜的)

1. **`ocr delegate rule` 對各副檔名的實際行為**:餵一個 `.ts`、一個 `.test.ts`、一個 `.md`、一個 `.sh`、一個 `fixtures/parity/*.json`,把實際輸出記進本 spec,取代目前的推測。
2. **`command -v ocr` 裝完後確實成立**。caveman 的教訓:假設過一次,錯了整個偵測是壞的而沒人發現。
3. **OCR 是否寫 repo 內檔案**(它有 `ocr session list`,session 狀態位置未知)。有的話要進 `.gitignore` 並補 `test_packaging.py` 斷言——正好對應被移除的 `.code-review-graph/` 那條。
4. **`ocr delegate rule` 在真實檔案清單上的耗時**,用以決定降級的 timeout 閾值。

## 不做

- 不採用 `ocr delegate preview` 的選檔(理由見上)
- 不採用 OCR 的 Claude Code plugin/skill 與其 High/Medium/Low 分級
- 不採用 `ocr review`(它自己的 LLM 路徑),不新增 API key 或計費路徑
- 不保留 CRG 作為並存的第二個可選工具
- 不碰引擎(`plugins/dev-loop/devloop/` 與 `plugins/dev-loop/src/`)——本設計只動 SKILL.md、README、command doc、`check-deps.sh`、`.gitignore` 與測試,與 L1 TS 移植線無交集,可獨立進出
- 不自訂 OCR 規則(`--rule-path` 存在,但先用內建規則集;要不要加 dev-loop 專屬規則另議)

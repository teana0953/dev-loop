# dev-loop 整合 caveman + code-review-graph 設計

日期:2026-07-29
狀態:待實作

## 目標

把兩個外部工具接進 dev-loop plugin(改 plugin 本身,未來所有使用者吃到):

- **caveman**(https://github.com/juliusbrussee/caveman)——風格壓縮 skill/hook,讓 agent 回話 caveman 化省 output token。整個 loop 的所有 subagent 都要壓縮。
- **code-review-graph / CRG**(https://github.com/tirth8205/code-review-graph)——Tree-sitter AST 結構圖(存 `.code-review-graph/` SQLite)。loop 起手偵測目標專案有無圖,無則 build;apply 成功後 update 同步;review 階段用圖算 blast-radius,只餵相關檔給 reviewer subagent。

## 兩者性質不同

| | caveman | code-review-graph |
|---|---|---|
| dev-loop 角色 | 純前置依賴 | 前置依賴 + loop 主動編排 |
| 作用機制 | caveman 自己的 session hook 作用於整個 loop | dev-loop 在三個點主動呼叫 CRG CLI |
| dev-loop 要寫的編排邏輯 | 無(只偵測 + docs) | 有(build / update / 查圖選檔) |

caveman 是 session 級 hook,dev-loop 不需要寫任何 caveman 編排——裝了它自然作用於 session 內所有 subagent dispatch。dev-loop 只負責「偵測在否」與「docs 教怎麼裝」。

## 共同原則:優雅降級,不硬斷 loop

兩工具皆**可選增益**,非硬前置。缺失時 loop 照跑:

- caveman 缺 → loop 正常跑,只是不省 token。
- CRG 缺 → build/update 步驟靜默略過;review 退回現行(讀整包 diff)。

check-deps 缺失提示標「(可選)」,不阻斷(維持 exit 0)。

## 接點 1:check-deps.sh(偵測)

`plugins/dev-loop/bin/check-deps.sh` 現偵測 python3/git/openspec。加兩行可選偵測:

```bash
command -v caveman            >/dev/null 2>&1 || optional+=("caveman(可選,省 token;裝法見 README)")
command -v code-review-graph  >/dev/null 2>&1 || optional+=("code-review-graph(可選,review 選檔;pip install code-review-graph)")
```

用獨立 `optional` 陣列與現有 `missing` 分開列印,語意上區分「硬前置缺」與「增益缺」。

## 接點 2:CRG build/update(SKILL.md 編排層)

**分層原則**:build/update 是外部工具副作用,不進 `devloop` 引擎 CLI。引擎守確定性狀態機;CRG 同步失敗不該污染 checkpoint。全部寫在 SKILL.md 編排指示,失敗靜默略過。

- **起手 build**——核心迴圈「第一次啟動」處(SKILL.md 核心迴圈 step 1)。若 `command -v code-review-graph` 成功且目標專案無 `.code-review-graph/`:跑 `code-review-graph build -q`。已有則跳過。CLI 缺 → 略過。
- **apply 後 update**——流程 step 5 末、`event --event apply_done` 之前。跑 `code-review-graph update -q --base <trunk>`(增量,只 re-parse 改動檔)。平行 worktree merge 完成後跑一次即可。CLI 缺或無圖 → 略過。

## 接點 3:review 查圖選檔(SKILL.md 流程 step 8)

現行 review legs 把整包 diff 丟 reviewer subagent。改為:review dispatch 前,若圖在,算 blast-radius 選檔。

已驗真實 CLI 接口(本機 `code-review-graph impact --help`):

```
code-review-graph impact --files <changed-file...> --depth 2 --max-results N
```

回 JSON:`impacted_files`(caller/dependent/test 相關檔集)、`context_savings`(省 token 估算)。把 `impacted_files ∪ changed_files` 當 reviewer subagent 的閱讀範圍(取代「讀整包 diff」),code leg 與 uiux leg 皆適用。

降級:`command -v code-review-graph` 失敗或無 `.code-review-graph/` 或 `impact` 非 0 退出 → 退回現行整包 diff。

備註:`query <relation> <target>` 是單節點細粒度關係查詢(callers_of/tests_for 等),本設計不用,列為未來細化備用。

## .gitignore

`.code-review-graph/` 屬本機圖資料(SQLite),不該進版控。dev-loop repo `.gitignore` 補一行;README「準備專案」段提示使用者專案也加。

## 降級矩陣

| 情境 | caveman | CRG | loop 行為 |
|---|---|---|---|
| 都裝 | 壓縮全程 | build/update/選檔 | 全功能 |
| 只 caveman | 壓縮全程 | 略過 | review 讀整包 |
| 只 CRG | 不壓縮 | build/update/選檔 | review 選檔 |
| 都沒 | 不壓縮 | 略過 | 等同現行 dev-loop |

## 影響檔案

- `plugins/dev-loop/bin/check-deps.sh` — 加兩行可選偵測
- `plugins/dev-loop/skills/dev-loop/SKILL.md` — 三個編排接點(起手 build、apply 後 update、review 選檔)
- `README.md` — 前置依賴段加 caveman/CRG(標可選)+ 裝法;準備專案段提 `.gitignore`
- `plugins/dev-loop/commands/dev-loop.md` — 順手檢查前置段同步
- `.gitignore` — 加 `.code-review-graph/`
- 版號 bump(patch or minor,視最終改動)

## 不做(YAGNI)

- 不接 CRG 的 MCP server / daemon / watch(dev-loop 引擎自己管 build/update,不需常駐)。
- 不接 CRG embedding / 語意搜尋 / wiki / community。
- 不寫 caveman 編排(它是 session hook,裝了自動作用)。
- 不改 devloop 引擎 CLI(CRG 同步是編排層副作用)。

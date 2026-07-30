# dev-loop L1 重練設計:三層 loop engineering 的 Layer 1(TS 版)

日期:2026-07-30
狀態:待實作(三層框架的第一層,後續 L2/L3 各自 spec→plan)

## 背景:Andrew Ng 三層 loop engineering 框架

出處:Andrew Ng, The Batch(2026-06-30)。三個嵌套迴圈,反饋由外而內收斂:

| 層 | 時間尺度 | 做什麼 |
|---|---|---|
| **L1 Agentic Coding Loop** | 分鐘 | 給 spec(+evals),agent 寫碼、自測、迭代到無 bug 且達 spec |
| **L2 Developer Feedback Loop** | 數十分~小時 | 開發者看跑起來的產品、導正 agent;人的價值是 context advantage |
| **L3 External Feedback Loop** | 小時~週 | 收集真實外部訊號(問朋友、alpha、A/B)→ 餵養願景 → 驅動 spec |

External → vision → spec → 內層 coding loop。

**本 spec 只做 L1。** L2/L3 是不同時間尺度、跨 session/跨部署的持久子系統,各自後續 spec→plan→實作。

## 目標

把 dev-loop 重練成 spec+evals 驅動的 L1 引擎,語言從 Python 換成 TypeScript。重練的是**流程骨架 + eval 子系統**與**實作語言**;可用的正交基礎設施概念(checkpoint、watcher、worktree/平行、teardown、finish、config)保留其行為契約,以 TS 重新實作。

## 技術選型(定案)

- **語言**:TypeScript / Node ≥18。runtime 前置從 `python3` 換成 `node`(python3 完全移除;caveman、openspec 本來就需 node,生態一致)。
- **執行/分發**:`tsc` 編譯成 `dist/`;release 由 CI 編譯打包(依 plugin.json version 打 tag,沿用現有 release workflow 精神)。
- **測試**:vitest。
- **既有 356 Python 測試**:不遷移,以 TS + vitest 依行為契約重寫。

## L1 核心決策(定案)

1. **evals 為第一公民**,與 spec 並列當 L1 輸入契約。agent 迭代到 evals 全過才算完成。
2. **TDD 降為建議手段**:apply 內 agent 自主決定用不用 red→green,引擎不再強制。真正的 gate 是 **evals + review**,不是「有沒有照 red-green」。
3. **evals 在 propose 時連 spec 一起產出**,住 change 目錄,批准提案時一併看。
4. **統一 eval runner**:現有 hard gate(test/lint/build)+ QA gate(行為驗收)合併成單一 `eval` phase。

## Phase 骨架變化

現況:
```
brainstorm → propose → proposal_review → apply → gate → qa → review → fix → merge → teardown
```

重練後:
```
brainstorm → propose(spec+evals) → proposal_review → apply → eval → review → fix → merge → teardown
                                                              └ gate+qa 合併成單一 eval runner
```

- `gate` + `qa` 兩 phase → 併為單一 `eval`。
- 事件 `GATE_PASS`/`GATE_FAIL`/`QA_PASS`/`QA_FAIL`/`QA_SKIP`/`GATE_RETRY_EXCEEDED` → 收斂成 `EVAL_PASS`/`EVAL_FAIL`/`EVAL_SKIP`/`EVAL_RETRY_EXCEEDED`。
- 轉移:`apply --APPLY_DONE→ eval`、`eval --EVAL_PASS→ review`、`eval --EVAL_FAIL→ fix`、`fix --FIX_DONE→ eval`、`eval --EVAL_RETRY_EXCEEDED→ escalated`。
- **保留不動的正交機制**:`flow_profile`(full/light)、`needs_uiux`、`model_profile`/`models`、平行 worktree/units、watcher 續跑、review legs、兩個 ✋ 批准關卡、escalated 安全閥。三層框架不碰這些。

## evals 檔契約

propose 產出,住 `openspec/changes/<id>/evals.yaml`,archive 隨 change 進 archive:

```yaml
evals:
  - id: csv-export-button-visible
    kind: deterministic          # 有 cmd,exit 0 = pass(現 hard gate 邏輯)
    cmd: "pytest tests/test_export.py -q"

  - id: csv-downloads-on-click
    kind: behavior               # 無 cmd,交 subagent 依 criteria 驗 app/CLI/UI(現 QA 邏輯)
    criteria: "點匯出鈕,瀏覽器下載 users.csv,內容含表頭列"
```

兩類:
- **deterministic** — 有 `cmd`,引擎直接跑,exit code 判過。
- **behavior** — 無 `cmd`,有 `criteria`,dispatch subagent 實跑 app/CLI/瀏覽器驗。

## eval runner 契約

**分階段短路**:先跑全部 deterministic(快、便宜),全過才跑 behavior(慢、要 subagent)。任一階段有失敗即回報,不白跑後段。

CLI:`devloop eval --file <checkpoint> [--evals <path>] [--max-eval N]`

verdict(餵狀態機):
- `eval_pass` → review(全過)
- `eval_fail` → fix(附失敗 eval id 清單 + 各自 output)
- `eval_retry_exceeded` → escalated(連續失敗超過 `--max-eval`,預設 3,像現 max-gate)

**降級與正交軸**:
- `flow_profile=light 且非 uiux` → `eval_skip` 誠實跳過 behavior 類;**deterministic 恆跑不可裁**(回歸網不能省)。
- `needs_uiux=true` → behavior evals 必含 UI/UX 驗收 criteria(接現有 uiux-thread)。
- evals 檔缺失或空 → 引擎 fail loudly(不假綠),要求 propose 補。

## 檔案影響(TS 重練)

引擎全數以 TS 重寫(現 `plugins/dev-loop/devloop/*.py` → TS 模組,如 `plugins/dev-loop/src/`),對應關係:

- **statemachine** — 最核心合流:PHASES 去掉 gate/qa 加 eval;事件收斂;轉移改寫;next_hint 的 gate/qa 兩組併為 eval hint。以 discriminated union 表達 phase×event 取得編譯期完整性。
- **evals**(新模組)— 解析 evals.yaml、分類、分階段短路、產 verdict。
- **gate 邏輯** — 降為 evals 的 deterministic 執行器(現 `run_gate` 的依序短路行為以 TS 重寫保留)。
- **review 的 QA 段** — behavior eval 的 dispatch 契約移入 evals 子系統;review legs 段保留(review phase 未動)。
- **CLI** — `devloop gate` + `devloop qa` 兩子命令 → 合為 `devloop eval`;舊子命令直接刪(內部契約,無外部依賴,不留相容 shim)。
- **保留行為、以 TS 重寫**:checkpoint、watcher、worktree/units、teardown、finish、config、changemeta、adapter、housekeeping、history。
- **wrapper**:`bin/devloop` 改為 node 進入點(呼叫編譯後的 dist/)。
- **SKILL.md**:步驟 6(hard gate)+ 步驟 7(QA gate)→ 併為單一「eval」步驟;步驟 2(propose)加「產出 evals.yaml」;步驟 5(apply)TDD 從強制降為建議。
- **OpenSpec specs**:`gate-commands-config` 及 gate/qa 相關行為契約改寫成 eval 契約(living spec 同步)。
- **測試**:vitest 重寫全套;新增 evals 子系統測試;狀態機測試依新 phase/事件改寫。
- **CI**:workflow 從 pytest/ruff 改成 node build + vitest + TS lint(eslint 或 tsc --noEmit + 選型 linter)。
- **前置**:check-deps 從偵測 python3 改偵測 node;README/command doc 同步。
- **版號**:major/minor bump(語言與流程皆變,傾向 major 或大 minor,實作時定)。

## 不做(YAGNI / 本 spec 範圍外)

- 不做 L2、L3(各自後續 spec)。
- 不做漸進雙語言遷移(直接 TS 重練,不留 Python 相容層)。
- eval runner 不做評分器模式(pass/fail 已定;分數式驗收若 L2/L3 需要再議)。
- 不接 CRG 的 MCP/daemon;caveman/code-review-graph 的可選整合行為契約沿用(以 TS 重新實作偵測與編排接點)。

## 待實作時決定的細節

- TS 專案佈局(`src/` 結構、tsconfig target/module、eslint 設定)。
- eval verdict 的 JSON schema 精確欄位(接狀態機的介面)。
- checkpoint 檔格式是否沿用現 JSON schema(傾向沿用,續跑相容性最單純)。
- caveman/code-review-graph 兩個可選整合的 TS 重實作細節。

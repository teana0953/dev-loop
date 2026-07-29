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

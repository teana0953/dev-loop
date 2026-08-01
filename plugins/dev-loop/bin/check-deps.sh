#!/usr/bin/env bash
# dev-loop 首跑檢查:缺工具/專案未就緒只提示不阻斷(exit 0)。
missing=()
# node 是引擎進入點:bin/devloop 直接 exec node dist/cli.js,缺它連未移植的
# 子命令都跑不到(它們是由 TS 委派回 python3 的)。
command -v node     >/dev/null 2>&1 || missing+=("node(18+)")
command -v python3  >/dev/null 2>&1 || missing+=("python3")
command -v git      >/dev/null 2>&1 || missing+=("git")
command -v openspec >/dev/null 2>&1 || missing+=("openspec(npm i -g @fission-ai/openspec)")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'dev-loop 前置缺少:%s\n' "${missing[*]}"
fi
# 可選增益:缺了 loop 照跑(caveman 不壓縮;code-review-graph 的 build/update
# 與 review 選檔靜默略過、退回讀整包 diff),故與硬前置分開列。
# 只對「已在用 dev-loop 的專案」(有 .devloop/)發出,理由同下面 openspec init
# 提示的註解:避免對其他專案每個 session 注入噪音。
if [ -d .devloop ]; then
  # caveman 是 Claude Code plugin,不會在 PATH 上留執行檔——它的安裝流程是寫入
  # active-flag 檔(~/.claude/.caveman-active)與 marketplace 目錄
  # (~/.claude/plugins/marketplaces/caveman/),`command -v caveman` 找不到它是
  # 正常現象,不代表沒裝。改偵測這兩個安裝痕跡(尊重 CLAUDE_CONFIG_DIR)。
  claude_config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  optional=()
  if [ ! -f "$claude_config_dir/.caveman-active" ] \
    && [ ! -d "$claude_config_dir/plugins/marketplaces/caveman" ]; then
    optional+=("caveman(省 output token;裝法見 README)")
  fi
  command -v code-review-graph >/dev/null 2>&1 || optional+=("code-review-graph(review 選檔;pip install code-review-graph)")
  if [ ${#optional[@]} -gt 0 ]; then
    printf 'dev-loop 可選增益未安裝:%s\n' "${optional[*]}"
  fi
fi
# openspec init 提示只對「已在用 dev-loop 的專案」(有 .devloop/)發出,
# 避免對其他專案每個 session 注入噪音;新專案的引導由 /dev-loop 無參數說明負責。
if [ -d .devloop ] && command -v openspec >/dev/null 2>&1 && [ ! -d openspec ]; then
  printf 'dev-loop:當前專案尚未初始化 OpenSpec,執行 `openspec init --tools claude`。\n'
fi
exit 0

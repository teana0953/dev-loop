## Follow-up(non-blocking)

> **清點(2026-07-16):全數關閉。** 逐項對照現行程式碼的結果標注於各項開頭。

- ✅ **已解**(config.py `resolve_finish`)— finish-validation/spec.md 的 Requirement 措辭與三個 scenario 只驗證 resolve_finish 的『結果值』:scenario 2 是 config 合法 + meta 非法而報錯,但反向情況(config="merg" typo 但 meta="pr" 合法 override)下,現行 resolve_finish 先取 meta 直接回 "pr",非法的 config typo 會被合法 override 靜默吞掉——這正是本 change 想根除的『typo 靜默退化』。建議 requirement 明確化為對 config.finish 與 meta.finish 各自獨立驗證(而非只驗最終勝出值),或補一條 scenario 釘住此邊界,避免實作只 check 回傳值。
  *現行 `resolve_finish` 對 config.finish 與 meta.finish 各自獨立驗證,非法值即使被合法 override 也拋 ValueError。*
- ✅ **已解**(cli.py gate parser help)— tasks 3.1/3.2 新增 --max-propose / --max-gate,但 gate 子命令既有 --max(= max_iterations,用於 gate_pass→qa 的 iteration 上限,statemachine.py:56 的 `new_iteration > max_iterations`)。gate 命令將同時擁有 --max 與 --max-gate 兩個語義不同的上限旗標,易混淆。建議 tasks/spec 補一句釐清兩者職責(--max 管 iteration 正常輪次上限、--max-gate 管連續紅燈次數),或在 help 文字上區分,以免 apply 階段誤用同一計數。
  *gate 的 `--max` 與 `--max-gate` help 文字已分別註明「輪次上限」與「連續失敗次數」。*
- ✅ **已解**(README + help 文字,2026-07-16 補)— statemachine-guardrails/spec.md 對 propose_attempts/gate_failures 採 `+1 後 > 上限才升級` 的 `>` 語義(與 design 決策 3、statemachine.py 既有 iteration 慣例一致,已核實屬實)。副作用:--max-propose=3 實際允許 3 次 re-propose、第 4 次失敗才 escalate(gate 同理)。語義自洽且與 v2 一致,但『預設 3』對外看起來像『3 次後就升級』;建議在 proposal.md 或 SKILL 敘述補一句『N 為容許重試次數,第 N+1 次失敗升級』避免使用者對上限直覺誤解。此為措辭澄清,非邏輯缺陷。
  *README「通過條件」段已補「N 為容許次數,第 N+1 次才升級」;`--max-gate` help 亦同語義。*
- ✅ **已解**(cli.py `_cmd_gate`)— devloop/cli.py:89-92 — gate 升級到 escalated 與一般 gate→fix 在 stdout/exit code 上無法區分(兩者都是 exit 1 且 fail 分支不印 phase,只有 pass 分支印 phase)。驅動 agent 若只憑 exit 1 就照 SKILL 步驟 6 進 fix,唯一的兜底是後續 fix_done 對 escalated 觸發 InvalidTransition 而 exit 2 報錯(非靜默錯路)。已由 SKILL 步驟 6 改寫要求讀 status + phase 持久化到 checkpoint 緩解,屬使用性小瑕,非正確性缺陷。
  *現行 gate 失敗分支印 `phase=`,escalated 專屬 exit 3、一般失敗 exit 1,可直接分流。*

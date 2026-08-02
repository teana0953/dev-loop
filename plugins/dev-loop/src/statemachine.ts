// Ported from devloop/statemachine.py (transition() only; next_hint is Task 4).

// Phases (spec 4)
export const PHASES = [
  "brainstorm",
  "propose",
  "proposal_review",
  "apply",
  "gate",
  "qa",
  "review",
  "fix",
  "merge",
  "teardown",
  "escalated",
  "done",
] as const;

// Events
export const APPLY_DONE = "apply_done";
export const PROPOSE_CLEAN = "propose_clean";
export const PROPOSE_BLOCKING_PROPOSAL = "propose_blocking_proposal";
export const PROPOSE_BLOCKING_DESIGN = "propose_blocking_design";
export const GATE_PASS = "gate_pass";
export const GATE_FAIL = "gate_fail";
export const QA_PASS = "qa_pass";
export const QA_FAIL = "qa_fail";
export const QA_SKIP = "qa_skip";
export const REVIEW_NO_BLOCKING = "review_no_blocking";
export const REVIEW_BLOCKING_CODE = "review_blocking_code";
export const REVIEW_BLOCKING_PROPOSAL = "review_blocking_proposal";
export const FIX_DONE = "fix_done";
export const FINISH_DONE = "finish_done";
export const PROPOSE_DONE = "propose_done";
export const TEARDOWN_DONE = "teardown_done";
export const PROPOSE_RETRY_EXCEEDED = "propose_retry_exceeded";
export const GATE_RETRY_EXCEEDED = "gate_retry_exceeded";
export const HUMAN_RESUME_PROPOSE = "human_resume_propose";
export const HUMAN_RESUME_FIX = "human_resume_fix";

export const DEFAULT_MAX_ITERATIONS = 3;

export class InvalidTransition extends Error {}

// phase → next hint 產生器(規格 cli-status)。確定性步驟給命令骨架、
// 判斷型步驟給 dispatch 說明、終態明確收束。
const DETERMINISTIC_HINTS: Record<string, (f: string) => string> = {
  proposal_review: (f) => `next: devloop proposal-review --file ${f} --report <pr.json>`,
  gate: (f) => `next: devloop gate --file ${f} --cmd "<test-cmd>" [--cmd "<lint-cmd>"]`,
  qa: (f) => `next: devloop qa --file ${f} --report <qa.json>`,
  review: (f) => `next: devloop review --file ${f} --from-legs`,
  merge: (f) =>
    `next: devloop finish --file ${f} --config <config.json> --meta <meta.json> --followup <followup.md>`,
};

const JUDGMENT_HINTS: Record<string, string> = {
  brainstorm: "next: dispatch brainstorming(產出設計文件,批准後 propose)",
  propose: "next: dispatch propose(建立 OpenSpec change,完成後 event --event propose_done)",
  apply: "next: dispatch apply(TDD 實作 tasks,完成後 event --event apply_done)",
  fix: "next: dispatch fix(處理 blocking 項,完成後 event --event fix_done)",
};

const TERMINAL_HINTS: Record<string, string> = {
  done: "next: (done)",
  escalated:
    "next: (escalated)人工升級後續跑:event --event human_resume_propose 或 human_resume_fix",
};

export interface HintOpts {
  units?: Array<{ id: string; status?: string }>;
  reviewLegs?: Array<{ kind: string; status?: string }>;
  gateCmds?: string[] | null;
  finishMode?: string | null;
  flowProfile?: string | null;
  needsUiux?: boolean | null;
}

/**
 * 依 phase(與 units/review_legs pending 狀態)給下一步 hint,恆以 `next: ` 開頭。
 *
 * gate_cmds 非空(config 已存 gate 命令)時,gate hint 給完整可執行命令
 * (引擎會 fallback 到 config),而非 `<test-cmd>` 骨架。
 *
 * finish_mode 有值時(checkpoint 已記錄 merge/pr),teardown hint 給完整
 * 可執行命令;無值時給 `<merge|pr>` 骨架待人工/引擎補上。
 *
 * qa 階段依流程軸分岔:flow_profile=light 且非 uiux → 裁剪路徑 hint qa_skip
 * (UX 線不受裁剪:uiux 時照 qa 骨架,QA 只驗 UX 驗收)。
 */
export function nextHint(
  phase: string,
  checkpointPath: string,
  opts: HintOpts = {},
): string {
  const { units, reviewLegs, gateCmds, finishMode, flowProfile, needsUiux } = opts;
  if (phase === "qa" && flowProfile === "light" && !needsUiux) {
    return `next: devloop event --file ${checkpointPath} --event qa_skip`;
  }
  if (phase === "gate" && gateCmds && gateCmds.length) {
    return `next: devloop gate --file ${checkpointPath}`;
  }
  if (phase === "teardown") {
    const mode = finishMode || "<merge|pr>";
    return `next: devloop teardown --file ${checkpointPath} --repo . --mode ${mode}`;
  }
  if ((phase === "apply" || phase === "fix") && units) {
    const pending = units
      .filter((u) => u.status === "pending" || u.status === "in_progress")
      .map((u) => u.id);
    if (pending.length) {
      return `next: units pending: ${pending.join(",")} -> devloop units-status --file ${checkpointPath}`;
    }
  }
  // legs 只在 review 階段 legs-init(SKILL 步驟 8),qa 階段恆無 legs,
  // 故 pending-legs 提示僅判 review——這是刻意的,非漏了 qa。
  if (phase === "review" && reviewLegs) {
    const pendingLegs = reviewLegs
      .filter((l) => l.status !== "collected")
      .map((l) => l.kind);
    if (pendingLegs.length) {
      return `next: legs pending: ${pendingLegs.join(",")} -> devloop leg-done --file ${checkpointPath} --kind <kind> --report <report.json>`;
    }
  }
  // Use Object.hasOwn (not `in`/`phase in TABLE`) so lookups can never match
  // inherited Object.prototype keys (e.g. "constructor", "toString",
  // "valueOf"). Those must throw, exactly as Python's dict-membership
  // check (`phase in _TABLE`) does for any key not actually present.
  if (Object.hasOwn(TERMINAL_HINTS, phase)) {
    return TERMINAL_HINTS[phase];
  }
  if (Object.hasOwn(DETERMINISTIC_HINTS, phase)) {
    return DETERMINISTIC_HINTS[phase](checkpointPath);
  }
  if (Object.hasOwn(JUDGMENT_HINTS, phase)) {
    return JUDGMENT_HINTS[phase];
  }
  throw new Error(`no next hint for phase ${phase} (KeyError)`);
}

/**
 * Pure state transition function. Returns [newPhase, newIteration].
 *
 * iteration is incremented by 1 when gate_pass enters qa (represents the
 * qa/review round number); exceeding maxIterations transitions to escalated.
 */
export function transition(
  phase: string,
  iteration: number,
  event: string,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): [string, number] {
  if (phase === "proposal_review" && event === PROPOSE_CLEAN) {
    return ["apply", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_PROPOSAL) {
    return ["propose", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_BLOCKING_DESIGN) {
    return ["escalated", iteration];
  }
  if (phase === "apply" && event === APPLY_DONE) {
    return ["gate", iteration];
  }
  if (phase === "gate" && event === GATE_PASS) {
    const newIteration = iteration + 1;
    if (newIteration > maxIterations) {
      return ["escalated", newIteration];
    }
    return ["qa", newIteration];
  }
  if (phase === "qa" && event === QA_PASS) {
    return ["review", iteration];
  }
  if (phase === "qa" && event === QA_SKIP) {
    return ["review", iteration];
  }
  if (phase === "qa" && event === QA_FAIL) {
    return ["fix", iteration];
  }
  if (phase === "gate" && event === GATE_FAIL) {
    return ["fix", iteration];
  }
  if (phase === "review" && event === REVIEW_NO_BLOCKING) {
    return ["merge", iteration];
  }
  if (phase === "review" && event === REVIEW_BLOCKING_CODE) {
    return ["fix", iteration];
  }
  if (phase === "review" && event === REVIEW_BLOCKING_PROPOSAL) {
    return ["propose", iteration];
  }
  if (phase === "fix" && event === FIX_DONE) {
    return ["gate", iteration];
  }
  if (phase === "merge" && event === FINISH_DONE) {
    return ["teardown", iteration];
  }
  if (phase === "teardown" && event === TEARDOWN_DONE) {
    return ["done", iteration];
  }
  if (phase === "propose" && event === PROPOSE_DONE) {
    return ["proposal_review", iteration];
  }
  if (phase === "proposal_review" && event === PROPOSE_RETRY_EXCEEDED) {
    return ["escalated", iteration];
  }
  if (phase === "gate" && event === GATE_RETRY_EXCEEDED) {
    return ["escalated", iteration];
  }
  if (phase === "escalated" && event === HUMAN_RESUME_PROPOSE) {
    return ["propose", iteration];
  }
  if (phase === "escalated" && event === HUMAN_RESUME_FIX) {
    return ["fix", iteration];
  }
  // Python 是 `"no transition from %r on %r"`——%r 會加引號。這段訊息由
  // cli 的 main() 原樣印成 `error: ...`,所以少了引號就是使用者看得見的
  // 分歧:PY "no transition from 'apply' on 'no_such_event'" /
  // TS(修前) "no transition from apply on no_such_event"。
  // (%r 對含單引號的字串會改用雙引號包;phase/event 是識別字,這裡不重現。)
  throw new InvalidTransition(`no transition from '${phase}' on '${event}'`);
}

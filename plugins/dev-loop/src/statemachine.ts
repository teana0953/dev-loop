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
  throw new InvalidTransition(`no transition from ${phase} on ${event}`);
}

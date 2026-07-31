import { describe, it, expect } from "vitest";
import {
  transition, InvalidTransition, PHASES,
  APPLY_DONE, GATE_PASS, GATE_FAIL, QA_PASS, QA_FAIL, QA_SKIP,
  REVIEW_NO_BLOCKING, REVIEW_BLOCKING_CODE, REVIEW_BLOCKING_PROPOSAL,
  FIX_DONE, FINISH_DONE, PROPOSE_DONE, TEARDOWN_DONE,
  PROPOSE_CLEAN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_BLOCKING_DESIGN,
  PROPOSE_RETRY_EXCEEDED, GATE_RETRY_EXCEEDED,
  HUMAN_RESUME_PROPOSE, HUMAN_RESUME_FIX,
} from "./statemachine.js";

// All events, derived from the exported event constants (not hand-typed
// string literals) so this list can never drift from statemachine.ts.
const ALL_EVENTS = [
  APPLY_DONE, GATE_PASS, GATE_FAIL, QA_PASS, QA_FAIL, QA_SKIP,
  REVIEW_NO_BLOCKING, REVIEW_BLOCKING_CODE, REVIEW_BLOCKING_PROPOSAL,
  FIX_DONE, FINISH_DONE, PROPOSE_DONE, TEARDOWN_DONE,
  PROPOSE_CLEAN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_BLOCKING_DESIGN,
  PROPOSE_RETRY_EXCEEDED, GATE_RETRY_EXCEEDED,
  HUMAN_RESUME_PROPOSE, HUMAN_RESUME_FIX,
];

// The frozen valid (phase, event) edge table -- the 20 valid transitions,
// written out literally so a change to this table shows up as a reviewable
// diff (e.g. when M3 merges gate+qa into a single eval phase).
const VALID: Array<[string, string]> = [
  ["proposal_review", PROPOSE_CLEAN],
  ["proposal_review", PROPOSE_BLOCKING_PROPOSAL],
  ["proposal_review", PROPOSE_BLOCKING_DESIGN],
  ["apply", APPLY_DONE],
  ["gate", GATE_PASS],
  ["qa", QA_PASS],
  ["qa", QA_SKIP],
  ["qa", QA_FAIL],
  ["gate", GATE_FAIL],
  ["review", REVIEW_NO_BLOCKING],
  ["review", REVIEW_BLOCKING_CODE],
  ["review", REVIEW_BLOCKING_PROPOSAL],
  ["fix", FIX_DONE],
  ["merge", FINISH_DONE],
  ["teardown", TEARDOWN_DONE],
  ["propose", PROPOSE_DONE],
  ["proposal_review", PROPOSE_RETRY_EXCEEDED],
  ["gate", GATE_RETRY_EXCEEDED],
  ["escalated", HUMAN_RESUME_PROPOSE],
  ["escalated", HUMAN_RESUME_FIX],
];
const validKeys = new Set(VALID.map(([p, e]) => `${p}|${e}`));

describe("transition", () => {
  it("apply_done goes to gate", () => {
    expect(transition("apply", 0, APPLY_DONE)).toEqual(["gate", 0]);
  });
  it("gate_pass enters qa and increments iteration", () => {
    expect(transition("gate", 0, GATE_PASS)).toEqual(["qa", 1]);
  });
  it("gate_pass beyond max iterations escalates", () => {
    expect(transition("gate", 3, GATE_PASS, 3)).toEqual(["escalated", 4]);
  });
  it("gate_pass reaching exactly max iterations stays in qa (escalate only when exceeding, not reaching)", () => {
    expect(transition("gate", 2, GATE_PASS, 3)).toEqual(["qa", 3]);
  });
  it("gate_fail goes to fix without incrementing", () => {
    expect(transition("gate", 1, GATE_FAIL)).toEqual(["fix", 1]);
  });
  it("qa_pass goes to review", () => {
    expect(transition("qa", 1, QA_PASS)).toEqual(["review", 1]);
  });
  it("qa_skip goes to review", () => {
    expect(transition("qa", 1, QA_SKIP)).toEqual(["review", 1]);
  });
  it("qa_fail goes to fix", () => {
    expect(transition("qa", 1, QA_FAIL)).toEqual(["fix", 1]);
  });
  it("review_no_blocking goes to merge", () => {
    expect(transition("review", 1, REVIEW_NO_BLOCKING)).toEqual(["merge", 1]);
  });
  it("review_blocking_code goes to fix", () => {
    expect(transition("review", 1, REVIEW_BLOCKING_CODE)).toEqual(["fix", 1]);
  });
  it("review_blocking_proposal goes to propose", () => {
    expect(transition("review", 1, REVIEW_BLOCKING_PROPOSAL)).toEqual(["propose", 1]);
  });
  it("fix_done goes to gate", () => {
    expect(transition("fix", 1, FIX_DONE)).toEqual(["gate", 1]);
  });
  it("merge finish_done goes to teardown", () => {
    expect(transition("merge", 1, FINISH_DONE)).toEqual(["teardown", 1]);
  });
  it("teardown_done goes to done", () => {
    expect(transition("teardown", 1, TEARDOWN_DONE)).toEqual(["done", 1]);
  });
  it("propose_clean goes to apply", () => {
    expect(transition("proposal_review", 0, PROPOSE_CLEAN)).toEqual(["apply", 0]);
  });
  it("propose_blocking_proposal goes to propose", () => {
    expect(transition("proposal_review", 0, PROPOSE_BLOCKING_PROPOSAL)).toEqual(["propose", 0]);
  });
  it("propose_blocking_design escalates", () => {
    expect(transition("proposal_review", 0, PROPOSE_BLOCKING_DESIGN)).toEqual(["escalated", 0]);
  });
  it("propose_done goes to proposal_review", () => {
    expect(transition("propose", 0, PROPOSE_DONE)).toEqual(["proposal_review", 0]);
  });
  it("propose_retry_exceeded escalates", () => {
    expect(transition("proposal_review", 0, PROPOSE_RETRY_EXCEEDED)).toEqual(["escalated", 0]);
  });
  it("gate_retry_exceeded escalates", () => {
    expect(transition("gate", 1, GATE_RETRY_EXCEEDED)).toEqual(["escalated", 1]);
  });
  it("human_resume_propose from escalated goes to propose", () => {
    expect(transition("escalated", 0, HUMAN_RESUME_PROPOSE)).toEqual(["propose", 0]);
  });
  // Python transition() for HUMAN_RESUME_FIX returns (fix, iteration) unchanged
  // (no +1). The brief's draft asserted ["fix", 1]; verified against
  // devloop/statemachine.py line 167-168 and corrected to ["fix", 0].
  // Counter resets (iteration/propose_attempts/gate_failures = 0) happen in
  // cli.py's _cmd_event, NOT inside transition() itself — out of scope here.
  it("human_resume_fix from escalated goes to fix (iteration unchanged)", () => {
    expect(transition("escalated", 0, HUMAN_RESUME_FIX)).toEqual(["fix", 0]);
  });
  it("invalid transition throws", () => {
    expect(() => transition("apply", 0, GATE_PASS)).toThrow(InvalidTransition);
  });

  it("every (phase,event) pair outside the frozen edge table throws", () => {
    expect(VALID.length).toBe(20);
    for (const p of PHASES) {
      for (const e of ALL_EVENTS) {
        if (validKeys.has(`${p}|${e}`)) continue;
        expect(() => transition(p, 0, e), `${p}/${e}`).toThrow(InvalidTransition);
      }
    }
  });
});

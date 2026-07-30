import { describe, it, expect } from "vitest";
import { nextHint } from "./statemachine.js";

describe("nextHint", () => {
  it("always starts with 'next: '", () => {
    expect(nextHint("apply", ".devloop/cp.json")).toMatch(/^next: /);
  });
  it("done is terminal", () => {
    expect(nextHint("done", "f")).toContain("(done)");
  });
  it("gate with configured gate_cmds gives runnable command", () => {
    const h = nextHint("gate", "f", { gateCmds: ["pytest"] });
    expect(h).toContain("devloop gate --file f");
    expect(h).not.toContain("<test-cmd>");
  });
  it("gate without gate_cmds gives skeleton", () => {
    expect(nextHint("gate", "f")).toContain("<test-cmd>");
  });
  it("qa light non-uiux hints qa_skip", () => {
    const h = nextHint("qa", "f", { flowProfile: "light", needsUiux: false });
    expect(h).toContain("--event qa_skip");
  });
  it("qa light+uiux does NOT skip", () => {
    const h = nextHint("qa", "f", { flowProfile: "light", needsUiux: true });
    expect(h).not.toContain("qa_skip");
  });
  it("teardown with finish_mode gives runnable mode", () => {
    const h = nextHint("teardown", "f", { finishMode: "merge" });
    expect(h).toContain("--mode merge");
  });
  it("pending units surface first", () => {
    const h = nextHint("apply", "f", { units: [{ id: "g1", status: "pending" }] });
    expect(h).toContain("units pending: g1");
  });

  // Finding 1: prototype-chain hazard. `phase in TABLE` on a plain object
  // literal also matches inherited Object.prototype keys, so an invalid
  // phase equal to a prototype method name must still throw (matches
  // Python's next_hint, which raises KeyError for any unrecognized phase).
  it.each(["constructor", "toString", "valueOf"])(
    "throws for prototype-polluting phase %s",
    (phase) => {
      expect(() => nextHint(phase, "f")).toThrow();
    },
  );

  // Finding 2: expand phase coverage. Expected strings below are derived
  // directly from devloop/statemachine.py's next_hint (read, not guessed).

  it("review with pending legs surfaces pending legs", () => {
    const h = nextHint("review", "f", {
      reviewLegs: [
        { kind: "code", status: "pending" },
        { kind: "tests", status: "collected" },
      ],
    });
    expect(h).toBe(
      "next: legs pending: code -> devloop leg-done --file f --kind <kind> --report <report.json>",
    );
  });

  it("review with all legs collected falls through to deterministic hint", () => {
    const h = nextHint("review", "f", {
      reviewLegs: [
        { kind: "code", status: "collected" },
        { kind: "tests", status: "collected" },
      ],
    });
    expect(h).toBe("next: devloop review --file f --from-legs");
  });

  it("legs pending check does NOT apply to qa phase", () => {
    // The legs-pending guard is deliberately gated on phase === "review" only.
    // Setting pending legs while phase is "qa" must not mention legs at all.
    const h = nextHint("qa", "f", {
      reviewLegs: [{ kind: "code", status: "pending" }],
    });
    expect(h).not.toContain("legs pending");
    expect(h).toBe("next: devloop qa --file f --report <qa.json>");
  });

  it("apply with all units done falls through to judgment hint", () => {
    const h = nextHint("apply", "f", {
      units: [{ id: "g1", status: "done" }],
    });
    expect(h).toBe(
      "next: dispatch apply(TDD 實作 tasks,完成後 event --event apply_done)",
    );
  });

  it("fix with all units done falls through to judgment hint", () => {
    const h = nextHint("fix", "f", {
      units: [{ id: "g1", status: "done" }],
    });
    expect(h).toBe(
      "next: dispatch fix(處理 blocking 項,完成後 event --event fix_done)",
    );
  });

  it("bare hint for merge", () => {
    expect(nextHint("merge", "f")).toBe(
      "next: devloop finish --file f --config <config.json> --meta <meta.json> --followup <followup.md>",
    );
  });

  it("bare hint for proposal_review", () => {
    expect(nextHint("proposal_review", "f")).toBe(
      "next: devloop proposal-review --file f --report <pr.json>",
    );
  });

  it("bare hint for brainstorm", () => {
    expect(nextHint("brainstorm", "f")).toBe(
      "next: dispatch brainstorming(產出設計文件,批准後 propose)",
    );
  });

  it("bare hint for propose", () => {
    expect(nextHint("propose", "f")).toBe(
      "next: dispatch propose(建立 OpenSpec change,完成後 event --event propose_done)",
    );
  });

  it("bare hint for fix", () => {
    expect(nextHint("fix", "f")).toBe(
      "next: dispatch fix(處理 blocking 項,完成後 event --event fix_done)",
    );
  });

  it("bare hint for escalated", () => {
    expect(nextHint("escalated", "f")).toBe(
      "next: (escalated)人工升級後續跑:event --event human_resume_propose 或 human_resume_fix",
    );
  });
});

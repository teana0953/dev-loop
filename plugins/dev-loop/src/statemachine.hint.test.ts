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
});

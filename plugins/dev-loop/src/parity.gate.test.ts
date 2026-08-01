import { describe, it, expect } from "vitest";
import { parityCases, resolveExpectation, expectSubset } from "./parityFixture.js";
import { runGate, type CommandRunner, type RunOutcome } from "./gate.js";

const SECTIONS = ["runGate"];

describe("parity: runGate", () => {
  for (const c of parityCases("gate", "runGate", SECTIONS)) {
    it(c.name, () => {
      const { expect: want, throws } = resolveExpectation(c);
      expect(throws, "runGate never raises").toBe(false);

      const outcomes = c.outcomes as Array<Record<string, unknown>>;
      let i = 0;
      // 被多呼叫必須拋錯——這是短路行為的真正斷言(見 fixture 註解)。
      const runner: CommandRunner = () => {
        if (i >= outcomes.length) {
          throw new Error(
            `${c.name}: runner called ${i + 1} times but fixture only provides ${outcomes.length} outcomes (short-circuit violated)`,
          );
        }
        const o = outcomes[i++] as Record<string, unknown>;
        const outcome: RunOutcome = {
          code: (o.code as number | undefined) ?? 0,
          stdout: (o.stdout as string | undefined) ?? "",
          stderr: (o.stderr as string | undefined) ?? "",
          timedOut: (o.timed_out as boolean | undefined) ?? false,
        };
        return outcome;
      };

      const got = runGate(c.commands as string[][], {
        timeout: (c.timeout as number | undefined) ?? 600,
        runner,
      });
      expectSubset(got as unknown as Record<string, unknown>, want!, c.name);
    });
  }
});

import { describe, it, expect } from "vitest";
import { engineVersion } from "./index.js";

describe("engineVersion", () => {
  it("returns the engine version string", () => {
    expect(engineVersion()).toBe("0.6.0");
  });
});

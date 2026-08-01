import { describe, it, expect } from "vitest";
import { allDone, buildUnits, mark, type Unit } from "./units.js";

describe("mark", () => {
  it("mutates in place rather than returning a new array", () => {
    const units: Unit[] = [
      { id: "a", tasks: [], worktree: "w/a", branch: "b-a", status: "pending" },
    ];
    const same = units[0];
    mark(units, "a", "done");
    expect(units[0]).toBe(same);
    expect(same!.status).toBe("done");
  });
});

describe("buildUnits", () => {
  it("does not alias the input groups", () => {
    const groups = [{ id: "g1", tasks: ["a"] }];
    const built = buildUnits(groups, "b", "w");
    expect(built[0]!.tasks).toBe(groups[0]!.tasks);
    // Python 同樣是直接放 g.get("tasks") 的物件,不複製——這裡固定住這個事實,
    // 免得日後有人「順手」加了深複製,讓兩個引擎的別名語意分家。
  });
});

describe("allDone", () => {
  it("is false for an empty list even though every() would be true", () => {
    expect([].every(() => false)).toBe(true);
    expect(allDone([])).toBe(false);
  });
});

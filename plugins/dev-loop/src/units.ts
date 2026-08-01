import { pyGet, pyIndex, pyTruthy } from "./jsonio.js";

const PENDING = ["pending", "in_progress"];
const DONE_OR_MERGED = ["done", "merged"];

export interface Unit {
  id: string;
  // Python 對 tasks 不做任何驗證或轉型(data.get("tasks", [])),原樣保留
  tasks: unknown;
  worktree: string;
  branch: string;
  status: string;
}

/** 由 change meta 的 parallel_groups 展開成 units(規格:平行執行單元)。 */
export function buildUnits(parallelGroups: unknown[], branch: string, wtRoot: string): Unit[] {
  const units: Unit[] = [];
  for (const raw of parallelGroups) {
    const g = raw as Record<string, unknown>;
    // Python: g["id"] —— 缺 id 是 KeyError,不是產一個 id 為 undefined 的 unit
    const gid = pyIndex<string>(g, "id");
    units.push({
      id: gid,
      // Python: g.get("tasks", []) —— 顯式 null 要原樣保留,不得替換成 []
      tasks: pyGet<unknown>(g, "tasks", []),
      worktree: `${wtRoot}/${gid}`,
      branch: `${branch}-${gid}`,
      status: "pending",
    });
  }
  return units;
}

export function pendingUnits(units: Unit[]): Unit[] {
  return units.filter((u) => PENDING.includes(pyIndex<string>(u as unknown as Record<string, unknown>, "status")));
}

/** 就地改 unit 狀態;找不到 unit_id 拋錯(Python 的 KeyError)。 */
export function mark(units: Unit[], unitId: string, status: string): void {
  for (const u of units) {
    // Python: u["id"] —— 缺 id 是 KeyError,而且只在迴圈真的走到那個 unit 時才炸;
    // 命中之後就 return,永遠不會摸到後面缺 id 的 unit。用 obj.id 讀不出這個「炸在
    // 哪一步」的時機差,必須跟其他函式一樣走 pyIndex。
    if (pyIndex<string>(u as unknown as Record<string, unknown>, "id") === unitId) {
      u.status = status;
      return;
    }
  }
  throw new Error(`no unit ${JSON.stringify(unitId)}`);
}

/**
 * Python: `bool(units) and all(...)`。
 *
 * `units.every(...)` 對空陣列回 true——一個沒有任何 unit 的 checkpoint 會被
 * 判成「全部完成」直接放行進 merge。空集合的 all() 為真是兩個語言共通的,
 * 真正的守門是前面那個 `bool(units)`,移植時不能掉。
 */
export function allDone(units: Unit[]): boolean {
  return pyTruthy(units)
    && units.every((u) => DONE_OR_MERGED.includes(pyIndex<string>(u as unknown as Record<string, unknown>, "status")));
}

export function allMerged(units: Unit[]): boolean {
  return pyTruthy(units)
    && units.every((u) => pyIndex<string>(u as unknown as Record<string, unknown>, "status") === "merged");
}

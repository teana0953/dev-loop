import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonObject } from "./jsonio.js";

export interface Checkpoint {
  phase: string;
  change_id: string;
  branch: string;
  iteration: number;
  last_artifact: string;
  non_blocking: string[];
  updated_at: string;
  resume_exec: string | null;
  units: unknown[];
  review_legs: unknown[];
  propose_attempts: number;
  gate_failures: number;
  finish_mode: string | null;
  flow_profile: string;
  needs_uiux: boolean;
}

const DEFAULTS: Omit<Checkpoint, "phase" | "change_id" | "branch"> = {
  iteration: 0,
  last_artifact: "",
  non_blocking: [],
  updated_at: "",
  resume_exec: null,
  units: [],
  review_legs: [],
  propose_attempts: 0,
  gate_failures: 0,
  finish_mode: null,
  flow_profile: "full",
  needs_uiux: false,
};

export function makeCheckpoint(
  partial: Pick<Checkpoint, "phase" | "change_id" | "branch"> & Partial<Checkpoint>,
): Checkpoint {
  return { ...DEFAULTS, ...partial };
}

export function saveCheckpoint(cp: Checkpoint, path: string): void {
  cp.updated_at = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cp, null, 2), "utf-8");
}

// phase/change_id/branch have no default in Python's @dataclass Checkpoint
// (they are required positional/keyword args); every other field has a
// default via `field(default_factory=...)` or a literal. cls(**data) raises
// TypeError if a required key is missing OR if data contains a key that
// isn't a declared field ("unexpected keyword argument"). Both checks below
// exist to reproduce that, not just the required-field half of it.
const REQUIRED_CHECKPOINT_KEYS = ["phase", "change_id", "branch"] as const;
const KNOWN_CHECKPOINT_KEYS = new Set<string>([
  ...REQUIRED_CHECKPOINT_KEYS,
  ...Object.keys(DEFAULTS),
]);

export function loadCheckpoint(path: string): Checkpoint {
  const data = readJsonObject(path, "checkpoint");
  for (const key of Object.keys(data)) {
    if (!KNOWN_CHECKPOINT_KEYS.has(key)) {
      // Python's Checkpoint(**data) would raise TypeError: unexpected
      // keyword argument here. Rejecting now (rather than tolerating and
      // dropping the key) matters because TS does not yet *write*
      // checkpoints read from elsewhere -- once it does, a checkpoint that
      // silently round-trips through TS with an extra key would blow up
      // Python on resume, at the worst possible time. Failing at load time,
      // in TS, is strictly easier to diagnose than that.
      throw new Error(`checkpoint has unknown key ${JSON.stringify(key)}`);
    }
  }
  for (const key of REQUIRED_CHECKPOINT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error(`checkpoint missing required key ${JSON.stringify(key)}`);
    }
  }
  return makeCheckpoint(data as unknown as Pick<Checkpoint, "phase" | "change_id" | "branch"> & Partial<Checkpoint>);
}

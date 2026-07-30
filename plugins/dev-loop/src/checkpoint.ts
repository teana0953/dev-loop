import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

export function loadCheckpoint(path: string): Checkpoint {
  const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<Checkpoint>;
  return makeCheckpoint(data as Pick<Checkpoint, "phase" | "change_id" | "branch"> & Partial<Checkpoint>);
}

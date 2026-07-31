import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Computes the path to the history.jsonl file alongside a checkpoint.
 */
export function historyPath(checkpointPath: string): string {
  const checkpointDir = dirname(checkpointPath);
  return resolve(checkpointDir, "history.jsonl");
}

/**
 * Appends a state transition record to the history file (append-only, one JSON object per line).
 * Creates the parent directory if it does not exist.
 */
export function appendHistory(
  checkpointPath: string,
  event: string,
  fromPhase: string,
  toPhase: string,
  iteration: number,
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    from: fromPhase,
    to: toPhase,
    iteration,
  };

  const histPath = historyPath(checkpointPath);
  const histDir = dirname(histPath);
  mkdirSync(histDir, { recursive: true });

  writeFileSync(histPath, JSON.stringify(entry) + "\n", { flag: "a", encoding: "utf-8" });
}

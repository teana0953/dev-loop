import { writeFileSync } from "node:fs";

export function renderFollowup(notes: string[]): string {
  if (notes.length === 0) {
    return "";
  }
  const lines = ["## Follow-up(non-blocking)", ""];
  lines.push(...notes.map((n) => "- " + n));
  return lines.join("\n") + "\n";
}

export function writeFollowup(path: string, notes: string[]): void {
  writeFileSync(path, renderFollowup(notes), "utf-8");
}

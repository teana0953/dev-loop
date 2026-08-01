import { readFileSync } from "node:fs";
import { pyGet } from "./jsonio.js";
import {
  PROPOSE_BLOCKING_DESIGN, PROPOSE_BLOCKING_PROPOSAL, PROPOSE_CLEAN,
  QA_FAIL, QA_PASS,
  REVIEW_BLOCKING_CODE, REVIEW_BLOCKING_PROPOSAL, REVIEW_NO_BLOCKING,
} from "./statemachine.js";

export type Finding = Record<string, unknown>;

/**
 * review 報告非法(檔案缺失、非 JSON、schema 不符)。格式錯必須 fail loudly,
 * 不得與「findings 為空(=pass)」混同。
 *
 * 是一個具名子類而非裸 Error,好讓 CLI 用 instanceof 把「報告壞掉」和
 * 其他例外分開處理(Python 那側是 ReportError(ValueError))。
 */
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

function blockingOf(findings: Finding[]): Finding[] {
  // Python: f.get("severity") —— 缺鍵回 None,不是 KeyError
  return findings.filter((f) => pyGet<unknown>(f, "severity", null) === "blocking");
}

/**
 * 將 review findings 映射成狀態機事件(規格 5)。
 *
 * 任一 proposal 層級 blocking → 逃生門(回 propose);
 * 否則有 code blocking → fix;全無 blocking → merge。
 */
export function classify(findings: Finding[]): string {
  const blocking = blockingOf(findings);
  if (blocking.length === 0) {
    return REVIEW_NO_BLOCKING;
  }
  if (blocking.some((f) => pyGet<unknown>(f, "level", null) === "proposal")) {
    return REVIEW_BLOCKING_PROPOSAL;
  }
  return REVIEW_BLOCKING_CODE;
}

/**
 * Proposal review 分類:design 層 blocking 優先 → 升級;
 * proposal 層 blocking → 回 propose;無 blocking → clean。
 */
export function classifyProposal(findings: Finding[]): string {
  const blocking = blockingOf(findings);
  if (blocking.length === 0) {
    return PROPOSE_CLEAN;
  }
  if (blocking.some((f) => pyGet<unknown>(f, "level", null) === "design")) {
    return PROPOSE_BLOCKING_DESIGN;
  }
  return PROPOSE_BLOCKING_PROPOSAL;
}

/** 抽出 non-blocking 項的 note 文字供 follow-up。 */
export function nonBlockingNotes(findings: Finding[]): unknown[] {
  return findings
    .filter((f) => pyGet<unknown>(f, "severity", null) === "non_blocking")
    .map((f) => pyGet<unknown>(f, "note", ""));
}

export const VALID_SEVERITIES = ["blocking", "non_blocking"] as const;

export function parseReviewReport(path: string): Finding[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (exc) {
    throw new ReportError(`cannot read report ${path}: ${String(exc)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (exc) {
    throw new ReportError(`report ${path} is not valid JSON: ${String(exc)}`);
  }
  if (
    typeof data !== "object" || data === null || Array.isArray(data)
    || !Object.prototype.hasOwnProperty.call(data, "findings")
  ) {
    throw new ReportError(`report ${path} missing "findings" key`);
  }
  const findings = (data as Record<string, unknown>).findings;
  if (!Array.isArray(findings)) {
    throw new ReportError(`report ${path} "findings" must be a list`);
  }
  findings.forEach((finding, i) => {
    if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
      throw new ReportError(`report ${path} findings[${i}] must be an object`);
    }
    const f = finding as Finding;
    const severity = pyGet<unknown>(f, "severity", null);
    if (!(VALID_SEVERITIES as readonly unknown[]).includes(severity)) {
      throw new ReportError(
        `report ${path} findings[${i}] invalid severity ${JSON.stringify(severity)} `
        + `(expected blocking|non_blocking)`,
      );
    }
    // note 走到 render_followup 就是要被字串串接的。不驗型別的話,一個
    // {"note": 42} 會安靜地活到 merge 階段才出事,而且兩個引擎的出事方式
    // 不同——報告解析當下就拒收,錯誤位置才有意義。
    if (Object.prototype.hasOwnProperty.call(f, "note") && typeof f.note !== "string") {
      throw new ReportError(
        `report ${path} findings[${i}] note must be a string, got ${JSON.stringify(f.note)}`,
      );
    }
  });
  return findings as Finding[];
}

/** 把多個 review 報告的 findings 串接成單一 list(供 code+uiux legs 彙總)。 */
export function aggregateFindings(reportPaths: string[]): Finding[] {
  const merged: Finding[] = [];
  for (const path of reportPaths) {
    merged.push(...parseReviewReport(path));
  }
  return merged;
}

/** QA 報告分類:任一 blocking → QA_FAIL;否則 QA_PASS。 */
export function classifyQa(findings: Finding[]): string {
  return blockingOf(findings).length > 0 ? QA_FAIL : QA_PASS;
}

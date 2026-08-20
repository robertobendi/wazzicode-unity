import { promises as fs } from "node:fs";

/**
 * Minimal NUnit3 report reader for headless test runs.
 *
 * The batch-mode `unity test` writes the same NUnit XML the Test Runner window produces, but the
 * CLI's own JSON envelope only reports whether the *process* succeeded. To give the agent the same
 * verdict shape the in-Editor `unity_run_tests` returns, we read the counts and the failures out
 * of the report ourselves. Deliberately regex-based: pulling in an XML parser for four attributes
 * and a message element is not worth the dependency, and the file is machine-generated.
 */

export interface BatchTestFailure {
  name: string;
  message?: string;
  stackTrace?: string;
}

export interface BatchTestReport {
  result?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  inconclusive: number;
  durationSec?: number;
  failures: BatchTestFailure[];
  /** True when more failures exist in the file than are listed here. */
  failuresTruncated: boolean;
}

const MAX_FAILURES = 25;

export function parseNUnitReport(xml: string): BatchTestReport | null {
  const run = /<test-run\b([^>]*)>/.exec(xml);
  if (!run) return null;
  const attrs = run[1];
  const num = (name: string): number => {
    const raw = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
    const value = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : 0;
  };
  const duration = new RegExp('\\bduration="([^"]*)"').exec(attrs)?.[1];
  const failures: BatchTestFailure[] = [];
  let failuresTruncated = false;

  // Failed leaf test-cases only: a failed suite repeats its children's messages. Passing cases are
  // written self-closing (`<test-case ... />`), so the pattern must accept both forms — matching
  // only the paired form would swallow a following failure inside a passing case's "body".
  const caseRe = /<test-case\b([^>]*?)(?:\/>|>([\s\S]*?)<\/test-case>)/g;
  let match: RegExpExecArray | null;
  while ((match = caseRe.exec(xml)) !== null) {
    const caseAttrs = match[1];
    if (!/\bresult="(Failed|Error)"/.test(caseAttrs)) continue;
    if (failures.length >= MAX_FAILURES) {
      failuresTruncated = true;
      break;
    }
    const body = match[2] ?? "";
    failures.push({
      name: /\bfullname="([^"]*)"/.exec(caseAttrs)?.[1] ?? /\bname="([^"]*)"/.exec(caseAttrs)?.[1] ?? "(unnamed test)",
      ...(pickText(body, "message") ? { message: pickText(body, "message") } : {}),
      ...(pickText(body, "stack-trace") ? { stackTrace: pickText(body, "stack-trace") } : {}),
    });
  }

  return {
    ...(new RegExp('\\bresult="([^"]*)"').exec(attrs)?.[1]
      ? { result: new RegExp('\\bresult="([^"]*)"').exec(attrs)![1] }
      : {}),
    total: num("total") || num("testcasecount"),
    passed: num("passed"),
    failed: num("failed"),
    skipped: num("skipped"),
    inconclusive: num("inconclusive"),
    ...(duration && Number.isFinite(Number(duration)) ? { durationSec: Number(duration) } : {}),
    failures,
    failuresTruncated,
  };
}

export async function readNUnitReport(file: string): Promise<BatchTestReport | null> {
  try {
    return parseNUnitReport(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function pickText(body: string, tag: string): string | undefined {
  const raw = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1];
  if (raw === undefined) return undefined;
  const text = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return text.length > 0 ? text.slice(0, 2_000) : undefined;
}

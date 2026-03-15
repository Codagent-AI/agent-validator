import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReviewFullJsonOutput } from '../gates/result.js';
import type { GauntletStatus } from '../types/gauntlet-status.js';

/**
 * A numbered review violation with metadata for report and update-review.
 */
export interface NumberedViolation {
  /** Sequential numeric ID (1-based) */
  id: number;
  /** Gate label (e.g., "review:src:code-quality") */
  gateLabel: string;
  /** Adapter suffix (e.g., "claude@1") */
  adapterSuffix: string;
  /** File path */
  file: string;
  /** Line number */
  line: number | string;
  /** Issue description */
  issue: string;
  /** Fix suggestion */
  fix?: string;
  /** Priority level */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Path to the JSON file containing the violation */
  jsonPath: string;
  /** Index within the violations array in the JSON file */
  violationIndex: number;
}

/**
 * Parse a review JSON filename to extract the job ID and review index.
 * Format: <jobId>_<adapter>@<reviewIndex>.<runNumber>.json
 */
function parseReviewJsonFilename(
  filename: string,
): { jobId: string; adapter: string; reviewIndex: number } | null {
  const m = filename.match(/^(.+)_([^@]+)@(\d+)\.\d+\.json$/);
  if (!(m?.[1] && m[2] && m[3])) return null;
  return {
    jobId: m[1],
    adapter: m[2],
    reviewIndex: parseInt(m[3], 10),
  };
}

/** Collect new violations from a single JSON file. */
async function collectViolationsFromFile(
  jsonPath: string,
  filename: string,
  startId: number,
): Promise<NumberedViolation[]> {
  const content = await fs.readFile(jsonPath, 'utf-8');
  const data: ReviewFullJsonOutput = JSON.parse(content);

  if (!(data.violations && Array.isArray(data.violations))) return [];

  const parsed = parseReviewJsonFilename(filename);
  if (!parsed) return [];

  const violations: NumberedViolation[] = [];
  let nextId = startId;

  for (let i = 0; i < data.violations.length; i++) {
    const v = data.violations[i];
    if (!v) continue;
    const status = v.status || 'new';
    if (status !== 'new') continue;

    violations.push({
      id: nextId++,
      gateLabel: parsed.jobId,
      adapterSuffix: `${data.adapter}@${parsed.reviewIndex}`,
      file: v.file,
      line: v.line,
      issue: v.issue,
      fix: v.fix,
      priority: v.priority,
      jsonPath,
      violationIndex: i,
    });
  }

  return violations;
}

/**
 * Enumerate all violations with status "new" from review JSON files in sorted
 * filename order, assigning sequential numeric IDs. This shared function is
 * used by both the report generator and the update-review command to ensure
 * ID stability.
 */
export async function enumerateNewViolations(
  logDir: string,
): Promise<NumberedViolation[]> {
  let files: string[];
  try {
    files = await fs.readdir(logDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
  const allViolations: NumberedViolation[] = [];

  for (const file of jsonFiles) {
    try {
      const fileViolations = await collectViolationsFromFile(
        path.join(logDir, file),
        file,
        allViolations.length + 1,
      );
      allViolations.push(...fileViolations);
    } catch {
      // Skip unparseable files
    }
  }

  return allViolations;
}

/**
 * Map gauntlet status to the report status line text.
 */
export function statusLineText(status: GauntletStatus): string {
  switch (status) {
    case 'passed':
      return 'Status: Passed';
    case 'passed_with_warnings':
      return 'Status: Passed with warnings';
    case 'failed':
      return 'Status: Failed';
    case 'retry_limit_exceeded':
      return 'Status: Retry limit exceeded';
    default:
      return `Status: ${status}`;
  }
}

/** Minimal gate result shape needed for report generation. */
interface ReportGateResult {
  jobId: string;
  status: 'pass' | 'fail' | 'error';
  command?: string;
  workingDirectory?: string;
  fixInstructions?: string;
  fixWithSkill?: string;
  logPath?: string;
}

/** Format a single check failure into report lines. */
function formatCheckFailure(result: ReportGateResult): string[] {
  const lines: string[] = [];
  lines.push(`### ${result.jobId}`);
  if (result.command) lines.push(`Command: ${result.command}`);
  if (result.workingDirectory)
    lines.push(`Directory: ${result.workingDirectory}`);
  if (result.fixInstructions)
    lines.push(`Fix instructions: ${result.fixInstructions}`);
  if (result.fixWithSkill) lines.push(`Fix skill: ${result.fixWithSkill}`);
  if (result.logPath) lines.push(`Log: ${result.logPath}`);
  lines.push('');
  return lines;
}

/** Format a single review violation into report lines. */
function formatReviewViolation(v: NumberedViolation): string[] {
  const lines: string[] = [];
  const priorityStr = v.priority ? ` [${v.priority}]` : '';
  lines.push(`#${v.id}${priorityStr} ${v.gateLabel} (${v.adapterSuffix})`);
  lines.push(`  ${v.file}:${v.line} - ${v.issue}`);
  if (v.fix) lines.push(`  Fix: ${v.fix}`);
  lines.push(`  JSON: ${v.jsonPath}`);
  lines.push('');
  return lines;
}

/**
 * Generate a plain-text failure report for the --report flag.
 * The report is self-contained and agent-actionable.
 */
export async function generateReport(
  status: GauntletStatus,
  gateResults: ReportGateResult[] | undefined,
  logDir: string,
): Promise<string> {
  const lines: string[] = [statusLineText(status)];

  if (!gateResults || gateResults.length === 0) {
    return lines.join('\n');
  }

  const checkFailures = gateResults.filter(
    (r) =>
      (r.status === 'fail' || r.status === 'error') &&
      r.jobId.startsWith('check:'),
  );

  if (checkFailures.length > 0) {
    lines.push('', '## CHECK FAILURES', '');
    for (const result of checkFailures) {
      lines.push(...formatCheckFailure(result));
    }
  }

  const reviewViolations = await enumerateNewViolations(logDir);
  if (reviewViolations.length > 0) {
    lines.push('## REVIEW VIOLATIONS', '');
    for (const v of reviewViolations) {
      lines.push(...formatReviewViolation(v));
    }
  }

  return lines.join('\n');
}

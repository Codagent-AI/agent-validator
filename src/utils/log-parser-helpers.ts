import path from 'node:path';
import type { PreviousViolation } from '../gates/result.js';

// ---- Types ----

export interface AdapterFailure {
  adapterName: string;
  reviewIndex?: number;
  violations: PreviousViolation[];
}

export interface PassedSlot {
  reviewIndex: number;
  passIteration: number;
  adapter: string;
}

export interface PreviousFailuresResult {
  failures: GateFailures[];
  passedSlots: Map<string, Map<number, PassedSlot>>;
}

export interface GateFailures {
  jobId: string;
  gateName: string;
  entryPoint: string;
  adapterFailures: AdapterFailure[];
  logPath: string;
}

export interface RunIteration {
  iteration: number;
  fixed: Array<{
    jobId: string;
    adapter?: string;
    details: string;
  }>;
  skipped: Array<{
    jobId: string;
    adapter?: string;
    file: string;
    line: number | string;
    issue: string;
    result?: string | null;
  }>;
}

// ---- Shared type for parser function references ----

export type ParseFileFn = (filePath: string) => Promise<GateFailures | null>;

// ---- Low-level parsing functions ----

/**
 * Parse a review filename to extract the job ID, adapter, review index, and run number.
 */
export function parseReviewFilename(filename: string): {
  jobId: string;
  adapter: string;
  reviewIndex: number;
  runNumber: number;
  ext: string;
} | null {
  const m = filename.match(/^(.+)_([^@]+)@(\d+)\.(\d+)\.(log|json)$/);
  if (!m) return null;
  const [, jobId, adapter, indexStr, runStr, ext] = m;
  if (!(jobId && adapter && indexStr && runStr && ext)) return null;
  return {
    jobId,
    adapter,
    reviewIndex: parseInt(indexStr, 10),
    runNumber: parseInt(runStr, 10),
    ext,
  };
}

/**
 * Extract the log prefix (job ID) from a numbered log filename.
 */
export function extractPrefix(filename: string): string {
  const m = filename.match(/^(.+)\.\d+\.(log|json)$/);
  if (m?.[1]) return m[1];
  return filename.replace(/\.(log|json)$/, '');
}

// ---- parseLogFile helpers ----

interface LogSection {
  adapter: string;
  startIndex: number;
}

/**
 * Extracts review sections from log content by matching section headers.
 */
function extractReviewSections(content: string): LogSection[] {
  const sectionRegex = /--- Review Output \(([^)]+)\) ---/g;
  const sections: LogSection[] = [];
  let match: RegExpExecArray | null;
  for (;;) {
    match = sectionRegex.exec(content);
    if (!match?.[1]) break;
    sections.push({ adapter: match[1], startIndex: match.index });
  }
  return sections;
}

/**
 * Extracts a "Fix:" annotation from the remainder text after a violation.
 */
function extractFixFromRemainder(remainder: string): string | undefined {
  const fixMatch = remainder.match(/^\s+Fix:\s+(.+)$/m);
  const nextViolationIndex = remainder.search(/^\d+\./m);
  if (
    fixMatch?.index !== undefined &&
    fixMatch[1] &&
    (nextViolationIndex === -1 || fixMatch.index < nextViolationIndex)
  ) {
    return fixMatch[1].trim();
  }
  return undefined;
}

/**
 * Parses violations from the "Parsed Result" block within a review section.
 */
function parseViolationsFromParsedResult(
  parsedContent: string,
): PreviousViolation[] {
  const violations: PreviousViolation[] = [];
  const violationRegex = /^\d+\.\s+(.+?):(\d+|NaN|\?)\s+-\s+(.+)$/gm;
  let vMatch: RegExpExecArray | null;
  for (;;) {
    vMatch = violationRegex.exec(parsedContent);
    if (!(vMatch?.[1] && vMatch[2] && vMatch[3])) break;
    const file = vMatch[1].trim();
    let line: number | string = vMatch[2];
    if (line !== 'NaN' && line !== '?') line = parseInt(line as string, 10);
    const issue = vMatch[3].trim();
    const fix = extractFixFromRemainder(
      parsedContent.substring(vMatch.index + vMatch[0].length),
    );
    violations.push({ file, line, issue, fix });
  }
  return violations;
}

/**
 * Extracts violations from a section by trying JSON fallback parsing.
 */
function parseViolationsFromJson(sectionContent: string): PreviousViolation[] {
  const violations: PreviousViolation[] = [];
  const firstBrace = sectionContent.indexOf('{');
  const lastBrace = sectionContent.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return violations;
  }
  try {
    const jsonStr = sectionContent.substring(firstBrace, lastBrace + 1);
    const json = JSON.parse(jsonStr);
    if (json.violations && Array.isArray(json.violations)) {
      for (const v of json.violations) {
        if (v.file && v.issue) {
          violations.push({
            file: v.file,
            line: v.line || 0,
            issue: v.issue,
            fix: v.fix,
            status: v.status,
            result: v.result,
          });
        }
      }
    }
  } catch (_e) {}
  return violations;
}

/**
 * Processes a single review section and returns an AdapterFailure if violations found.
 */
function processReviewSection(
  content: string,
  sections: LogSection[],
  sectionIndex: number,
  parsed: { reviewIndex: number } | null,
): AdapterFailure | null {
  const currentSection = sections[sectionIndex];
  if (!currentSection) return null;

  const nextSection = sections[sectionIndex + 1];
  const endIndex = nextSection ? nextSection.startIndex : content.length;
  const sectionContent = content.substring(currentSection.startIndex, endIndex);

  const parsedResultMatch = sectionContent.match(
    /---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---([\s\S]*?)(?:$|---)/,
  );

  let violations: PreviousViolation[];
  if (parsedResultMatch?.[2]) {
    const parsedContent = parsedResultMatch[2];
    if (parsedContent.includes('Status: PASS')) return null;
    violations = parseViolationsFromParsedResult(parsedContent);
  } else {
    violations = parseViolationsFromJson(sectionContent);
  }

  if (violations.length > 0) {
    return {
      adapterName: currentSection.adapter,
      reviewIndex: parsed?.reviewIndex,
      violations,
    };
  }
  if (parsedResultMatch?.[2]?.includes('Status: FAIL')) {
    return {
      adapterName: currentSection.adapter,
      reviewIndex: parsed?.reviewIndex,
      violations: [
        {
          file: 'unknown',
          line: '?',
          issue:
            'Previous run failed but specific violations could not be parsed',
        },
      ],
    };
  }
  return null;
}

/**
 * Parses a review-type log into adapter failures.
 */
export function parseReviewLog(
  content: string,
  jobId: string,
  logPath: string,
  parsed: { reviewIndex: number } | null,
): GateFailures | null {
  const sections = extractReviewSections(content);
  if (sections.length === 0) return null;

  const adapterFailures: AdapterFailure[] = [];
  for (let i = 0; i < sections.length; i++) {
    const af = processReviewSection(content, sections, i, parsed);
    if (af) adapterFailures.push(af);
  }

  if (adapterFailures.length === 0) return null;
  return { jobId, gateName: '', entryPoint: '', adapterFailures, logPath };
}

/**
 * Parses a check-type log for pass/fail status.
 */
export function parseCheckLog(
  content: string,
  jobId: string,
  logPath: string,
): GateFailures | null {
  if (content.includes('Result: pass')) return null;

  const hasFailure =
    content.includes('Result: fail') ||
    content.includes('Result: error') ||
    content.includes('Command failed:');

  if (!hasFailure) return null;

  return {
    jobId,
    gateName: '',
    entryPoint: '',
    adapterFailures: [
      {
        adapterName: 'check',
        violations: [{ file: 'check', line: 0, issue: 'Check failed' }],
      },
    ],
    logPath,
  };
}

// ---- reconstructHistory helpers ----

/**
 * Collects unique run numbers from log/json filenames.
 */
export function collectRunNumbers(files: string[]): number[] {
  const runNumbers = new Set<number>();
  for (const file of files) {
    const m = file.match(/\.(\d+)\.(log|json)$/);
    if (m?.[1]) runNumbers.add(parseInt(m[1], 10));
  }
  return Array.from(runNumbers).sort((a, b) => a - b);
}

/**
 * Parses failures for a single prefix within a run.
 */
async function parseRunFile(
  logDir: string,
  runFiles: string[],
  prefix: string,
  runNum: number,
  parseJsonFn: ParseFileFn,
  parseLogFn: ParseFileFn,
): Promise<GateFailures | null> {
  const jsonFile = runFiles.find(
    (f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith('.json'),
  );
  const logFile = runFiles.find(
    (f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith('.log'),
  );

  if (jsonFile) return parseJsonFn(path.join(logDir, jsonFile));
  if (logFile) return parseLogFn(path.join(logDir, logFile));
  return null;
}

/**
 * Collects current failures and skipped violations for a single iteration.
 */
export async function collectIterationFailures(
  logDir: string,
  files: string[],
  runNum: number,
  parseJsonFn: ParseFileFn,
  parseLogFn: ParseFileFn,
): Promise<{
  currentFailuresByJob: Map<string, PreviousViolation[]>;
  skipped: RunIteration['skipped'];
}> {
  const currentFailuresByJob = new Map<string, PreviousViolation[]>();
  const skipped: RunIteration['skipped'] = [];

  const runFiles = files.filter((f) => f.includes(`.${runNum}.`));
  const prefixes = new Set(runFiles.map((f) => extractPrefix(f)));

  for (const prefix of prefixes) {
    const failure = await parseRunFile(
      logDir,
      runFiles,
      prefix,
      runNum,
      parseJsonFn,
      parseLogFn,
    );
    if (!failure) continue;

    for (const af of failure.adapterFailures) {
      const key = af.reviewIndex
        ? `${failure.jobId}:${af.reviewIndex}`
        : `${failure.jobId}:${af.adapterName}`;
      currentFailuresByJob.set(key, af.violations);

      for (const v of af.violations) {
        if (v.status === 'skipped') {
          skipped.push({
            jobId: failure.jobId,
            adapter: af.adapterName,
            file: v.file,
            line: v.line,
            issue: v.issue,
            result: v.result,
          });
        }
      }
    }
  }

  return { currentFailuresByJob, skipped };
}

/**
 * Computes which violations from the previous iteration were truly fixed.
 */
export function computeFixedViolations(
  previousFailuresByJob: Map<string, PreviousViolation[]>,
  currentFailuresByJob: Map<string, PreviousViolation[]>,
): RunIteration['fixed'] {
  const fixed: RunIteration['fixed'] = [];

  for (const [key, prevViolations] of previousFailuresByJob.entries()) {
    const current = currentFailuresByJob.get(key);
    const sep = key.lastIndexOf(':');
    const jobId = key.substring(0, sep);
    const adapter = key.substring(sep + 1);

    const trulyFixed = prevViolations.filter((pv) => {
      if (pv.status === 'skipped') return false;
      return !current?.some(
        (cv) =>
          cv.file === pv.file && cv.line === pv.line && cv.issue === pv.issue,
      );
    });

    if (trulyFixed.length === 0) continue;

    if (jobId.startsWith('check_')) {
      fixed.push({
        jobId,
        details: `${trulyFixed.length} violations resolved`,
      });
    } else {
      for (const f of trulyFixed) {
        fixed.push({
          jobId,
          adapter,
          details: `${f.file}:${f.line} ${f.issue}`,
        });
      }
    }
  }

  return fixed;
}

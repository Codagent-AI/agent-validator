import fs from 'node:fs/promises';
import { getCategoryLogger } from '../output/app-logger.js';
import type { GateResult, ReviewFullJsonOutput } from './result.js';
import type {
  ReviewJsonOutput,
  ReviewOutputEntry,
  SkippedSlotOutput,
} from './review-types.js';

const log = getCategoryLogger('gate', 'review');

// ── Result Aggregation ──────────────────────────────────────────────

export function aggregateStatus(outputs: ReviewOutputEntry[]): {
  status: 'pass' | 'fail' | 'error';
  message: string;
} {
  const errored = outputs.filter((r) => r.status === 'error');
  const failed = outputs.filter((r) => r.status === 'fail');

  let status: 'pass' | 'fail' | 'error' = 'pass';
  let message = 'Passed';

  if (errored.length > 0) {
    status = 'error';
    message = `Error in ${errored.length} adapter(s)`;
  } else if (failed.length > 0) {
    status = 'fail';
    message = `Failed by ${failed.length} adapter(s)`;
  }
  return { status, message };
}

export function buildSubResults(
  outputs: ReviewOutputEntry[],
  skippedSlotOutputs: SkippedSlotOutput[],
  logPaths: string[],
): Array<{
  nameSuffix: string;
  status: 'pass' | 'fail' | 'error';
  duration?: number;
  message: string;
  logPath?: string;
  errorCount: number;
  fixedCount: number;
  skipped?: Array<{
    file: string;
    line: number | string;
    issue: string;
    result?: string | null;
  }>;
}> {
  const subResults = outputs.map((out) => buildSingleSubResult(out, logPaths));

  for (const skipped of skippedSlotOutputs) {
    subResults.push(buildSkippedSubResult(skipped, logPaths));
  }

  subResults.sort((a, b) => {
    const aIdx = Number.parseInt(a.nameSuffix.match(/@(\d+)/)?.[1] || '0', 10);
    const bIdx = Number.parseInt(b.nameSuffix.match(/@(\d+)/)?.[1] || '0', 10);
    return aIdx - bIdx;
  });

  return subResults;
}

function findLogForReview(
  adapter: string,
  reviewIndex: number,
  logPaths: string[],
): string | undefined {
  return logPaths.find((p) => {
    const filename = p.split('/').pop() || '';
    return (
      filename.includes(`_${adapter}@${reviewIndex}.`) &&
      filename.endsWith('.log')
    );
  });
}

function buildSingleSubResult(
  out: ReviewOutputEntry,
  logPaths: string[],
): {
  nameSuffix: string;
  status: 'pass' | 'fail' | 'error';
  duration?: number;
  message: string;
  logPath?: string;
  errorCount: number;
  fixedCount: number;
  skipped?: Array<{
    file: string;
    line: number | string;
    issue: string;
    result?: string | null;
  }>;
} {
  const specificLog = findLogForReview(out.adapter, out.reviewIndex, logPaths);

  let logPath = specificLog;
  if (specificLog && out.json && out.status === 'fail') {
    logPath = specificLog.replace(/\.log$/, '.json');
  }

  const errorCount = computeErrorCount(out);
  const fixedCount =
    out.json && Array.isArray(out.json.violations)
      ? out.json.violations.filter((v) => v.status === 'fixed').length
      : 0;

  return {
    nameSuffix: `(${out.adapter}@${out.reviewIndex})`,
    status: out.status,
    duration: out.duration,
    message: out.message,
    logPath,
    errorCount,
    fixedCount,
    skipped: out.skipped,
  };
}

function computeErrorCount(out: ReviewOutputEntry): number {
  if (out.json && Array.isArray(out.json.violations)) {
    return out.json.violations.filter((v) => !v.status || v.status === 'new')
      .length;
  }
  if (out.status === 'fail' || out.status === 'error') {
    return 1;
  }
  return 0;
}

function buildSkippedSubResult(
  skipped: SkippedSlotOutput,
  logPaths: string[],
): {
  nameSuffix: string;
  status: 'pass' | 'fail' | 'error';
  duration?: number;
  message: string;
  logPath?: string;
  errorCount: number;
  fixedCount: number;
  skipped: undefined;
} {
  const specificLog = findLogForReview(
    skipped.adapter,
    skipped.reviewIndex,
    logPaths,
  );
  return {
    nameSuffix: `(${skipped.adapter}@${skipped.reviewIndex})`,
    status: 'pass' as const,
    duration: undefined,
    message: skipped.message,
    logPath: specificLog?.replace(/\.log$/, '.json'),
    errorCount: 0,
    fixedCount: 0,
    skipped: undefined,
  };
}

// ── JSON Result Writing ─────────────────────────────────────────────

export async function writeJsonResult(
  logPath: string,
  adapter: string,
  status: 'pass' | 'fail' | 'error',
  rawOutput: string,
  json: ReviewJsonOutput,
): Promise<string> {
  const jsonPath = logPath.replace(/\.log$/, '.json');
  const fullOutput: ReviewFullJsonOutput = {
    adapter,
    timestamp: new Date().toISOString(),
    status,
    rawOutput,
    violations: json.violations || [],
  };

  await fs.writeFile(jsonPath, JSON.stringify(fullOutput, null, 2));
  return jsonPath;
}

// ── Gate Result Builders ──────────────────────────────────────────────

export async function emptyDiffResult(
  jobId: string,
  startTime: number,
  logPaths: string[],
  mainLogger: (msg: string) => Promise<void>,
): Promise<GateResult> {
  log.debug('Empty diff after trim, returning pass');
  await mainLogger('No changes found in entry point, skipping review.\n');
  await mainLogger('Result: pass - No changes to review\n');
  return {
    jobId,
    status: 'pass',
    duration: Date.now() - startTime,
    message: 'No changes to review',
    logPaths,
  };
}

export async function noAdaptersResult(
  jobId: string,
  startTime: number,
  logPaths: string[],
  mainLogger: (msg: string) => Promise<void>,
): Promise<GateResult> {
  const msg = 'Review dispatch failed: no healthy adapters available';
  log.error(`ERROR: ${msg}`);
  await mainLogger(`Result: error - ${msg}\n`);
  return {
    jobId,
    status: 'error',
    duration: Date.now() - startTime,
    message: msg,
    logPaths,
  };
}

export async function incompleteResult(
  jobId: string,
  startTime: number,
  logPaths: string[],
  mainLogger: (msg: string) => Promise<void>,
  expected: number,
  completed: number,
): Promise<GateResult> {
  const msg = `Failed to complete reviews. Expected: ${expected}, Completed: ${completed}. See logs for details.`;
  await mainLogger(`Result: error - ${msg}\n`);
  return {
    jobId,
    status: 'error',
    duration: Date.now() - startTime,
    message: msg,
    logPaths,
  };
}

export function buildFinalResult(
  jobId: string,
  startTime: number,
  logPaths: string[],
  outputs: ReviewOutputEntry[],
  skippedSlotOutputs: SkippedSlotOutput[],
  mainLogger: (msg: string) => Promise<void>,
): GateResult {
  const allSkipped = outputs.flatMap((r) => r.skipped || []);
  const { status, message: baseMessage } = aggregateStatus(outputs);
  let message = baseMessage;
  if (skippedSlotOutputs.length > 0) {
    message += ` (${skippedSlotOutputs.length} skipped due to prior pass)`;
  }
  const subResults = buildSubResults(outputs, skippedSlotOutputs, logPaths);
  log.debug(`Complete: ${status} - ${message}`);
  mainLogger(`Result: ${status} - ${message}\n`);
  return {
    jobId,
    status,
    duration: Date.now() - startTime,
    message,
    logPaths,
    subResults,
    skipped: allSkipped,
  };
}

export async function handleCriticalError(
  error: unknown,
  jobId: string,
  startTime: number,
  logPaths: string[],
  mainLogger: (msg: string) => Promise<void>,
): Promise<GateResult> {
  const err = error as { message?: string; stack?: string };
  const errMsg = err.message || 'Unknown error';
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
  log.error(`CRITICAL ERROR: ${errMsg} ${err.stack || ''}`);
  await mainLogger(`Critical Error: ${errMsg}\n`);
  await mainLogger('Result: error\n');
  return {
    jobId,
    status: 'error',
    duration: Date.now() - startTime,
    message: errMsg,
    logPaths,
  };
}

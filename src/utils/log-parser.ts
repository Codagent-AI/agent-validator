import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviousViolation,
  ReviewFullJsonOutput,
} from '../gates/result.js';
import { getCategoryLogger } from '../output/app-logger.js';
import {
  categorizeFiles,
  processCheckFiles,
  processReviewSlots,
} from './log-parser-find-helpers.js';
import {
  collectIterationFailures,
  collectRunNumbers,
  computeFixedViolations,
  parseCheckLog,
  parseReviewLog,
} from './log-parser-helpers.js';

export type { PreviousViolation } from '../gates/result.js';
export type {
  AdapterFailure,
  GateFailures,
  PassedSlot,
  PreviousFailuresResult,
  RunIteration,
} from './log-parser-helpers.js';
export {
  extractPrefix,
  parseReviewFilename,
} from './log-parser-helpers.js';

import type {
  GateFailures,
  PreviousFailuresResult,
  RunIteration,
} from './log-parser-helpers.js';
import { extractPrefix, parseReviewFilename } from './log-parser-helpers.js';

const log = getCategoryLogger('log-parser');

/**
 * Parses a JSON review file.
 */
export async function parseJsonReviewFile(
  jsonPath: string,
): Promise<GateFailures | null> {
  try {
    const content = await fs.readFile(jsonPath, 'utf-8');
    const data: ReviewFullJsonOutput = JSON.parse(content);
    const filename = path.basename(jsonPath);

    const parsed = parseReviewFilename(filename);
    const jobId = parsed ? parsed.jobId : filename.replace(/\.\d+\.json$/, '');

    if (data.status === 'pass' || data.status === 'skipped_prior_pass') {
      return null;
    }

    const violations = (data.violations || []).map((v) => ({
      ...v,
      status: v.status || 'new',
    }));

    if (violations.length === 0 && data.status === 'fail') {
      violations.push({
        file: 'unknown',
        line: '?',
        issue: 'Previous run failed but no violations found in JSON',
        status: 'new',
      });
    }

    if (violations.length === 0) return null;

    return {
      jobId,
      gateName: '',
      entryPoint: '',
      adapterFailures: [
        {
          adapterName: data.adapter,
          reviewIndex: parsed?.reviewIndex,
          violations,
        },
      ],
      logPath: jsonPath.replace(/\.json$/, '.log'),
    };
  } catch (error) {
    log.warn(`Failed to parse JSON review file: ${jsonPath} - ${error}`);
    return null;
  }
}

/**
 * Parses a single log file to extract failures per adapter.
 * Processes both review and check gates.
 */
export async function parseLogFile(
  logPath: string,
): Promise<GateFailures | null> {
  try {
    const content = await fs.readFile(logPath, 'utf-8');
    const filename = path.basename(logPath);

    const parsed = parseReviewFilename(filename);
    const jobId = parsed ? parsed.jobId : extractPrefix(filename);

    if (content.includes('--- Review Output')) {
      return parseReviewLog(content, jobId, logPath, parsed);
    }
    return parseCheckLog(content, jobId, logPath);
  } catch (_error) {
    return null;
  }
}

/**
 * Reconstructs the history of fixes and skips after all iterations.
 */
export async function reconstructHistory(
  logDir: string,
): Promise<RunIteration[]> {
  try {
    const files = await fs.readdir(logDir);
    const sortedRuns = collectRunNumbers(files);
    const iterations: RunIteration[] = [];
    let previousFailuresByJob = new Map<string, PreviousViolation[]>();

    for (const runNum of sortedRuns) {
      const { currentFailuresByJob, skipped } = await collectIterationFailures(
        logDir,
        files,
        runNum,
        parseJsonReviewFile,
        parseLogFile,
      );

      const fixed = computeFixedViolations(
        previousFailuresByJob,
        currentFailuresByJob,
      );

      iterations.push({ iteration: runNum, fixed, skipped });
      previousFailuresByJob = currentFailuresByJob;
    }

    return iterations;
  } catch (_e) {
    return [];
  }
}

/**
 * Finds all previous failures and passed slots from the log directory.
 */
export async function findPreviousFailures(
  logDir: string,
  gateFilter?: string,
): Promise<GateFailures[]>;
export async function findPreviousFailures(
  logDir: string,
  gateFilter: string | undefined,
  includePassedSlots: true,
): Promise<PreviousFailuresResult>;
export async function findPreviousFailures(
  logDir: string,
  gateFilter?: string,
  includePassedSlots?: boolean,
): Promise<GateFailures[] | PreviousFailuresResult> {
  try {
    const files = await fs.readdir(logDir);
    const { reviewSlotMap, checkPrefixMap } = categorizeFiles(
      files,
      gateFilter,
    );

    const { jobReviewFailures, passedSlots } = await processReviewSlots(
      logDir,
      reviewSlotMap,
      includePassedSlots,
      parseJsonReviewFile,
      parseLogFile,
    );

    const gateFailures: GateFailures[] = [];
    for (const [jobId, adapterFailures] of jobReviewFailures.entries()) {
      gateFailures.push({
        jobId,
        gateName: '',
        entryPoint: '',
        adapterFailures,
        logPath: path.join(logDir, `${jobId}.log`),
      });
    }

    const checkFailures = await processCheckFiles(
      logDir,
      checkPrefixMap,
      parseJsonReviewFile,
      parseLogFile,
    );
    gateFailures.push(...checkFailures);

    if (includePassedSlots) {
      return { failures: gateFailures, passedSlots };
    }
    return gateFailures;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    ) {
      return includePassedSlots ? { failures: [], passedSlots: new Map() } : [];
    }
    return includePassedSlots ? { failures: [], passedSlots: new Map() } : [];
  }
}

/**
 * Check if any review JSON files in the log directory contain violations
 * with status "skipped".
 */
export async function hasSkippedViolationsInLogs(opts: {
  logDir: string;
}): Promise<boolean> {
  const { logDir } = opts;
  try {
    const files = await fs.readdir(logDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(logDir, file), 'utf-8');
        const data = JSON.parse(content) as {
          violations?: { status?: string }[];
        };
        if (data.violations?.some((v) => v.status === 'skipped')) {
          return true;
        }
      } catch {
        // Skip unparseable files and continue to next
      }
    }
    return false;
  } catch {
    return false;
  }
}

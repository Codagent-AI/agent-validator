import fs from 'node:fs/promises';
import { getAdapter, isUsageLimit } from '../cli-adapters/index.js';
import { getCategoryLogger } from '../output/app-logger.js';
import {
  getUnhealthyAdapters,
  isAdapterCoolingDown,
  markAdapterHealthy,
  type UnhealthyAdapter,
} from '../utils/execution-state.js';
import type { ReviewFullJsonOutput } from './result.js';
import { handleUsageLimit } from './review-eval.js';
import type {
  ReviewAssignment,
  ReviewOutputEntry,
  SingleReviewResult,
  SkippedSlotOutput,
} from './review-types.js';

import { MAX_LOG_BUFFER_SIZE } from './review-types.js';

// Re-export all types and constants from review-types for consumers
export type {
  EvaluationResult,
  ReviewAssignment,
  ReviewConfig,
  ReviewJsonOutput,
  ReviewOutputEntry,
  SingleReviewResult,
  SkippedSlotOutput,
} from './review-types.js';
export {
  CHARS_PER_TOKEN,
  JSON_SYSTEM_INSTRUCTION,
  MAX_BUFFER_BYTES,
  MAX_LOG_BUFFER_SIZE,
  REVIEW_ADAPTER_TIMEOUT_MS,
} from './review-types.js';

const log = getCategoryLogger('gate', 'review');

// ── Adapter Health ──────────────────────────────────────────────────

export async function collectHealthyAdapters(
  preferences: string[],
  mainLogger: (msg: string) => Promise<void>,
  logDir?: string,
): Promise<string[]> {
  const healthyAdapters: string[] = [];
  const unhealthyMap = logDir ? await getUnhealthyAdapters(logDir) : {};

  for (const toolName of preferences) {
    const adapter = getAdapter(toolName);
    if (!adapter) {
      log.debug(`Adapter ${toolName}: not found`);
      continue;
    }

    const healthy = await checkAdapterHealth(
      toolName,
      adapter,
      unhealthyMap,
      mainLogger,
      logDir,
    );
    if (healthy) {
      healthyAdapters.push(toolName);
    }
  }
  return healthyAdapters;
}

async function checkAdapterHealth(
  toolName: string,
  adapter: { checkHealth: () => Promise<{ status: string; message?: string }> },
  unhealthyMap: Record<string, UnhealthyAdapter>,
  mainLogger: (msg: string) => Promise<void>,
  logDir?: string,
): Promise<boolean> {
  const unhealthyEntry = unhealthyMap[toolName];
  if (unhealthyEntry) {
    return handleUnhealthyAdapter(
      toolName,
      adapter,
      unhealthyEntry,
      mainLogger,
      logDir,
    );
  }

  const health = await adapter.checkHealth();
  if (health.status !== 'healthy') {
    log.debug(
      `Adapter ${toolName}: ${health.status}${health.message ? ` - ${health.message}` : ''}`,
    );
    await mainLogger(
      `Skipping ${toolName}: ${health.message || 'Unhealthy'}\n`,
    );
    return false;
  }
  return true;
}

async function handleUnhealthyAdapter(
  toolName: string,
  adapter: { checkHealth: () => Promise<{ status: string; message?: string }> },
  unhealthyEntry: UnhealthyAdapter,
  mainLogger: (msg: string) => Promise<void>,
  logDir?: string,
): Promise<boolean> {
  if (isAdapterCoolingDown(unhealthyEntry)) {
    log.debug(`Adapter ${toolName}: cooling down`);
    await mainLogger(
      `Skipping ${toolName}: cooling down (${unhealthyEntry.reason})\n`,
    );
    return false;
  }

  const health = await adapter.checkHealth();
  if (health.status === 'healthy') {
    log.debug(
      `Adapter ${toolName}: cooldown expired, binary available, clearing unhealthy flag`,
    );
    if (logDir) {
      await markAdapterHealthy(logDir, toolName);
    }
    return true;
  }

  log.debug(`Adapter ${toolName}: cooldown expired but binary missing`);
  await mainLogger(`Skipping ${toolName}: ${health.message || 'Missing'}\n`);
  return false;
}

// ── Assignment Generation ───────────────────────────────────────────

export function generateReviewAssignments(
  required: number,
  healthyAdapters: string[],
): ReviewAssignment[] {
  const assignments: ReviewAssignment[] = [];
  for (let i = 0; i < required; i++) {
    const adapter = healthyAdapters[i % healthyAdapters.length];
    if (!adapter) continue;
    assignments.push({ adapter, reviewIndex: i + 1 });
  }
  return assignments;
}

export async function applyPassedSlotSkips(
  assignments: ReviewAssignment[],
  required: number,
  passedSlots:
    | Map<number, { adapter: string; passIteration: number }>
    | undefined,
  mainLogger: (msg: string) => Promise<void>,
): Promise<void> {
  if (!(required > 1 && passedSlots && passedSlots.size > 0)) return;

  const failedIndexes: number[] = [];
  for (const assignment of assignments) {
    const passed = passedSlots.get(assignment.reviewIndex);
    if (passed && passed.adapter === assignment.adapter) {
      assignment.passIteration = passed.passIteration;
    } else {
      failedIndexes.push(assignment.reviewIndex);
    }
  }

  if (failedIndexes.length > 0) {
    markPassedSlotsAsSkipped(assignments);
  } else if (assignments.every((a) => a.passIteration !== undefined)) {
    await applySafetyLatch(assignments, mainLogger);
  }
}

function markPassedSlotsAsSkipped(assignments: ReviewAssignment[]): void {
  for (const assignment of assignments) {
    if (assignment.passIteration !== undefined) {
      assignment.skip = true;
      assignment.skipReason = `previously passed in iteration ${assignment.passIteration} (num_reviews > 1)`;
    }
  }
}

async function applySafetyLatch(
  assignments: ReviewAssignment[],
  mainLogger: (msg: string) => Promise<void>,
): Promise<void> {
  for (const assignment of assignments) {
    if (assignment.reviewIndex === 1) {
      assignment.skip = false;
      await mainLogger(
        `Running @1: safety latch (all slots previously passed)\n`,
      );
    } else {
      assignment.skip = true;
      assignment.skipReason = `previously passed in iteration ${assignment.passIteration} (num_reviews > 1)`;
    }
  }
}

// ── Skipped Slot Handling ───────────────────────────────────────────

export async function handleSkippedSlots(
  skippedAssignments: ReviewAssignment[],
  loggerFactory: (
    adapterName?: string,
    reviewIndex?: number,
  ) => Promise<{ logger: (output: string) => Promise<void>; logPath: string }>,
  logPathsSet: Set<string>,
  logPaths: string[],
): Promise<SkippedSlotOutput[]> {
  const outputs: SkippedSlotOutput[] = [];
  for (const assignment of skippedAssignments) {
    const result = await writeSkippedSlotLog(
      assignment,
      loggerFactory,
      logPathsSet,
      logPaths,
    );
    outputs.push(result);
  }
  return outputs;
}

async function writeSkippedSlotLog(
  assignment: ReviewAssignment,
  loggerFactory: (
    adapterName?: string,
    reviewIndex?: number,
  ) => Promise<{ logger: (output: string) => Promise<void>; logPath: string }>,
  logPathsSet: Set<string>,
  logPaths: string[],
): Promise<SkippedSlotOutput> {
  const { logger, logPath } = await loggerFactory(
    assignment.adapter,
    assignment.reviewIndex,
  );

  const skipMessage = `[${new Date().toISOString()}] Review skipped: previously passed in iteration ${assignment.passIteration}\n`;
  await logger(skipMessage);
  await logger(`Adapter: ${assignment.adapter}\n`);
  await logger(`Review index: @${assignment.reviewIndex}\n`);
  await logger(`Status: skipped_prior_pass\n`);

  const jsonPath = logPath.replace(/\.log$/, '.json');
  const skippedOutput: ReviewFullJsonOutput = {
    adapter: assignment.adapter,
    timestamp: new Date().toISOString(),
    status: 'skipped_prior_pass',
    rawOutput: '',
    violations: [],
    passIteration: assignment.passIteration,
  };
  await fs.writeFile(jsonPath, JSON.stringify(skippedOutput, null, 2));

  if (!logPathsSet.has(logPath)) {
    logPathsSet.add(logPath);
    logPaths.push(logPath);
  }

  return {
    adapter: assignment.adapter,
    reviewIndex: assignment.reviewIndex,
    status: 'skipped_prior_pass',
    message: `Skipped: previously passed in iteration ${assignment.passIteration}`,
    passIteration: assignment.passIteration ?? 0,
  };
}

// ── Review Dispatch ─────────────────────────────────────────────────

export async function dispatchReviews(
  runningAssignments: ReviewAssignment[],
  parallel: boolean,
  runSingle: (
    adapter: string,
    reviewIndex: number,
  ) => Promise<SingleReviewResult | null>,
): Promise<ReviewOutputEntry[]> {
  const outputs: ReviewOutputEntry[] = [];

  if (parallel && runningAssignments.length > 1) {
    const results = await Promise.all(
      runningAssignments.map((a) => runSingle(a.adapter, a.reviewIndex)),
    );
    for (const res of results) {
      if (res) outputs.push(toOutputEntry(res));
    }
  } else {
    for (const assignment of runningAssignments) {
      const res = await runSingle(assignment.adapter, assignment.reviewIndex);
      if (res) outputs.push(toOutputEntry(res));
    }
  }
  return outputs;
}

function toOutputEntry(res: SingleReviewResult): ReviewOutputEntry {
  return {
    adapter: res.adapter,
    reviewIndex: res.reviewIndex,
    duration: res.duration,
    ...res.evaluation,
  };
}

// ── Logger Factory ──────────────────────────────────────────────────

export type LoggerFactory = (
  adapterName?: string,
  reviewIndex?: number,
) => Promise<{
  logger: (output: string) => Promise<void>;
  logPath: string;
}>;

export interface LoggerBundle {
  mainLogger: (output: string) => Promise<void>;
  getAdapterLogger: (
    adapterName: string,
    reviewIndex: number,
  ) => Promise<(output: string) => Promise<void>>;
  logPaths: string[];
  logPathsSet: Set<string>;
}

export function createLoggers(loggerFactory: LoggerFactory): LoggerBundle {
  const logBuffer: string[] = [];
  let logSequence = 0;
  const activeLoggers: Array<(output: string, index: number) => Promise<void>> =
    [];
  const logPaths: string[] = [];
  const logPathsSet = new Set<string>();

  const mainLogger = async (output: string) => {
    const seq = logSequence++;
    if (logBuffer.length < MAX_LOG_BUFFER_SIZE) {
      logBuffer.push(output);
    }
    await Promise.allSettled(activeLoggers.map((l) => l(output, seq)));
  };

  const getAdapterLogger = async (adapterName: string, reviewIndex: number) => {
    const { logger, logPath } = await loggerFactory(adapterName, reviewIndex);
    if (!logPathsSet.has(logPath)) {
      logPathsSet.add(logPath);
      logPaths.push(logPath);
    }

    const seenIndices = new Set<number>();
    const safeLogger = async (msg: string, index: number) => {
      if (seenIndices.has(index)) return;
      seenIndices.add(index);
      await logger(msg);
    };
    activeLoggers.push(safeLogger);

    const snapshot = [...logBuffer];
    await Promise.all(snapshot.map((msg, i) => safeLogger(msg, i)));
    return logger;
  };

  return { mainLogger, getAdapterLogger, logPaths, logPathsSet };
}

// ── Skip / Error Handling ───────────────────────────────────────────

export async function logSkipMessages(
  assignments: ReviewAssignment[],
  mainLogger: (msg: string) => Promise<void>,
): Promise<void> {
  for (const assignment of assignments) {
    if (assignment.skip && assignment.skipReason) {
      await mainLogger(
        `Skipping @${assignment.reviewIndex}: ${assignment.skipReason}\n`,
      );
    }
  }
}

export async function handleReviewError(
  error: unknown,
  adapter: { name: string },
  reviewIndex: number,
  reviewStartTime: number,
  adapterLogger: (msg: string) => Promise<void>,
  mainLogger: (msg: string) => Promise<void>,
  logDir?: string,
): Promise<SingleReviewResult | null> {
  const err = error as { message?: string };
  const errorMsg = `Error running ${adapter.name}@${reviewIndex}: ${err.message}`;
  log.error(errorMsg);
  await adapterLogger(`${errorMsg}\n`);
  await mainLogger(`${errorMsg}\n`);
  if (err.message && isUsageLimit(err.message)) {
    await handleUsageLimit(adapter, logDir, mainLogger);
    return {
      adapter: adapter.name,
      reviewIndex,
      duration: Date.now() - reviewStartTime,
      evaluation: { status: 'error', message: 'Usage limit exceeded' },
    };
  }
  return null;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanLogs } from '../commands/shared.js';
import type { loadConfig } from '../config/loader.js';
import { getCategoryLogger, resetLogger } from '../output/app-logger.js';
import { ConsoleReporter } from '../output/console.js';
import type { ConsoleLogHandle } from '../output/console-log.js';
import type { Logger } from '../output/logger.js';
import { generateReport } from '../output/report.js';
import type { RunResult, ValidatorStatus } from '../types/validator-status.js';
import { getDebugLogger } from '../utils/debug-log.js';
import {
  readExecutionState,
  resolveFixBase,
  writeExecutionState,
} from '../utils/execution-state.js';
import {
  findPreviousFailures,
  hasSkippedViolationsInLogs,
  type PassedSlot,
  type PreviousViolation,
} from '../utils/log-parser.js';
import {
  appendCurrentTrustRecord,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import { ChangeDetector } from './change-detector.js';
import { computeDiffStats } from './diff-stats.js';
import { EntryPointExpander } from './entry-point.js';
import { JobGenerator } from './job.js';
import { findLatestConsoleLog, tryAcquireLock } from './run-executor-lock.js';
import { Runner } from './runner.js';

// Re-export lock helpers so existing imports from run-executor-helpers still work
export { findLatestConsoleLog, tryAcquireLock };

export type ChangeOptions = {
  commit?: string;
  uncommitted?: boolean;
  fixBase?: string;
};

export type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>;

export interface RunContext {
  options: {
    baseBranch?: string;
    gate?: string;
    commit?: string;
    uncommitted?: boolean;
    cwd?: string;
    enableReviews?: Set<string>;
    report?: boolean;
    contextContent?: string;
  };
  config: LoadedConfig;
  loggerInitializedHere: boolean;
  effectiveBaseBranch: string;
  startupChangeOptions?: ChangeOptions;
  trustSourceOnPass?: TrustRecordSource;
}

const statusMessages: Record<ValidatorStatus, string> = {
  passed: 'All gates passed.',
  passed_with_warnings: 'Passed with warnings -- some issues were skipped.',
  no_applicable_gates: 'No applicable gates for these changes.',
  no_changes: 'No changes detected.',
  trusted: 'Trusted snapshot; baseline advanced.',
  failed: 'Gates failed -- issues must be fixed.',
  retry_limit_exceeded:
    'Retry limit exceeded -- logs have been automatically archived.',
  lock_conflict: 'Another validator run is already in progress.',
  error: 'Unexpected error occurred.',
  no_config:
    'No validator config found (.validator/config.yml or .gauntlet/config.yml).',
};

export function getStatusMessage(status: ValidatorStatus): string {
  return statusMessages[status] || 'Unknown status';
}

function getRunLogger() {
  return getCategoryLogger('run');
}

async function appendRunTrustRecord(
  ctx: RunContext,
  status: ValidatorStatus,
): Promise<void> {
  await appendCurrentTrustRecord({
    config: ctx.config,
    logDir: ctx.config.project.log_dir,
    command: 'run',
    status,
    source: ctx.trustSourceOnPass ?? 'validated',
    options: {
      gate: ctx.options.gate,
      enableReviews: ctx.options.enableReviews,
    },
    trusted: ctx.trustSourceOnPass === 'ledger-reconciled' ? true : undefined,
  });
}

export async function finalizeAndReturn(
  loggerInitializedHere: boolean,
  result: RunResult,
  consoleLogHandle?: ConsoleLogHandle,
): Promise<RunResult> {
  consoleLogHandle?.restore();
  if (loggerInitializedHere) {
    await resetLogger();
  }
  return result;
}

function buildFailuresMap(
  previousFailures: Awaited<
    ReturnType<typeof findPreviousFailures>
  >['failures'],
): Map<string, Map<string, PreviousViolation[]>> {
  const failuresMap = new Map<string, Map<string, PreviousViolation[]>>();
  for (const gateFailure of previousFailures) {
    const adapterMap = new Map<string, PreviousViolation[]>();
    for (const af of gateFailure.adapterFailures) {
      const key = af.reviewIndex ? String(af.reviewIndex) : af.adapterName;
      adapterMap.set(key, af.violations);
    }
    failuresMap.set(gateFailure.jobId, adapterMap);
  }
  return failuresMap;
}

async function handleRerunMode(ctx: RunContext): Promise<{
  failuresMap: Map<string, Map<string, PreviousViolation[]>>;
  passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
  changeOptions: ChangeOptions;
}> {
  const log = getRunLogger();
  log.debug('Existing logs detected -- running in verification mode...');

  const { failures: previousFailures, passedSlots } =
    await findPreviousFailures(
      ctx.config.project.log_dir,
      ctx.options.gate,
      true,
    );

  const failuresMap = buildFailuresMap(previousFailures);

  if (previousFailures.length > 0) {
    const totalViolations = previousFailures.reduce(
      (sum, gf) =>
        sum + gf.adapterFailures.reduce((s, af) => s + af.violations.length, 0),
      0,
    );
    log.warn(
      `Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
    );
  }

  const changeOptions: ChangeOptions = { uncommitted: true };
  const executionState = await readExecutionState(ctx.config.project.log_dir);
  if (executionState?.working_tree_ref) {
    changeOptions.fixBase = executionState.working_tree_ref;
  }

  return { failuresMap, passedSlotsMap: passedSlots, changeOptions };
}

async function handleFreshRunMode(
  ctx: RunContext,
): Promise<ChangeOptions | undefined> {
  const log = getRunLogger();
  const executionState = await readExecutionState(ctx.config.project.log_dir);
  if (!executionState) {
    return undefined;
  }

  const resolved = await resolveFixBase(
    executionState,
    ctx.effectiveBaseBranch,
  );
  if (resolved.warning) {
    log.warn(`Warning: ${resolved.warning}`);
  }
  return resolved.fixBase ? { fixBase: resolved.fixBase } : undefined;
}

export async function processRerunMode(
  ctx: RunContext,
  isRerun: boolean,
  logsExist: boolean,
): Promise<{
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
  passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
  changeOptions: ChangeOptions | undefined;
}> {
  let failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
  let passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
  let changeOptions: ChangeOptions | undefined;

  if (isRerun) {
    const rerunResult = await handleRerunMode(ctx);
    failuresMap = rerunResult.failuresMap;
    passedSlotsMap = rerunResult.passedSlotsMap;
    changeOptions = rerunResult.changeOptions;
  } else if (!logsExist) {
    changeOptions = await handleFreshRunMode(ctx);
  }

  if (ctx.options.commit || ctx.options.uncommitted) {
    changeOptions = {
      commit: ctx.options.commit,
      uncommitted: ctx.options.uncommitted,
      fixBase: changeOptions?.fixBase,
    };
  }

  if (ctx.startupChangeOptions?.fixBase && !ctx.options.commit) {
    changeOptions = {
      ...changeOptions,
      fixBase: ctx.startupChangeOptions.fixBase,
    };
  }

  return { failuresMap, passedSlotsMap, changeOptions };
}

export async function handleNoChanges(
  ctx: RunContext,
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
): Promise<RunResult> {
  const log = getRunLogger();
  const debugLogger = getDebugLogger();

  if (failuresMap && failuresMap.size === 0) {
    const hasSkipped = await hasSkippedViolationsInLogs({
      logDir: ctx.config.project.log_dir,
    });
    const status: ValidatorStatus = hasSkipped
      ? 'passed_with_warnings'
      : 'passed';

    if (status === 'passed') {
      await debugLogger?.logClean('auto', 'all_passed');
      await cleanLogs(
        ctx.config.project.log_dir,
        ctx.config.project.max_previous_logs,
      );
    }

    // Write execution state AFTER clean so the file always survives.
    await writeExecutionState(ctx.config.project.log_dir);
    await appendRunTrustRecord(ctx, status);

    log.info(getStatusMessage(status));
    return { status, message: getStatusMessage(status), gatesRun: 0 };
  }

  if (failuresMap && failuresMap.size > 0) {
    let totalViolations = 0;
    for (const adapterMap of failuresMap.values()) {
      for (const violations of adapterMap.values()) {
        totalViolations += violations.length;
      }
    }
    const message = `No changes detected — ${totalViolations} violation(s) still outstanding.`;
    log.warn(message);
    return { status: 'failed', message, gatesRun: 0 };
  }

  log.info('No changes detected.');
  return {
    status: 'no_changes',
    message: getStatusMessage('no_changes'),
    gatesRun: 0,
  };
}

export async function detectAndPrepareChanges(
  ctx: RunContext,
  isRerun: boolean,
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
  changeOptions: ChangeOptions | undefined,
): Promise<
  | { earlyResult: RunResult }
  | {
      jobs: ReturnType<JobGenerator['generateJobs']>;
      changeOpts: ChangeOptions;
    }
> {
  const log = getRunLogger();
  const effectiveChangeOptions = changeOptions || {
    commit: ctx.options.commit,
    uncommitted: ctx.options.uncommitted,
  };

  const changeDetector = new ChangeDetector(
    ctx.effectiveBaseBranch,
    effectiveChangeOptions,
  );
  const expander = new EntryPointExpander();
  const jobGen = new JobGenerator(ctx.config, ctx.options.enableReviews);

  log.debug('Detecting changes...');
  const changes = await changeDetector.getChangedFiles();

  if (changes.length === 0 && isRerun) {
    return { earlyResult: await handleNoChanges(ctx, failuresMap) };
  }
  if (changes.length === 0) {
    return { earlyResult: await handleNoChanges(ctx, undefined) };
  }

  log.debug(`Found ${changes.length} changed files.`);

  const entryPoints = await expander.expand(
    ctx.config.project.entry_points,
    changes,
  );
  let jobs = jobGen.generateJobs(entryPoints);

  if (ctx.options.gate) {
    jobs = jobs.filter((j) => j.name === ctx.options.gate);
  }

  if (jobs.length === 0) {
    log.warn('No applicable gates for these changes.');
    return {
      earlyResult: {
        status: 'no_applicable_gates',
        message: getStatusMessage('no_applicable_gates'),
        gatesRun: 0,
      },
    };
  }

  return { jobs, changeOpts: effectiveChangeOptions };
}

function determineStatus(outcome: {
  allPassed: boolean;
  anySkipped: boolean;
  retryLimitExceeded: boolean;
}): ValidatorStatus {
  if (outcome.retryLimitExceeded) {
    return 'retry_limit_exceeded';
  }
  if (outcome.allPassed && outcome.anySkipped) {
    return 'passed_with_warnings';
  }
  if (outcome.allPassed) {
    return 'passed';
  }
  return 'failed';
}

/** Build the result object from runner outcome. */
async function buildRunResult(
  ctx: RunContext,
  outcome: Awaited<ReturnType<Runner['run']>>,
  jobs: ReturnType<JobGenerator['generateJobs']>,
): Promise<RunResult> {
  const consoleLogPath = await findLatestConsoleLog(ctx.config.project.log_dir);
  const status = determineStatus(outcome);

  // Generate the report BEFORE cleanup archives logs
  let reportText: string | undefined;
  if (ctx.options.report) {
    reportText = await generateReport(
      status,
      outcome.gateResults,
      ctx.config.project.log_dir,
    );
    // Write report file as a fallback
    const reportPath = path.join(ctx.config.project.log_dir, 'report.txt');
    try {
      await fs.writeFile(reportPath, reportText, 'utf-8');
    } catch (err) {
      // Best effort — don't fail the run if we can't write the report file
      console.debug(`Failed to write report file ${reportPath}: ${err}`);
    }
  }

  if (status === 'passed' || status === 'retry_limit_exceeded') {
    const reason = status === 'passed' ? 'all_passed' : 'retry_limit_exceeded';
    const debugLogger = getDebugLogger();
    await debugLogger?.logClean('auto', reason);
    await cleanLogs(
      ctx.config.project.log_dir,
      ctx.config.project.max_previous_logs,
    );
  }

  return {
    status,
    message: getStatusMessage(status),
    gatesRun: jobs.length,
    gatesFailed: outcome.allPassed ? 0 : jobs.length,
    consoleLogPath: consoleLogPath ?? undefined,
    reportText,
    gateResults: outcome.gateResults,
  };
}

export async function executeAndReport(
  ctx: RunContext,
  logger: Logger,
  isRerun: boolean,
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
  passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined,
  changeOptions: ChangeOptions | undefined,
  jobs: ReturnType<JobGenerator['generateJobs']>,
): Promise<RunResult> {
  const debugLogger = getDebugLogger();

  const runMode = isRerun ? 'verification' : 'full';
  const effectiveChangeOptions = changeOptions || {
    commit: ctx.options.commit,
    uncommitted: ctx.options.uncommitted,
  };
  const diffStats = await computeDiffStats(
    ctx.effectiveBaseBranch,
    effectiveChangeOptions,
  );
  await debugLogger?.logRunStartWithDiff(runMode, diffStats, jobs.length);

  getRunLogger().debug(`Running ${jobs.length} gates...`);

  const reporter = new ConsoleReporter();
  const runner = new Runner(
    ctx.config,
    logger,
    reporter,
    failuresMap,
    changeOptions,
    ctx.effectiveBaseBranch,
    passedSlotsMap,
    debugLogger ?? undefined,
    isRerun,
    undefined,
    undefined,
    ctx.options.contextContent,
  );

  const outcome = await runner.run(jobs);

  await debugLogger?.logRunEnd(
    outcome.allPassed ? 'pass' : 'fail',
    outcome.stats.fixed,
    outcome.stats.skipped,
    outcome.stats.failed,
    logger.getRunNumber(),
  );

  const result = await buildRunResult(ctx, outcome, jobs);

  // Write execution state AFTER clean so the file always survives.
  // cleanLogs should preserve persistent files, but writing after clean
  // is the defensive ordering (matches the skip command's pattern).
  await writeExecutionState(ctx.config.project.log_dir);
  await appendRunTrustRecord(ctx, result.status);

  return result;
}

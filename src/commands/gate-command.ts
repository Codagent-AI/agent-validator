// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the shared gate executor remains co-located with its existing rerun helpers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: command orchestration keeps lock ownership and result finalization together.
import chalk from 'chalk';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import { ChangeDetector } from '../core/change-detector.js';
import { EntryPointExpander } from '../core/entry-point.js';
import { JobGenerator } from '../core/job.js';
import { findPreviousFailedCheckJobs } from '../core/rerun-check-recovery.js';
import { Runner } from '../core/runner.js';
import { CommandMetricsLifecycle } from '../metrics/command-lifecycle.js';
import { ConsoleReporter } from '../output/console.js';
import type { Logger } from '../output/logger.js';
import type { RunResult, ValidatorStatus } from '../types/validator-status.js';
import {
  type DebugLogger,
  getDebugLogger,
  initDebugLogger,
  mergeDebugLogConfig,
} from '../utils/debug-log.js';
import {
  readExecutionState,
  resolveFixBase,
  writeExecutionState,
} from '../utils/execution-state.js';
import { resolveBaseBranch } from '../utils/git.js';
import {
  findPreviousFailures,
  type PassedSlot,
  type PreviousViolation,
} from '../utils/log-parser.js';
import { appendCurrentTrustRecord } from '../utils/trust-ledger.js';
import {
  acquireAndReconcileGateStartup,
  type ChangeOptions,
  checkEarlyExit,
  GateCommandLockConflictError,
  type GateCommandName,
  type GateCommandOptions,
  initLoggerAfterLock,
  type LockContext,
} from './gate-command-support.js';
import {
  cleanLogs,
  hasExistingLogs,
  performAutoClean,
  readContextFile,
  releaseLock,
  shouldAutoClean,
} from './shared.js';

interface InitResult {
  config: Awaited<ReturnType<typeof loadConfig>>;
  debugLogger: DebugLogger | undefined;
  effectiveBaseBranch: string;
}

/** Load config, initialize debug logger, and log the command invocation. */
async function initializeDebugLogger(
  commandName: GateCommandName,
  options: GateCommandOptions,
): Promise<InitResult> {
  const config = await loadConfig();

  const globalConfig = await loadGlobalConfig();
  const debugLogConfig = mergeDebugLogConfig(
    config.project.debug_log,
    globalConfig.debug_log,
  );
  initDebugLogger(config.project.log_dir, debugLogConfig);

  const debugLogger = getDebugLogger() ?? undefined;
  await debugLogger?.logCommand(
    commandName,
    [
      options.baseBranch && `-b ${options.baseBranch}`,
      options.gate && `-g ${options.gate}`,
      options.commit && `-c ${options.commit}`,
      options.uncommitted && '-u',
    ].filter((v): v is string => !!v),
  );
  const effectiveBaseBranch = resolveBaseBranch(options, config);
  return { config, debugLogger, effectiveBaseBranch };
}

/** Run auto-clean if context has changed. */
async function handleAutoClean(
  logDir: string,
  effectiveBaseBranch: string,
  debugLogger: DebugLogger | undefined,
  maxPreviousLogs?: number,
): Promise<void> {
  const autoCleanResult = await shouldAutoClean(logDir, effectiveBaseBranch);
  if (autoCleanResult.clean) {
    console.log(chalk.dim(`Auto-cleaning logs (${autoCleanResult.reason})...`));
    await debugLogger?.logClean('auto', autoCleanResult.reason || 'unknown');
    await performAutoClean(logDir, autoCleanResult, maxPreviousLogs);
  }
}

interface RerunResult {
  isRerun: boolean;
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
  passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
  changeOptions: ChangeOptions | undefined;
}

/** Detect rerun mode: check if logs exist after auto-clean. */
function detectRerunMode(logsExist: boolean, commit?: string): boolean {
  return logsExist && !commit;
}

/** Load previous failures and build rerun state. */
async function processRerunMode(
  logDir: string,
  options: GateCommandOptions,
): Promise<RerunResult> {
  console.log(
    chalk.dim('Existing logs detected — running in verification mode...'),
  );
  const { failures: previousFailures, passedSlots } =
    await findPreviousFailures(logDir, options.gate, true);

  const failuresMap = buildFailuresMap(previousFailures);
  logPreviousViolations(previousFailures);

  const changeOptions: ChangeOptions = { uncommitted: true };
  const executionState = await readExecutionState(logDir);
  if (executionState?.working_tree_ref) {
    changeOptions.fixBase = executionState.working_tree_ref;
  }

  return {
    isRerun: true,
    failuresMap,
    passedSlotsMap: passedSlots,
    changeOptions,
  };
}

/** Build failures map from previous failure results. */
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
/** Log a summary of previous violations if any exist. */
function logPreviousViolations(
  previousFailures: Awaited<
    ReturnType<typeof findPreviousFailures>
  >['failures'],
): void {
  if (previousFailures.length === 0) {
    return;
  }
  const totalViolations = previousFailures.reduce(
    (sum, gf) =>
      sum + gf.adapterFailures.reduce((s, af) => s + af.violations.length, 0),
    0,
  );
  console.log(
    chalk.yellow(
      `Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
    ),
  );
}
/** Resolve fixBase for post-clean runs from execution state. */
async function resolveChangeOptions(
  logDir: string,
  effectiveBaseBranch: string,
  options: GateCommandOptions,
  rerunChangeOptions: ChangeOptions | undefined,
  logsExist: boolean,
  startupChangeOptions?: ChangeOptions,
): Promise<ChangeOptions | undefined> {
  let changeOptions = rerunChangeOptions;

  if (!(changeOptions || logsExist)) {
    const executionState = await readExecutionState(logDir);
    if (executionState) {
      const resolved = await resolveFixBase(
        executionState,
        effectiveBaseBranch,
      );
      if (resolved.warning) {
        console.log(chalk.yellow(`Warning: ${resolved.warning}`));
      }
      if (resolved.fixBase) {
        changeOptions = { fixBase: resolved.fixBase };
      }
    }
  }

  // Allow explicit commit or uncommitted options to override fixBase
  if (options.commit || options.uncommitted) {
    changeOptions = {
      commit: options.commit,
      uncommitted: options.uncommitted,
      fixBase: changeOptions?.fixBase,
    };
  }

  if (startupChangeOptions?.fixBase && !options.commit) {
    changeOptions = {
      ...changeOptions,
      fixBase: startupChangeOptions.fixBase,
    };
  }

  return changeOptions;
}

interface DetectionResult {
  changes: string[];
  jobs: Awaited<ReturnType<JobGenerator['generateJobs']>>;
}

/** Detect changes, expand entry points, and generate/filter jobs. */
async function detectChangesAndGenerateJobs(
  config: Awaited<ReturnType<typeof loadConfig>>,
  effectiveBaseBranch: string,
  changeOptions: ChangeOptions | undefined,
  options: GateCommandOptions,
  commandName: GateCommandName,
): Promise<DetectionResult> {
  const changeDetector = new ChangeDetector(
    effectiveBaseBranch,
    changeOptions || {
      commit: options.commit,
      uncommitted: options.uncommitted,
    },
  );
  const expander = new EntryPointExpander();
  const jobGen = new JobGenerator(config, options.enableReviews);
  console.log(chalk.dim('Detecting changes...'));
  const changes = await changeDetector.getChangedFiles();
  if (changes.length === 0) {
    return { changes, jobs: [] };
  }
  console.log(chalk.dim(`Found ${changes.length} changed files.`));

  const entryPoints = await expander.expand(
    config.project.entry_points,
    changes,
  );
  let jobs = jobGen.generateJobs(entryPoints);
  jobs = jobs.filter((j) => j.type === commandName);
  if (options.gate) {
    jobs = jobs.filter((j) => j.name === options.gate);
  }

  return { changes, jobs };
}

/** Create runner, execute jobs, log results, and clean up. */
function statusFromOutcome(outcome: {
  allPassed: boolean;
  anySkipped: boolean;
}): ValidatorStatus {
  if (!outcome.allPassed) return 'failed';
  if (outcome.anySkipped) return 'passed_with_warnings';
  return 'passed';
}

async function executeAndFinalize(
  config: Awaited<ReturnType<typeof loadConfig>>,
  logger: Logger,
  debugLogger: DebugLogger | undefined,
  isRerun: boolean,
  failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
  changeOptions: ChangeOptions | undefined,
  effectiveBaseBranch: string,
  passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined,
  changes: string[],
  jobs: Awaited<ReturnType<JobGenerator['generateJobs']>>,
  contextContent?: string,
  metricsLifecycle?: CommandMetricsLifecycle,
): Promise<import('../core/runner.js').RunnerOutcome> {
  const runMode = isRerun ? 'verification' : 'full';
  await debugLogger?.logRunStart(runMode, changes.length, jobs.length);

  const reporter = new ConsoleReporter();
  const runner = new Runner(
    config,
    logger,
    reporter,
    failuresMap,
    changeOptions,
    effectiveBaseBranch,
    passedSlotsMap,
    debugLogger,
    isRerun,
    undefined,
    undefined,
    contextContent,
    metricsLifecycle,
  );

  const outcome = await runner.run(jobs);

  await debugLogger?.logRunEnd(
    outcome.allPassed ? 'pass' : 'fail',
    outcome.stats.fixed,
    outcome.stats.skipped,
    outcome.stats.failed,
    logger.getRunNumber(),
  );

  return outcome;
}

const NO_RERUN: RerunResult = {
  isRerun: false,
  failuresMap: undefined,
  passedSlotsMap: undefined,
  changeOptions: undefined,
};

async function prepareGateWork(args: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  logDir: string;
  effectiveBaseBranch: string;
  options: GateCommandOptions;
  commandName: GateCommandName;
  startupChangeOptions?: ChangeOptions;
}): Promise<{
  rerunResult: RerunResult;
  changeOptions: ChangeOptions | undefined;
  changes: string[];
  jobs: Awaited<ReturnType<JobGenerator['generateJobs']>>;
}> {
  const logsExist = await hasExistingLogs(args.logDir);
  const isRerun = detectRerunMode(logsExist, args.options.commit);
  const rerunResult = isRerun
    ? await processRerunMode(args.logDir, args.options)
    : NO_RERUN;
  const changeOptions = await resolveChangeOptions(
    args.logDir,
    args.effectiveBaseBranch,
    args.options,
    rerunResult.changeOptions,
    logsExist,
    args.startupChangeOptions,
  );
  const { changes, jobs } = await detectChangesAndGenerateJobs(
    args.config,
    args.effectiveBaseBranch,
    changeOptions,
    args.options,
    args.commandName,
  );
  if (changes.length === 0 && args.commandName === 'check') {
    const previousFailedCheckJobs = await findPreviousFailedCheckJobs(
      { config: args.config, options: args.options },
      rerunResult.failuresMap,
    );
    if (previousFailedCheckJobs.length > 0) {
      return {
        rerunResult,
        changeOptions,
        changes,
        jobs: previousFailedCheckJobs,
      };
    }
  }
  return { rerunResult, changeOptions, changes, jobs };
}

/**
 * Shared gate command executor for both "check" and "review" commands.
 * Contains all logic that was previously duplicated between the two commands.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: every controlled exit returns through the same telemetry finalizer.
export async function executeGateCommand(
  commandName: GateCommandName,
  options: GateCommandOptions,
): Promise<RunResult> {
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  let lockAcquired = false;
  let restoreConsole: LockContext['restoreConsole'] | undefined;
  const lifecycle = new CommandMetricsLifecycle(commandName);
  let effectiveOptions = options;
  try {
    lifecycle.setContext(validateMetricsContext(effectiveOptions));
    if (effectiveOptions.contextFile) {
      effectiveOptions = {
        ...effectiveOptions,
        contextContent: await readContextFile(effectiveOptions.contextFile),
      };
    }
    const initResult = await initializeDebugLogger(
      commandName,
      effectiveOptions,
    );
    config = initResult.config;
    const { debugLogger, effectiveBaseBranch } = initResult;
    const logDir = config.project.log_dir;

    const reconciliation = await acquireAndReconcileGateStartup({
      commandName,
      config,
      logDir,
      options: effectiveOptions,
    });
    lockAcquired = true;

    if (reconciliation.kind === 'trusted') {
      await lifecycle.associate(logDir);
      return withTelemetry(reconciliation.result, lifecycle);
    }

    await lifecycle.associate(logDir);

    await handleAutoClean(
      logDir,
      effectiveBaseBranch,
      debugLogger,
      config.project.max_previous_logs,
    );

    const lockCtx = await initLoggerAfterLock(logDir);
    restoreConsole = lockCtx.restoreConsole;
    const { rerunResult, changeOptions, changes, jobs } = await prepareGateWork(
      {
        config,
        logDir,
        effectiveBaseBranch,
        options: effectiveOptions,
        commandName,
        startupChangeOptions: reconciliation.changeOptions,
      },
    );

    const earlyStatus = await checkEarlyExit(
      changes,
      jobs,
      commandName,
      logDir,
      restoreConsole,
      rerunResult.failuresMap,
      {
        config,
        options: effectiveOptions,
        source: reconciliation.trustSourceOnPass,
      },
    );
    if (earlyStatus) {
      return withTelemetry(
        { status: earlyStatus, message: statusMessage(earlyStatus) },
        lifecycle,
      );
    }

    console.log(chalk.dim(`Running ${jobs.length} ${commandName}(s)...`));

    const outcome = await executeAndFinalize(
      config,
      lockCtx.logger,
      debugLogger,
      rerunResult.isRerun,
      rerunResult.failuresMap,
      changeOptions,
      effectiveBaseBranch,
      rerunResult.passedSlotsMap,
      changes,
      jobs,
      effectiveOptions.contextContent,
      lifecycle,
    );

    const status = outcome.retryLimitExceeded
      ? 'retry_limit_exceeded'
      : statusFromOutcome(outcome);
    const result = await withTelemetry(
      {
        status,
        message: statusMessage(status),
        gatesRun: outcome.gateResults.length,
        gatesFailed: outcome.stats.failed,
        gateResults: outcome.gateResults,
      },
      lifecycle,
    );
    if (outcome.allPassed) {
      await debugLogger?.logClean('auto', 'all_passed');
      await cleanLogs(logDir, config.project.max_previous_logs);
    }
    await writeExecutionState(logDir);
    await appendCurrentTrustRecord({
      config,
      logDir,
      command: commandName,
      status,
      source: reconciliation.trustSourceOnPass ?? 'validated',
      options: {
        gate: effectiveOptions.gate,
        enableReviews: effectiveOptions.enableReviews,
      },
    });
    return result;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const lockConflict = error instanceof GateCommandLockConflictError;
    if (!lockConflict) console.error(chalk.red('Error:'), err.message);
    return withTelemetry(
      {
        status: lockConflict ? 'lock_conflict' : 'error',
        message: lockConflict
          ? statusMessage('lock_conflict')
          : 'Unexpected error occurred.',
        errorMessage: err.message || 'unknown error',
      },
      lifecycle,
    );
  } finally {
    if (config && lockAcquired) {
      try {
        await releaseLock(config.project.log_dir);
      } catch (error) {
        console.error(
          chalk.yellow('Warning: failed to release lock:'),
          (error as Error).message,
        );
      }
    }
    restoreConsole?.restore();
  }
}

const METRICS_IDENTIFIER_MAX_LENGTH = 256;

function validateMetricsContext(
  options: GateCommandOptions,
): { consumer: string; context_id: string } | null {
  if (!(options.metricsConsumer || options.metricsContext)) return null;
  if (!(options.metricsConsumer && options.metricsContext))
    throw new Error(
      'metrics-consumer and metrics-context must be supplied together',
    );
  for (const value of [options.metricsConsumer, options.metricsContext]) {
    if (!value.trim() || value.length > METRICS_IDENTIFIER_MAX_LENGTH)
      throw new Error(
        'metrics consumer and context must be bounded nonempty values',
      );
  }
  return {
    consumer: options.metricsConsumer,
    context_id: options.metricsContext,
  };
}

async function withTelemetry(
  result: RunResult,
  lifecycle: CommandMetricsLifecycle,
): Promise<RunResult> {
  return { ...result, telemetry: await lifecycle.finalize(result.status) };
}

function statusMessage(status: ValidatorStatus): string {
  const messages: Record<ValidatorStatus, string> = {
    passed: 'All gates passed.',
    passed_with_warnings: 'Passed with warnings -- some issues were skipped.',
    no_applicable_gates: 'No applicable gates for these changes.',
    no_changes: 'No changes detected.',
    trusted: 'Trusted validation snapshot.',
    failed: 'Gates failed -- issues must be fixed.',
    retry_limit_exceeded:
      'Retry limit exceeded -- logs have been automatically archived.',
    lock_conflict: 'Another validator run is already in progress.',
    error: 'Unexpected error occurred.',
    no_config: 'No validator config found.',
  };
  return messages[status];
}

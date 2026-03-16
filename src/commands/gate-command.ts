import chalk from 'chalk';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import { ChangeDetector } from '../core/change-detector.js';
import { EntryPointExpander } from '../core/entry-point.js';
import { JobGenerator } from '../core/job.js';
import { Runner } from '../core/runner.js';
import { ConsoleReporter } from '../output/console.js';
import {
  type ConsoleLogHandle,
  startConsoleLog,
} from '../output/console-log.js';
import { Logger } from '../output/logger.js';
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
import {
  acquireLock,
  cleanLogs,
  hasExistingLogs,
  performAutoClean,
  releaseLock,
  shouldAutoClean,
} from './shared.js';

type GateCommandName = 'check' | 'review';

interface GateCommandOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  enableReviews?: Set<string>;
}

interface ChangeOptions {
  commit?: string;
  uncommitted?: boolean;
  fixBase?: string;
}

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
  const args = [
    options.baseBranch ? `-b ${options.baseBranch}` : '',
    options.gate ? `-g ${options.gate}` : '',
    options.commit ? `-c ${options.commit}` : '',
    options.uncommitted ? '-u' : '',
  ].filter(Boolean);
  await debugLogger?.logCommand(commandName, args);

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

  // Filter to only the requested type
  jobs = jobs.filter((j) => j.type === commandName);

  if (options.gate) {
    jobs = jobs.filter((j) => j.name === options.gate);
  }

  return { changes, jobs };
}

/** Create runner, execute jobs, log results, and clean up. */
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
): Promise<boolean> {
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
  );

  const outcome = await runner.run(jobs);

  await debugLogger?.logRunEnd(
    outcome.allPassed ? 'pass' : 'fail',
    outcome.stats.fixed,
    outcome.stats.skipped,
    outcome.stats.failed,
    logger.getRunNumber(),
  );

  if (outcome.allPassed) {
    await debugLogger?.logClean('auto', 'all_passed');
    await cleanLogs(config.project.log_dir);
  }

  // Write execution state AFTER clean so the file always survives.
  await writeExecutionState(config.project.log_dir);

  return outcome.allPassed;
}

/** Handle early exit when no changes or no applicable jobs are found. */
async function handleNoWork(
  logDir: string,
  restoreConsole: ConsoleLogHandle | undefined,
): Promise<never> {
  await writeExecutionState(logDir);
  await releaseLock(logDir);
  restoreConsole?.restore();
  process.exit(0);
}

/** Check for early exit conditions (no changes or no jobs). */
async function checkEarlyExit(
  changes: string[],
  jobs: unknown[],
  commandName: GateCommandName,
  logDir: string,
  restoreConsole: ConsoleLogHandle | undefined,
): Promise<void> {
  if (changes.length === 0) {
    console.log(chalk.green('No changes detected.'));
    await handleNoWork(logDir, restoreConsole);
  }
  if (jobs.length === 0) {
    console.log(
      chalk.yellow(`No applicable ${commandName}s for these changes.`),
    );
    await handleNoWork(logDir, restoreConsole);
  }
}

interface LockContext {
  logger: Logger;
  restoreConsole: ConsoleLogHandle;
}

/** Acquire lock, initialize logger, and start console log capture. */
async function acquireLockAndInitLogger(logDir: string): Promise<LockContext> {
  await acquireLock(logDir);

  const logger = new Logger(logDir);
  await logger.init();
  const runNumber = logger.getRunNumber();

  const restoreConsole = await startConsoleLog(logDir, runNumber);
  return { logger, restoreConsole };
}

/** Handle error during gate command execution. */
async function handleGateError(
  error: unknown,
  config: Awaited<ReturnType<typeof loadConfig>> | undefined,
  lockAcquired: boolean,
  restoreConsole: ConsoleLogHandle | undefined,
): Promise<never> {
  if (config && lockAcquired) {
    try {
      await writeExecutionState(config.project.log_dir);
    } catch {
      // Ignore errors writing state during error handling
    }
    try {
      await releaseLock(config.project.log_dir);
    } catch (releaseErr) {
      console.error(
        chalk.yellow('Warning: failed to release lock:'),
        (releaseErr as Error).message,
      );
    }
  }
  const err = error as { message?: string };
  console.error(chalk.red('Error:'), err.message);
  restoreConsole?.restore();
  process.exit(1);
}

const NO_RERUN: RerunResult = {
  isRerun: false,
  failuresMap: undefined,
  passedSlotsMap: undefined,
  changeOptions: undefined,
};

/**
 * Shared gate command executor for both "check" and "review" commands.
 * Contains all logic that was previously duplicated between the two commands.
 */
export async function executeGateCommand(
  commandName: GateCommandName,
  options: GateCommandOptions,
): Promise<void> {
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  let lockAcquired = false;
  let restoreConsole: ConsoleLogHandle | undefined;
  try {
    const initResult = await initializeDebugLogger(commandName, options);
    config = initResult.config;
    const { debugLogger, effectiveBaseBranch } = initResult;
    const logDir = config.project.log_dir;

    await handleAutoClean(
      logDir,
      effectiveBaseBranch,
      debugLogger,
      config.project.max_previous_logs,
    );

    // Detect rerun mode after auto-clean (clean may have removed logs)
    const logsExist = await hasExistingLogs(logDir);
    const isRerun = detectRerunMode(logsExist, options.commit);

    const lockCtx = await acquireLockAndInitLogger(logDir);
    lockAcquired = true;
    restoreConsole = lockCtx.restoreConsole;

    const rerunResult = isRerun
      ? await processRerunMode(logDir, options)
      : NO_RERUN;

    const changeOptions = await resolveChangeOptions(
      logDir,
      effectiveBaseBranch,
      options,
      rerunResult.changeOptions,
      logsExist,
    );

    const { changes, jobs } = await detectChangesAndGenerateJobs(
      config,
      effectiveBaseBranch,
      changeOptions,
      options,
      commandName,
    );

    await checkEarlyExit(changes, jobs, commandName, logDir, restoreConsole);

    console.log(chalk.dim(`Running ${jobs.length} ${commandName}(s)...`));

    const allPassed = await executeAndFinalize(
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
    );

    await releaseLock(logDir);
    restoreConsole?.restore();
    process.exit(allPassed ? 0 : 1);
  } catch (error: unknown) {
    await handleGateError(error, config, lockAcquired, restoreConsole);
  }
}

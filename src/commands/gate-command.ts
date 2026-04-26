import chalk from 'chalk';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import { ChangeDetector } from '../core/change-detector.js';
import { EntryPointExpander } from '../core/entry-point.js';
import { JobGenerator } from '../core/job.js';
import { Runner } from '../core/runner.js';
import { ConsoleReporter } from '../output/console.js';
import type { Logger } from '../output/logger.js';
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
  appendCurrentTrustRecord,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import {
  acquireAndReconcileGateStartup,
  type ChangeOptions,
  checkEarlyExit,
  type GateCommandName,
  type GateCommandOptions,
  handleGateError,
  initLoggerAfterLock,
  type LockContext,
} from './gate-command-support.js';
import {
  cleanLogs,
  hasExistingLogs,
  performAutoClean,
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
  commandName?: GateCommandName,
  options?: GateCommandOptions,
  trustSourceOnPass?: TrustRecordSource,
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
    undefined,
    undefined,
    contextContent,
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
  if (commandName && options) {
    await appendCurrentTrustRecord({
      config,
      logDir: config.project.log_dir,
      command: commandName,
      status: outcome.allPassed ? 'passed' : 'failed',
      source: trustSourceOnPass ?? 'validated',
      options: {
        gate: options.gate,
        enableReviews: options.enableReviews,
      },
      trusted: trustSourceOnPass === 'ledger-reconciled' ? true : undefined,
    });
  }

  return outcome.allPassed;
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
  return { rerunResult, changeOptions, changes, jobs };
}

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
  let restoreConsole: LockContext['restoreConsole'] | undefined;
  try {
    const initResult = await initializeDebugLogger(commandName, options);
    config = initResult.config;
    const { debugLogger, effectiveBaseBranch } = initResult;
    const logDir = config.project.log_dir;

    lockAcquired = true;
    const reconciliation = await acquireAndReconcileGateStartup({
      commandName,
      config,
      logDir,
      options,
    });

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
        options,
        commandName,
        startupChangeOptions: reconciliation.changeOptions,
      },
    );

    await checkEarlyExit(
      changes,
      jobs,
      commandName,
      logDir,
      restoreConsole,
      rerunResult.failuresMap,
      { config, options, source: reconciliation.trustSourceOnPass },
    );

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
      options.contextContent,
      commandName,
      options,
      reconciliation.trustSourceOnPass,
    );

    await releaseLock(logDir);
    restoreConsole?.restore();
    process.exit(allPassed ? 0 : 1);
  } catch (error: unknown) {
    await handleGateError(error, config, lockAcquired, restoreConsole);
  }
}

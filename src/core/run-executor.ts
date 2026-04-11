import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasExistingLogs,
  performAutoClean,
  releaseLock,
  shouldAutoClean,
} from '../commands/shared.js';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import {
  getCategoryLogger,
  initLogger,
  isLoggerConfigured,
  resetLogger,
} from '../output/app-logger.js';
import { startConsoleLog } from '../output/console-log.js';
import { Logger } from '../output/logger.js';
import { generateReport } from '../output/report.js';
import type { RunResult } from '../types/validator-status.js';
import {
  getDebugLogger,
  initDebugLogger,
  mergeDebugLogConfig,
} from '../utils/debug-log.js';
import { resolveBaseBranch } from '../utils/git.js';
import {
  detectAndPrepareChanges,
  executeAndReport,
  finalizeAndReturn,
  getStatusMessage,
  processRerunMode,
  type RunContext,
  tryAcquireLock,
} from './run-executor-helpers.js';

export interface ExecuteRunOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  /** Working directory for config loading (defaults to process.cwd()) */
  cwd?: string;
  /** Set of review names to activate even if their config has enabled: false */
  enableReviews?: Set<string>;
  /** When true, generate a plain-text report in RunResult.reportText */
  report?: boolean;
  /** Content to inject into review prompts via {{CONTEXT}} placeholder */
  contextContent?: string;
}

/** Initialize app logger and debug logger, returning a RunContext. */
async function initRunContext(
  options: ExecuteRunOptions,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<{ ctx: RunContext; loggerInitializedHere: boolean }> {
  let loggerInitializedHere = false;

  if (!isLoggerConfigured()) {
    await initLogger({
      mode: 'interactive',
      logDir: config.project.log_dir,
    });
    loggerInitializedHere = true;
  }

  const globalConfig = await loadGlobalConfig();
  const debugLogConfig = mergeDebugLogConfig(
    config.project.debug_log,
    globalConfig.debug_log,
  );
  initDebugLogger(config.project.log_dir, debugLogConfig);

  await logCommandInvocation(options);

  const effectiveBaseBranch = resolveBaseBranch(options, config);

  const ctx: RunContext = {
    options,
    config,
    loggerInitializedHere,
    effectiveBaseBranch,
  };

  return { ctx, loggerInitializedHere };
}

/** Log the command invocation to debug logger. */
async function logCommandInvocation(options: ExecuteRunOptions): Promise<void> {
  const debugLogger = getDebugLogger();
  const args = [
    options.baseBranch ? `-b ${options.baseBranch}` : '',
    options.gate ? `-g ${options.gate}` : '',
    options.commit ? `-c ${options.commit}` : '',
    options.uncommitted ? '-u' : '',
  ].filter(Boolean);
  await debugLogger?.logCommand('run', args);
}

/** Handle auto-cleaning of logs on context change. */
async function handleAutoClean(ctx: RunContext): Promise<void> {
  const autoCleanResult = await shouldAutoClean(
    ctx.config.project.log_dir,
    ctx.effectiveBaseBranch,
  );
  if (autoCleanResult.clean) {
    getCategoryLogger('run').debug(
      `Auto-cleaning logs (${autoCleanResult.reason})...`,
    );
    const debugLogger = getDebugLogger();
    await debugLogger?.logClean('auto', autoCleanResult.reason || 'unknown');
    await performAutoClean(
      ctx.config.project.log_dir,
      autoCleanResult,
      ctx.config.project.max_previous_logs,
    );
  }
}

/** The inner run logic executed while holding the lock. */
async function runWithLock(
  ctx: RunContext,
  isRerun: boolean,
  logsExist: boolean,
): Promise<RunResult> {
  const logger = new Logger(ctx.config.project.log_dir);
  await logger.init();
  const runNumber = logger.getRunNumber();

  const consoleLogHandle = await startConsoleLog(
    ctx.config.project.log_dir,
    runNumber,
  );

  const { failuresMap, passedSlotsMap, changeOptions } = await processRerunMode(
    ctx,
    isRerun,
    logsExist,
  );

  const prepared = await detectAndPrepareChanges(
    ctx,
    isRerun,
    failuresMap,
    changeOptions,
  );

  if ('earlyResult' in prepared) {
    if (ctx.options.report) {
      const reportText = await generateReport(
        prepared.earlyResult.status,
        prepared.earlyResult.gateResults,
        ctx.config.project.log_dir,
      );
      prepared.earlyResult.reportText = reportText;
      // Write report file as fallback
      try {
        const reportPath = path.join(ctx.config.project.log_dir, 'report.txt');
        await fs.mkdir(ctx.config.project.log_dir, { recursive: true });
        await fs.writeFile(reportPath, reportText, 'utf-8');
      } catch {
        // Best effort
      }
    }
    return finalizeAndReturn(
      ctx.loggerInitializedHere,
      prepared.earlyResult,
      consoleLogHandle,
    );
  }

  const result = await executeAndReport(
    ctx,
    logger,
    isRerun,
    failuresMap,
    passedSlotsMap,
    changeOptions,
    prepared.jobs,
  );

  consoleLogHandle?.restore();
  if (ctx.loggerInitializedHere) {
    await resetLogger();
  }
  return result;
}

/**
 * Execute the validator run logic. Returns a structured RunResult.
 * This function never calls process.exit() - the caller is responsible for that.
 */
export async function executeRun(
  options: ExecuteRunOptions = {},
): Promise<RunResult> {
  let loggerInitializedHere = false;

  try {
    const config = await loadConfig(options.cwd);
    const { ctx, loggerInitializedHere: lih } = await initRunContext(
      options,
      config,
    );
    loggerInitializedHere = lih;

    await handleAutoClean(ctx);

    const logsExist = await hasExistingLogs(config.project.log_dir);
    const isRerun = logsExist && !options.commit;

    const lockAcquired = await tryAcquireLock(config.project.log_dir);
    if (!lockAcquired) {
      return finalizeAndReturn(loggerInitializedHere, {
        status: 'lock_conflict',
        message: getStatusMessage('lock_conflict'),
      });
    }

    try {
      return await runWithLock(ctx, isRerun, logsExist);
    } finally {
      await releaseLock(config.project.log_dir);
    }
  } catch (error: unknown) {
    if (loggerInitializedHere) {
      try {
        await resetLogger();
      } catch {
        // Ignore errors resetting logger during error handling
      }
    }
    const err = error as { message?: string };
    return {
      status: 'error',
      message: getStatusMessage('error'),
      errorMessage: err.message || 'unknown error',
    };
  }
}

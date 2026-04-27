import chalk from 'chalk';
import type { loadConfig } from '../config/loader.js';
import {
  type ReconciliationContinue,
  reconcileStartup,
} from '../core/reconciliation.js';
import {
  type ConsoleLogHandle,
  startConsoleLog,
} from '../output/console-log.js';
import { Logger } from '../output/logger.js';
import { writeExecutionState } from '../utils/execution-state.js';
import {
  appendCurrentTrustRecord,
  DEFAULT_PRUNE_THRESHOLD,
  pruneIfNeeded,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import { acquireLock, releaseLock } from './shared.js';

export type GateCommandName = 'check' | 'review';

export interface GateCommandOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  enableReviews?: Set<string>;
  contextContent?: string;
}

export interface ChangeOptions {
  commit?: string;
  uncommitted?: boolean;
  fixBase?: string;
}

export interface LockContext {
  logger: Logger;
  restoreConsole: ConsoleLogHandle;
}

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>;
type FailureMap = Map<string, Map<string, unknown[]>>;

async function handleNoWork(
  logDir: string,
  restoreConsole: ConsoleLogHandle | undefined,
  failuresMap?: FailureMap,
  ledger?: {
    config: LoadedConfig;
    commandName: GateCommandName;
    status: 'no_applicable_gates';
    options: GateCommandOptions;
    source?: TrustRecordSource;
  },
): Promise<never> {
  if (failuresMap && failuresMap.size > 0) {
    let total = 0;
    for (const adapterMap of failuresMap.values()) {
      for (const violations of adapterMap.values()) total += violations.length;
    }
    console.log(
      chalk.yellow(
        `No changes detected — ${total} violation(s) still outstanding.`,
      ),
    );
    await releaseLock(logDir);
    restoreConsole?.restore();
    process.exit(1);
  }

  await writeExecutionState(logDir);
  if (ledger) {
    await appendCurrentTrustRecord({
      config: ledger.config,
      logDir,
      command: ledger.commandName,
      status: ledger.status,
      source: ledger.source ?? 'validated',
      options: {
        gate: ledger.options.gate,
        enableReviews: ledger.options.enableReviews,
      },
    });
  }
  await releaseLock(logDir);
  restoreConsole?.restore();
  process.exit(0);
}

export async function checkEarlyExit(
  changes: string[],
  jobs: unknown[],
  commandName: GateCommandName,
  logDir: string,
  restoreConsole: ConsoleLogHandle | undefined,
  failuresMap?: FailureMap,
  ledger?: {
    config: LoadedConfig;
    options: GateCommandOptions;
    source?: TrustRecordSource;
  },
): Promise<void> {
  if (changes.length === 0) {
    await handleNoWork(logDir, restoreConsole, failuresMap);
  }
  if (jobs.length === 0) {
    console.log(
      chalk.yellow(`No applicable ${commandName}s for these changes.`),
    );
    await handleNoWork(
      logDir,
      restoreConsole,
      undefined,
      ledger && {
        config: ledger.config,
        commandName,
        status: 'no_applicable_gates',
        options: ledger.options,
        source: ledger.source,
      },
    );
  }
}

export async function initLoggerAfterLock(
  logDir: string,
): Promise<LockContext> {
  const logger = new Logger(logDir);
  await logger.init();
  const runNumber = logger.getRunNumber();
  const restoreConsole = await startConsoleLog(logDir, runNumber);
  return { logger, restoreConsole };
}

export async function handleGateError(
  error: unknown,
  config: LoadedConfig | undefined,
  lockAcquired: boolean,
  restoreConsole: ConsoleLogHandle | undefined,
): Promise<never> {
  if (config && lockAcquired) {
    try {
      await writeExecutionState(config.project.log_dir);
    } catch {
      // Ignore errors writing state during error handling.
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

export async function acquireAndReconcileGateStartup(args: {
  commandName: GateCommandName;
  config: LoadedConfig;
  logDir: string;
  options: GateCommandOptions;
}): Promise<ReconciliationContinue> {
  let lockAcquired = false;
  try {
    await acquireLock(args.logDir);
    lockAcquired = true;
    await pruneIfNeeded(DEFAULT_PRUNE_THRESHOLD);
    const reconciliation = await reconcileStartup({
      command: args.commandName,
      config: args.config,
      logDir: args.logDir,
      options: {
        gate: args.options.gate,
        enableReviews: args.options.enableReviews,
      },
    });
    if (reconciliation.kind === 'trusted') {
      console.log(chalk.green(reconciliation.result.message));
      await releaseLock(args.logDir);
      process.exit(0);
    }
    return reconciliation;
  } catch (error) {
    if (lockAcquired) {
      try {
        await releaseLock(args.logDir);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'failed during startup and failed to release lock',
        );
      }
    }
    throw error;
  }
}

import chalk from 'chalk';
import type { loadConfig } from '../config/loader.js';
import { reconcileStartup } from '../core/reconciliation.js';
import { tryAcquireLock } from '../core/run-executor-lock.js';
import { recoverPendingSessionClosures } from '../metrics/session-closure.js';
import {
  type ConsoleLogHandle,
  startConsoleLog,
} from '../output/console-log.js';
import { Logger } from '../output/logger.js';
import type { ValidatorStatus } from '../types/validator-status.js';
import { writeExecutionState } from '../utils/execution-state.js';
import {
  appendCurrentTrustRecord,
  DEFAULT_PRUNE_THRESHOLD,
  pruneIfNeeded,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import { releaseLock } from './shared.js';

export type GateCommandName = 'check' | 'review';

export interface GateCommandOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  enableReviews?: Set<string>;
  contextContent?: string;
  contextFile?: string;
  metricsConsumer?: string;
  metricsContext?: string;
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

export class GateCommandLockConflictError extends Error {
  constructor() {
    super('Another validator run is already in progress.');
    this.name = 'GateCommandLockConflictError';
  }
}

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>;
type FailureMap = Map<string, Map<string, unknown[]>>;

async function handleNoWork(
  logDir: string,
  _restoreConsole: ConsoleLogHandle | undefined,
  failuresMap?: FailureMap,
  ledger?: {
    config: LoadedConfig;
    commandName: GateCommandName;
    status: 'no_changes' | 'no_applicable_gates';
    options: GateCommandOptions;
    source?: TrustRecordSource;
  },
): Promise<ValidatorStatus> {
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
    return 'failed';
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
  return ledger?.status ?? 'no_changes';
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
): Promise<ValidatorStatus | null> {
  if (changes.length === 0 && jobs.length === 0) {
    return handleNoWork(
      logDir,
      restoreConsole,
      failuresMap,
      ledger && {
        config: ledger.config,
        commandName,
        status: 'no_changes',
        options: ledger.options,
        source: ledger.source,
      },
    );
  }
  if (jobs.length === 0) {
    console.log(
      chalk.yellow(`No applicable ${commandName}s for these changes.`),
    );
    return handleNoWork(
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
  return null;
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

export async function acquireAndReconcileGateStartup(args: {
  commandName: GateCommandName;
  config: LoadedConfig;
  logDir: string;
  options: GateCommandOptions;
}): Promise<Awaited<ReturnType<typeof reconcileStartup>>> {
  let lockAcquired = false;
  try {
    if (!(await tryAcquireLock(args.logDir))) {
      throw new GateCommandLockConflictError();
    }
    lockAcquired = true;
    await pruneIfNeeded(DEFAULT_PRUNE_THRESHOLD);
    const recovery = await recoverPendingSessionClosures(args.logDir);
    if (recovery.warnings.length > 0)
      console.warn(
        `Metrics session closure recovery is incomplete: ${recovery.warnings.join('; ')}`,
      );
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
      return reconciliation;
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

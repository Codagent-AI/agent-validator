import chalk from 'chalk';
import type { Command } from 'commander';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import {
  getDebugLogger,
  initDebugLogger,
  mergeDebugLogConfig,
} from '../utils/debug-log.js';
import {
  getCurrentCommit,
  writeExecutionState,
} from '../utils/execution-state.js';
import {
  appendCurrentTrustRecord,
  DEFAULT_PRUNE_THRESHOLD,
  pruneIfNeeded,
} from '../utils/trust-ledger.js';
import { acquireLock, cleanLogs, releaseLock } from './shared.js';

export function registerSkipCommand(program: Command): void {
  program
    .command('skip')
    .description('Advance execution state baseline without running gates')
    .action(async () => {
      let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
      let lockAcquired = false;
      try {
        config = await loadConfig();

        // Initialize debug logger
        const globalConfig = await loadGlobalConfig();
        const debugLogConfig = mergeDebugLogConfig(
          config.project.debug_log,
          globalConfig.debug_log,
        );
        initDebugLogger(config.project.log_dir, debugLogConfig);

        // Acquire lock BEFORE any state changes
        await acquireLock(config.project.log_dir);
        lockAcquired = true;
        await pruneIfNeeded(DEFAULT_PRUNE_THRESHOLD);

        // Log the command invocation
        const debugLogger = getDebugLogger();
        await debugLogger?.logCommand('skip', []);

        // Archive existing logs
        await cleanLogs(
          config.project.log_dir,
          config.project.max_previous_logs,
        );

        // Write execution state with current branch/commit/working-tree-ref
        await writeExecutionState(config.project.log_dir);
        await appendCurrentTrustRecord({
          config,
          logDir: config.project.log_dir,
          command: 'skip',
          status: 'skipped',
          source: 'manual-skip',
          trusted: true,
        });

        // Get abbreviated commit SHA for confirmation message
        const commit = await getCurrentCommit();
        const shortSha = commit.slice(0, 7);

        await releaseLock(config.project.log_dir);
        console.log(
          chalk.green(
            `Baseline advanced to ${shortSha}. Next run will diff from here.`,
          ),
        );
      } catch (error: unknown) {
        if (config && lockAcquired) {
          await releaseLock(config.project.log_dir);
        }
        const err = error as { message?: string };
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });
}

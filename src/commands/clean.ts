import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadGlobalConfig } from '../config/global.js';
import { loadConfig } from '../config/loader.js';
import {
  getDebugLogger,
  initDebugLogger,
  mergeDebugLogConfig,
} from '../utils/debug-log.js';
import { acquireLock, cleanLogs, releaseLock } from './shared.js';

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Archive logs')
    .action(async () => {
      let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
      let logDir: string | undefined;
      let lockAcquired = false;
      try {
        try {
          config = await loadConfig();
          logDir = config.project.log_dir;
        } catch (error) {
          if (!isMissingConfig(error)) throw error;
          logDir = path.resolve('validator_logs');
        }

        if (!(await directoryExists(logDir))) {
          console.log(chalk.green('Logs archived successfully.'));
          return;
        }

        // Initialize debug logger
        const globalConfig = await loadGlobalConfig();
        const debugLogConfig = mergeDebugLogConfig(
          config?.project.debug_log,
          globalConfig.debug_log,
        );
        initDebugLogger(logDir, debugLogConfig);

        // Acquire lock BEFORE logging - prevents clean from running during active validator run
        await acquireLock(logDir);
        lockAcquired = true;

        // Log the command invocation (only after lock acquired)
        const debugLogger = getDebugLogger();
        await debugLogger?.logCommand('clean', []);
        await debugLogger?.logClean('manual', 'user_request');

        await cleanLogs(logDir, config?.project.max_previous_logs ?? 3);
        await releaseLock(logDir);
        console.log(chalk.green('Logs archived successfully.'));
      } catch (error: unknown) {
        if (logDir && lockAcquired) {
          await releaseLock(logDir);
        }
        const err = error as { message?: string };
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });
}

function isMissingConfig(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('Configuration file not found')
  );
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error(`${directory} is not a directory`);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return false;
    throw error;
  }
}

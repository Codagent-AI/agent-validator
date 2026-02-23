import type { Command } from 'commander';
import { executeRun } from '../core/run-executor.js';
import { isSuccessStatus } from '../types/gauntlet-status.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Run gates for detected changes')
    .option(
      '-b, --base-branch <branch>',
      'Override base branch for change detection',
    )
    .option('-g, --gate <name>', 'Run specific gate only')
    .option('-c, --commit <sha>', 'Use diff for a specific commit')
    .option(
      '-u, --uncommitted',
      'Use diff for current uncommitted changes (staged and unstaged)',
    )
    .action(async (options) => {
      const result = await executeRun({
        baseBranch: options.baseBranch,
        gate: options.gate,
        commit: options.commit,
        uncommitted: options.uncommitted,
      });

      process.exitCode = isSuccessStatus(result.status) ? 0 : 1;
    });
}

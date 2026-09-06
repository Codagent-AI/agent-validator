import type { Command } from 'commander';
import { isSuccessStatus } from '../types/validator-status.js';
import { executeGateCommand } from './gate-command.js';

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Run only applicable checks for detected changes')
    .option(
      '-b, --base-branch <branch>',
      'Override base branch for change detection',
    )
    .option('-g, --gate <name>', 'Run specific check gate only')
    .option('-c, --commit <sha>', 'Use diff for a specific commit')
    .option(
      '-u, --uncommitted',
      'Use diff for current uncommitted changes (staged and unstaged)',
    )
    .option('--metrics-consumer <name>', 'Opaque metrics consumer name')
    .option('--metrics-context <id>', 'Opaque metrics consumer context')
    .action(async (options) => {
      const result = await executeGateCommand('check', options);
      process.exit(isSuccessStatus(result.status) ? 0 : 1);
    });
}

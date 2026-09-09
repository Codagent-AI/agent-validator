import type { Command } from 'commander';
import { isSuccessStatus } from '../types/validator-status.js';
import { executeGateCommand } from './gate-command.js';

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('Run only applicable reviews for detected changes')
    .option(
      '-b, --base-branch <branch>',
      'Override base branch for change detection',
    )
    .option('-g, --gate <name>', 'Run specific review gate only')
    .option('-c, --commit <sha>', 'Use diff for a specific commit')
    .option(
      '-u, --uncommitted',
      'Use diff for current uncommitted changes (staged and unstaged)',
    )
    .option(
      '-e, --enable-review <name>',
      'Activate a disabled review for this run (repeatable)',
      (value: string, prev: string[] = []) => [...prev, value],
      [] as string[],
    )
    .option(
      '--context-file <path>',
      'Inject file contents into review prompts via {{CONTEXT}} placeholder',
    )
    .option('--metrics-consumer <name>', 'Opaque metrics consumer name')
    .option('--metrics-context <id>', 'Opaque metrics consumer context')
    .action(async (options) => {
      const result = await executeGateCommand('review', {
        ...options,
        enableReviews: new Set<string>(options.enableReview ?? []),
        contextFile: options.contextFile,
        metricsConsumer: options.metricsConsumer,
        metricsContext: options.metricsContext,
      });
      process.exit(isSuccessStatus(result.status) ? 0 : 1);
    });
}

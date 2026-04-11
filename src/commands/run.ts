import type { Command } from 'commander';
import { executeRun } from '../core/run-executor.js';
import { statusLineText } from '../output/report.js';
import { isSuccessStatus } from '../types/validator-status.js';
import { readContextFile } from './shared.js';

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
    .option('--report', 'Write a structured failure report to stdout')
    .action(async (options) => {
      const reportEnabled = options.report ?? false;
      const contextContent = options.contextFile
        ? await readContextFile(options.contextFile)
        : undefined;

      const result = await executeRun({
        baseBranch: options.baseBranch,
        gate: options.gate,
        commit: options.commit,
        uncommitted: options.uncommitted,
        enableReviews: new Set<string>(options.enableReview ?? []),
        report: reportEnabled,
        contextContent,
      });

      if (reportEnabled) {
        // Use reportText from the executor, or fall back to a status-only line
        // for early-return paths (no_changes, no_applicable_gates, etc.)
        const text = result.reportText ?? statusLineText(result.status);
        process.stdout.write(`${text}\n`);
      }

      const code = isSuccessStatus(result.status) ? 0 : 1;
      process.exit(code);
    });
}

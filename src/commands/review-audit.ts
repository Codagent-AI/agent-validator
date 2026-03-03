import type { Command } from 'commander';
import { main } from '../scripts/review-audit.js';

export function registerReviewAuditCommand(program: Command): void {
  program
    .command('review-audit')
    .description(
      'Audit review execution from the debug log (--date or --since)',
    )
    .option('--date <YYYY-MM-DD>', 'Date to filter (default: today)')
    .option('--since <YYYY-MM-DD>', 'Include all runs from this date onwards')
    .action(async (opts: { date?: string; since?: string }) => {
      if (opts.date && opts.since) {
        console.error('Use either --date or --since, not both.');
        process.exit(1);
      }
      await main(opts.date, opts.since);
    });
}

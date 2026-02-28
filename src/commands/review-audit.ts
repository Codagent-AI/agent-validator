import type { Command } from 'commander';
import { main } from '../scripts/review-audit.js';

export function registerReviewAuditCommand(program: Command): void {
  program
    .command('review-audit')
    .description('Audit review execution for a given date from the debug log')
    .option('--date <YYYY-MM-DD>', 'Date to filter (default: today)')
    .action((opts: { date?: string }) => {
      main(opts.date);
    });
}

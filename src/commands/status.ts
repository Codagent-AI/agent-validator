import type { Command } from 'commander';
import { main } from '../scripts/status.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show a summary of the most recent gauntlet session')
    .action(() => {
      main();
    });
}

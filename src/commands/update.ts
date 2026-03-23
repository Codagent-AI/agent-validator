import type { Command } from 'commander';
import { runPluginUpdate } from './plugin-update.js';

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update the agent-validator Claude plugin and refresh skills')
    .action(async () => {
      await runPluginUpdate();
    });
}

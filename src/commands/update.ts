import type { Command } from 'commander';
import {
  type PluginUpdateDependencies,
  runPluginUpdate,
} from './plugin-update.js';

export function registerUpdateCommand(
  program: Command,
  dependencies: PluginUpdateDependencies = {},
): void {
  program
    .command('update')
    .description('Update the agent-validator Claude plugin and refresh skills')
    .action(async () => {
      await runPluginUpdate(undefined, dependencies);
    });
}

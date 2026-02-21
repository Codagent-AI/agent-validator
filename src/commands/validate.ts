import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate .gauntlet/ config files against schemas')
    .action(async () => {
      try {
        await loadConfig();
        console.log(chalk.green('All config files are valid.'));
        process.exitCode = 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('Validation failed:'), message);
        process.exitCode = 1;
      }
    });
}

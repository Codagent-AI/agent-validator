import chalk from 'chalk';
import type { Command } from 'commander';
import { describeCliSource } from '../config/cli-resolution.js';
import { loadConfig } from '../config/loader.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate config files against schemas')
    .action(async () => {
      try {
        const config = await loadConfig();
        console.log(chalk.green('All config files are valid.'));
        if (config.cliSource)
          console.log(`CLI config: ${describeCliSource(config.cliSource)}`);
        process.exitCode = 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('Validation failed:'), message);
        process.exitCode = 1;
      }
    });
}

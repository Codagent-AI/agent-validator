import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import type { LoadedConfig } from '../config/types.js';

function printCheckGates(config: LoadedConfig): void {
  console.log(chalk.bold('Check Gates:'));
  for (const c of Object.values(config.checks)) {
    console.log(` - ${c.name}`);
  }
}

function printReviewGates(config: LoadedConfig): void {
  console.log(chalk.bold('\nReview Gates:'));
  for (const r of Object.values(config.reviews)) {
    console.log(` - ${r.name} (Tools: ${r.cli_preference?.join(', ')})`);
  }
}

function printEntryPoints(config: LoadedConfig): void {
  console.log(chalk.bold('\nEntry Points:'));
  for (const ep of config.project.entry_points) {
    console.log(` - ${ep.path}`);
    if (ep.checks) console.log(`   Checks: ${ep.checks.join(', ')}`);
    if (ep.reviews) console.log(`   Reviews: ${ep.reviews.join(', ')}`);
  }
}

/** Any load failure is a failure, matching `validate` and the other commands. */
function reportLoadFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red('Error:'), message);
  process.exitCode = 1;
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List configured gates')
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd(), {
          applyReviewerOverride: true,
        });
        printCheckGates(config);
        printReviewGates(config);
        printEntryPoints(config);
      } catch (error: unknown) {
        reportLoadFailure(error);
      }
    });
}

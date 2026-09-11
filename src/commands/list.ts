import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { ReviewerOverrideError } from '../config/reviewer-override.js';
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

/**
 * Only a reviewer-override failure exits nonzero. Other load failures keep the
 * exit code `list` had before the override shipped, so probes that tolerated a
 * missing or invalid config keep working.
 */
function reportLoadFailure(error: unknown): void {
  const err = error as { message?: string };
  console.error(chalk.red('Error:'), err.message);
  if (error instanceof ReviewerOverrideError) {
    process.exit(1);
  }
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

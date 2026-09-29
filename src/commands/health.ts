import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  type CLIAdapterHealth,
  getAdapter,
  getAllAdapters,
} from '../cli-adapters/index.js';
import type { GlobalConfigReadResult } from '../config/global.js';
import { isProjectConfigNotFound, loadConfig } from '../config/loader.js';
import { type ValidationResult, validateConfig } from '../config/validator.js';

function formatHealthResult(health: CLIAdapterHealth): string {
  switch (health.status) {
    case 'healthy':
      return chalk.green('Installed');
    case 'missing':
      return chalk.red('Missing');
    case 'unhealthy':
      return chalk.red(`${health.message || 'Unhealthy'}`);
  }
}

function displayValidationIssues(validationResult: ValidationResult): void {
  const issuesByFile = new Map<string, typeof validationResult.issues>();
  for (const issue of validationResult.issues) {
    const relativeFile = path.relative(process.cwd(), issue.file);
    if (!issuesByFile.has(relativeFile)) {
      issuesByFile.set(relativeFile, []);
    }
    issuesByFile.get(relativeFile)?.push(issue);
  }

  for (const [file, issues] of issuesByFile.entries()) {
    for (const issue of issues) {
      const icon =
        issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
      const fieldInfo = issue.field ? chalk.dim(` (${issue.field})`) : '';
      console.log(`  ${icon} ${file}${fieldInfo}`);
      console.log(`    ${issue.message}`);
    }
  }
}

async function validateAndDisplayConfig(): Promise<ValidationResult> {
  console.log(chalk.bold('Config validation:'));
  const validationResult = await validateConfig();

  if (validationResult.filesChecked.length === 0) {
    console.log(chalk.yellow('  No config files found'));
    return validationResult;
  }

  for (const file of validationResult.filesChecked) {
    const relativePath = path.relative(process.cwd(), file);
    console.log(chalk.dim(`  ${relativePath}`));
  }

  if (validationResult.valid && validationResult.issues.length === 0) {
    console.log(chalk.green('  ✓ All config files are valid'));
  } else {
    displayValidationIssues(validationResult);
  }
  return validationResult;
}

interface CollectedAgents {
  preferredAgents: Set<string>;
  reviewsWithEmptyPreference: string[];
}

function collectPreferredAgents(
  reviewEntries: [string, { cli_preference?: string[] }][],
): CollectedAgents {
  const preferredAgents = new Set<string>();
  const reviewsWithEmptyPreference: string[] = [];

  for (const [reviewName, review] of reviewEntries) {
    if (!review.cli_preference || review.cli_preference.length === 0) {
      reviewsWithEmptyPreference.push(reviewName);
    } else {
      for (const agent of review.cli_preference) {
        preferredAgents.add(agent);
      }
    }
  }

  return { preferredAgents, reviewsWithEmptyPreference };
}

function reportEmptyPreferences(reviewsWithEmptyPreference: string[]): void {
  if (reviewsWithEmptyPreference.length === 0) {
    return;
  }
  console.log(chalk.yellow('  ⚠️  Misconfiguration detected:'));
  for (const name of reviewsWithEmptyPreference) {
    console.log(
      chalk.yellow(`     Review gate "${name}" has empty cli_preference`),
    );
  }
  console.log();
}

async function checkConfiguredAgentsHealth(
  globalConfigRead: GlobalConfigReadResult,
): Promise<void> {
  const config = await loadConfig(process.cwd(), {
    applyReviewerOverride: true,
    globalConfigRead,
  });
  const reviewEntries = Object.entries(config.reviews);

  if (reviewEntries.length === 0) {
    console.log(chalk.yellow('  No CLI tools configured'));
    console.log(
      chalk.dim(
        '  No review gates found. Add review gates with cli_preference to check tool availability.',
      ),
    );
    return;
  }

  const { preferredAgents, reviewsWithEmptyPreference } =
    collectPreferredAgents(reviewEntries);

  reportEmptyPreferences(reviewsWithEmptyPreference);

  if (preferredAgents.size === 0) {
    console.log(chalk.yellow('  No CLI tools configured'));
    console.log(
      chalk.dim(
        '  All review gates have empty cli_preference. Add tools to cli_preference to check availability.',
      ),
    );
    return;
  }

  for (const agentName of Array.from(preferredAgents).sort()) {
    const adapter = getAdapter(agentName);
    if (adapter) {
      const health = await adapter.checkHealth();
      console.log(
        `  ${adapter.name.padEnd(10)} : ${formatHealthResult(health)}`,
      );
    } else {
      console.log(`  ${agentName.padEnd(10)} : ${chalk.yellow('Unknown')}`);
    }
  }
}

async function checkAllAgentsHealth(): Promise<void> {
  const adapters = getAllAdapters();
  console.log(chalk.dim('  (Config not found, checking all supported agents)'));

  for (const adapter of adapters) {
    const health = await adapter.checkHealth();
    console.log(`  ${adapter.name.padEnd(10)} : ${formatHealthResult(health)}`);
  }
}

export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Check CLI tool availability')
    .action(async () => {
      process.exitCode = 0;
      const validation = await validateAndDisplayConfig();
      let loadFailed = false;
      console.log();
      console.log(chalk.bold('CLI Tool Health Check:'));

      try {
        await checkConfiguredAgentsHealth(validation.globalConfigRead);
      } catch (error: unknown) {
        if (isProjectConfigNotFound(error)) {
          await checkAllAgentsHealth();
        } else {
          console.error(
            chalk.red('Error:'),
            error instanceof Error ? error.message : String(error),
          );
          loadFailed = true;
        }
      }
      // Without a project config, only a broken global file fails health.
      const hasConfigError = validation.projectConfigFound
        ? !validation.valid
        : validation.globalConfigRead.status === 'invalid';
      if (loadFailed || hasConfigError) process.exitCode = 1;
    });
}

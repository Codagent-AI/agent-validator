import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { type CLIAdapter, getAllAdapters } from '../cli-adapters/index.js';
import { installAgentPluginForAgents } from '../plugin/agent-plugin-cli.js';
import { writeConfigYml } from './init-config-helpers.js';
import {
  promptAgentPluginInstallConfirmation,
  promptDevCLIs,
  promptInstallScope,
  promptNumReviews,
  promptReviewCLIs,
} from './init-prompts.js';
import {
  printReviewConfigExplanation,
  type ReviewConfig,
  selectReviewConfig,
} from './init-reviews.js';
import { runPluginUpdate } from './plugin-update.js';
import { addToGitignore, exists } from './shared.js';

interface InitOptions {
  yes?: boolean;
  agents?: string[];
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .validator configuration')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .option(
      '--agents <names...>',
      'Development/coding agent names to install for (comma or space separated); skips the development agent prompt',
    )
    .action(async (options: InitOptions) => {
      await runInit(options);
    });
}

function parseAgentNameList(agentArgs: string[] | undefined): string[] | null {
  if (!agentArgs) return null;

  const names = agentArgs
    .flatMap((arg) => arg.split(','))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return [...new Set(names)];
}

function validateExplicitDevCLINames(
  requestedNames: string[] | null,
  detectedNames: string[],
): string[] | null {
  if (!requestedNames) return null;
  if (requestedNames.length === 0) {
    throw new Error('At least one development agent name must be provided.');
  }

  const detectedSet = new Set(detectedNames);
  const unknownNames = requestedNames.filter((name) => !detectedSet.has(name));
  if (unknownNames.length > 0) {
    const available =
      detectedNames.length > 0 ? detectedNames.join(', ') : 'none';
    throw new Error(
      `Unknown or unavailable development agent(s): ${unknownNames.join(', ')}. Detected agents: ${available}`,
    );
  }

  return requestedNames;
}

async function handleRerun(
  projectRoot: string,
  availableAdapters: CLIAdapter[],
  skipPrompts: boolean,
): Promise<void> {
  try {
    await runPluginUpdate({ skipPrompts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !(
        message.includes('Claude plugin is not installed') ||
        message.includes('No agent-validator plugin is installed')
      )
    )
      throw error;
    console.log(
      chalk.yellow('Plugin not installed yet, running fresh install...'),
    );
    await installExternalFiles(projectRoot, availableAdapters, skipPrompts);
  }
}

async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = process.cwd();
  const targetDir = path.join(projectRoot, '.validator');
  const legacyDir = path.join(projectRoot, '.gauntlet');
  const skipPrompts = options.yes ?? false;

  console.log('Detecting available CLI agents...');
  const availableAdapters = await detectAvailableCLIs();

  if (availableAdapters.length === 0) {
    printNoCLIsMessage();
    return;
  }

  const detectedNames = availableAdapters.map((a) => a.name);
  const explicitDevCLINames = validateExplicitDevCLINames(
    parseAgentNameList(options.agents),
    detectedNames,
  );
  let existingConfigDir: string | null = null;
  if (await exists(targetDir)) {
    existingConfigDir = targetDir;
  } else if (await exists(legacyDir)) {
    existingConfigDir = legacyDir;
  }

  let devAdapters: CLIAdapter[];
  let instructionCLINames: string[];

  if (existingConfigDir) {
    const dirName = path.basename(existingConfigDir);
    console.log(chalk.dim(`.${dirName}/ already exists, skipping scaffolding`));
    instructionCLINames = detectedNames;
    await handleRerun(projectRoot, availableAdapters, skipPrompts);
  } else {
    const devCLINames =
      explicitDevCLINames ?? (await promptDevCLIs(detectedNames, skipPrompts));
    devAdapters = availableAdapters.filter((a) => devCLINames.includes(a.name));

    for (const adapter of devAdapters) {
      if (!adapter.supportsHooks()) {
        console.log(
          chalk.yellow(
            `  ${adapter.name} doesn't support hooks yet, skipping hook installation`,
          ),
        );
      }
    }

    const reviewCLINames = await promptReviewCLIs(detectedNames, skipPrompts);
    const numReviews = await promptNumReviews(
      reviewCLINames.length,
      skipPrompts,
    );
    const reviewConfig = selectReviewConfig(reviewCLINames);
    printReviewConfigExplanation(reviewConfig);

    await scaffoldValidatorDir(
      projectRoot,
      targetDir,
      reviewCLINames,
      numReviews,
      reviewConfig,
    );
    instructionCLINames = devCLINames;
    await installExternalFiles(projectRoot, devAdapters, skipPrompts);
  }
  await addToGitignore(projectRoot, 'validator_logs');
  await printPostInitInstructions(instructionCLINames);
}

function printNoCLIsMessage(): void {
  console.log();
  console.log(chalk.red('Error: No CLI agents found. Install at least one:'));
  console.log('  - Claude: https://docs.anthropic.com/en/docs/claude-code');
  console.log('  - Gemini: https://github.com/google-gemini/gemini-cli');
  console.log('  - Codex: https://github.com/openai/codex');
  console.log();
}

async function scaffoldValidatorDir(
  _projectRoot: string,
  targetDir: string,
  reviewCLINames: string[],
  numReviews: number,
  reviewConfig: ReviewConfig,
): Promise<void> {
  if (await exists(targetDir)) {
    console.log(chalk.dim('.validator/ already exists, skipping scaffolding'));
    return;
  }

  await fs.mkdir(targetDir);

  await writeConfigYml(targetDir, reviewCLINames, numReviews, reviewConfig);
}

async function installExternalFiles(
  _projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
): Promise<void> {
  const targetNames = devAdapters.map((adapter) => adapter.name);
  if (targetNames.length === 0) {
    return;
  }

  const installScope = await promptInstallScope(skipPrompts);
  installAgentPluginForAgents({
    agents: targetNames,
    scope: installScope,
    dryRun: true,
  });

  const confirmed = await promptAgentPluginInstallConfirmation(skipPrompts);
  if (!confirmed) {
    console.log(chalk.yellow('Plugin installation cancelled.'));
    return;
  }

  installAgentPluginForAgents({
    agents: targetNames,
    scope: installScope,
    yes: skipPrompts,
  });
}

async function printPostInitInstructions(
  _devCLINames: string[],
): Promise<void> {
  console.log();
  console.log(
    chalk.bold(
      'To complete setup, run the validator-setup skill in your agent. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Validator will run.',
    ),
  );
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
  const allAdapters = [...getAllAdapters()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const available: CLIAdapter[] = [];

  for (const adapter of allAdapters) {
    const isAvailable = await adapter.isAvailable();
    if (isAvailable) {
      console.log(chalk.green(`  \u2713 ${adapter.name}`));
      available.push(adapter);
    } else {
      console.log(chalk.dim(`  \u2717 ${adapter.name} (not installed)`));
    }
  }
  return available;
}

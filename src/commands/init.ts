import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { getOptInBuiltInReviewNames } from '../built-in-reviews/index.js';
import { type CLIAdapter, getAllAdapters } from '../cli-adapters/index.js';
import { installAgentPluginForAgents as realInstallAgentPluginForAgents } from '../plugin/agent-plugin-cli.js';
import {
  buildOptInActivationComment,
  writeConfigYml,
} from './init-config-helpers.js';
import {
  promptAgentPluginInstallConfirmation,
  promptDevCLIs,
  promptInstallScope,
  promptLocalAIReviews,
  promptNumReviews,
  promptReviewCLIs,
} from './init-prompts.js';
import {
  buildOptInBuiltinEntries,
  printReviewConfigExplanation,
  type ReviewConfig,
  selectReviewConfig,
} from './init-reviews.js';
import {
  type PluginUpdateDependencies,
  runPluginUpdate,
} from './plugin-update.js';
import { addToGitignore, exists } from './shared.js';

interface InitOptions {
  yes?: boolean;
  agents?: string[];
  enableBuiltin?: string[];
}

interface InitDependencies extends PluginUpdateDependencies {
  installAgentPluginForAgents?: typeof realInstallAgentPluginForAgents;
}

interface InitReviewSelection {
  cliDefaultNames: string[];
  reviewCLINames: string[];
  numReviews: number;
  reviewConfig: ReviewConfig;
}

export function registerInitCommand(
  program: Command,
  dependencies: InitDependencies = {},
): void {
  program
    .command('init')
    .description('Initialize .validator configuration')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .option(
      '--agents <names...>',
      'Development/coding agent names to install for (comma or space separated); skips the development agent prompt',
    )
    .option(
      '--enable-builtin <names...>',
      'Built-in opt-in review names to scaffold with enabled: false (comma or space separated). Names must be opt-in built-ins.',
    )
    .action(async (options: InitOptions) => {
      await runInit(options, dependencies);
    });
}

function parseNameList(args: string[] | undefined): string[] | null {
  if (!args) return null;

  const names = args
    .flatMap((arg) => arg.split(','))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return [...new Set(names)];
}

function parseAgentNameList(agentArgs: string[] | undefined): string[] | null {
  return parseNameList(agentArgs);
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

function validateOptInBuiltinNames(requestedNames: string[] | null): string[] {
  if (!requestedNames) return [];
  if (requestedNames.length === 0) {
    throw new Error(
      'At least one opt-in built-in review name must be provided.',
    );
  }

  const acceptedNames = getOptInBuiltInReviewNames();
  const acceptedSet = new Set(acceptedNames);
  const invalidName = requestedNames.find((name) => !acceptedSet.has(name));
  if (invalidName) {
    throw new Error(
      `${invalidName} is not an opt-in built-in review. Accepted opt-in built-ins: ${acceptedNames.join(', ')}`,
    );
  }

  return requestedNames;
}

function buildOptInBuiltinPasteBlock(names: string[]): string {
  return names
    .map(
      (name) =>
        `  - ${name}:\n      builtin: ${name}\n      enabled: false # ${buildOptInActivationComment(name)}`,
    )
    .join('\n');
}

function printExistingConfigOptInWarning(names: string[]): void {
  if (names.length === 0) return;

  console.log();
  console.log(
    chalk.yellow(
      'Warning: --enable-builtin was passed but .validator/ already exists.',
    ),
  );
  console.log(
    chalk.yellow(
      `The following entries were NOT added to .validator/config.yml: ${names.join(', ')}.`,
    ),
  );
  console.log(
    "Paste the YAML block below under an entry point's `reviews:` list to enable them:",
  );
  console.log();
  console.log(buildOptInBuiltinPasteBlock(names));
  console.log();
}

async function handleRerun(
  projectRoot: string,
  availableAdapters: CLIAdapter[],
  skipPrompts: boolean,
  dependencies: InitDependencies,
): Promise<void> {
  try {
    await runPluginUpdate(
      { skipPrompts },
      { updateAgentPluginForAgents: dependencies.updateAgentPluginForAgents },
    );
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
    await installExternalFiles(
      projectRoot,
      availableAdapters,
      skipPrompts,
      dependencies,
    );
  }
}

async function runInit(
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const targetDir = path.join(projectRoot, '.validator');
  const legacyDir = path.join(projectRoot, '.gauntlet');
  const skipPrompts = options.yes ?? false;
  const optInBuiltinNames = validateOptInBuiltinNames(
    parseNameList(options.enableBuiltin),
  );

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
    printExistingConfigOptInWarning(optInBuiltinNames);
    instructionCLINames = detectedNames;
    await handleRerun(
      projectRoot,
      availableAdapters,
      skipPrompts,
      dependencies,
    );
  } else {
    const devCLINames =
      explicitDevCLINames ?? (await promptDevCLIs(detectedNames, skipPrompts));
    devAdapters = availableAdapters.filter((a) => devCLINames.includes(a.name));

    const reviewSelection = await selectReviewsAndConfirmInstall(
      detectedNames,
      projectRoot,
      devAdapters,
      skipPrompts,
      dependencies,
      optInBuiltinNames,
    );
    instructionCLINames = devCLINames;
    await scaffoldValidatorDir(
      projectRoot,
      targetDir,
      reviewSelection.cliDefaultNames,
      reviewSelection.numReviews,
      reviewSelection.reviewConfig,
    );
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
  cliDefaultNames: string[],
  numReviews: number,
  reviewConfig: ReviewConfig,
): Promise<void> {
  if (await exists(targetDir)) {
    console.log(chalk.dim('.validator/ already exists, skipping scaffolding'));
    return;
  }

  await fs.mkdir(targetDir);

  await writeConfigYml(targetDir, cliDefaultNames, numReviews, reviewConfig);
}

async function selectReviewsAndConfirmInstall(
  detectedNames: string[],
  projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
  dependencies: InitDependencies,
  optInBuiltinNames: string[],
): Promise<InitReviewSelection> {
  const optInReviews = buildOptInBuiltinEntries(optInBuiltinNames);
  while (true) {
    const localAIReviewsEnabled = await promptLocalAIReviews(skipPrompts);
    if (!localAIReviewsEnabled) {
      const confirmed = await installExternalFiles(
        projectRoot,
        devAdapters,
        skipPrompts,
        dependencies,
      );
      if (confirmed) {
        return {
          cliDefaultNames: devAdapters.map((adapter) => adapter.name),
          reviewCLINames: [],
          numReviews: 1,
          reviewConfig: { type: 'none', reviews: optInReviews },
        };
      }

      console.log(chalk.yellow('Returning to local AI review selection.'));
      continue;
    }

    const reviewCLINames = await promptReviewCLIs(detectedNames, skipPrompts);
    const numReviews = await promptNumReviews(
      reviewCLINames.length,
      skipPrompts,
    );
    const reviewConfig = selectReviewConfig(reviewCLINames);
    reviewConfig.reviews = [...reviewConfig.reviews, ...optInReviews];
    printReviewConfigExplanation(reviewConfig);

    const confirmed = await installExternalFiles(
      projectRoot,
      devAdapters,
      skipPrompts,
      dependencies,
    );
    if (confirmed) {
      return {
        cliDefaultNames: reviewCLINames,
        reviewCLINames,
        numReviews,
        reviewConfig,
      };
    }

    console.log(chalk.yellow('Returning to reviewer CLI selection.'));
  }
}

async function installExternalFiles(
  _projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
  dependencies: InitDependencies,
): Promise<boolean> {
  const installAgentPluginForAgents =
    dependencies.installAgentPluginForAgents ?? realInstallAgentPluginForAgents;
  const targetNames = devAdapters.map((adapter) => adapter.name);
  if (targetNames.length === 0) {
    return true;
  }

  const installScope = await promptInstallScope(skipPrompts);
  console.log();
  console.log(
    chalk.bold(
      'Agent Validator will install the following skills and agent plugins:',
    ),
  );
  installAgentPluginForAgents({
    agents: targetNames,
    scope: installScope,
    dryRun: true,
  });

  const confirmed = await promptAgentPluginInstallConfirmation(skipPrompts);
  if (!confirmed) {
    console.log(chalk.yellow('Plugin installation cancelled.'));
    return false;
  }

  installAgentPluginForAgents({
    agents: targetNames,
    scope: installScope,
    yes: skipPrompts,
  });
  return true;
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

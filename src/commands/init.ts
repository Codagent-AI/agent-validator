import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import { type CLIAdapter, getAllAdapters } from '../cli-adapters/index.js';
import { computeSkillChecksum } from './init-checksums.js';
import { writeConfigYml } from './init-config-helpers.js';
import { getCodexSkillsBaseDir, installAdapterPlugin } from './init-plugin.js';
import {
  type OverwriteChoice,
  promptDevCLIs,
  promptFileOverwrite,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// After bundling, __dirname is `dist/` (one level below package root).
// In dev, __dirname is `src/commands/` (two levels below package root).
// Detect context by checking which path actually contains the skills directory.
const SKILLS_SOURCE_DIR = (() => {
  const bundled = path.join(__dirname, '..', 'skills');
  const dev = path.join(__dirname, '..', '..', 'skills');
  try {
    statSync(bundled);
    return bundled;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return dev;
    throw err;
  }
})();

async function getSkillDirNames(): Promise<string[]> {
  const entries = await fs.readdir(SKILLS_SOURCE_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const CLI_PREFERENCE_ORDER = [
  'github-copilot',
  'codex',
  'claude',
  'cursor',
  'gemini',
];

interface InitOptions {
  yes?: boolean;
}

/** Native CLIs that support the /validator-setup skill invocation. */
const NATIVE_CLIS = new Set(['claude', 'cursor', 'github-copilot']);

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .validator configuration')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .action(async (options: InitOptions) => {
      await runInit(options);
    });
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
    const devCLINames = await promptDevCLIs(detectedNames, skipPrompts);
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

async function copyDirRecursive(opts: {
  src: string;
  dest: string;
}): Promise<void> {
  await fs.mkdir(opts.dest, { recursive: true });
  const entries = await fs.readdir(opts.src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(opts.src, entry.name);
    const destPath = path.join(opts.dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive({ src: srcPath, dest: destPath });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

interface UpdateAllState {
  updateAll: boolean;
}

async function installSkillsWithChecksums(
  projectRoot: string,
  targetBaseDir: string,
  skipPrompts: boolean,
  updateAllState: UpdateAllState,
): Promise<void> {
  const skillsDir = path.isAbsolute(targetBaseDir)
    ? targetBaseDir
    : path.join(projectRoot, targetBaseDir);
  for (const dirName of await getSkillDirNames()) {
    const sourceDir = path.join(SKILLS_SOURCE_DIR, dirName);
    const targetDir = path.join(skillsDir, dirName);
    const relativeDir = `${path.relative(projectRoot, targetDir)}/`;

    if (!(await exists(targetDir))) {
      await copyDirRecursive({ src: sourceDir, dest: targetDir });
      console.log(chalk.green(`Created ${relativeDir}`));
      continue;
    }

    const sourceChecksum = await computeSkillChecksum(sourceDir);
    const targetChecksum = await computeSkillChecksum(targetDir);
    if (sourceChecksum === targetChecksum) continue;

    let choice: OverwriteChoice;
    if (skipPrompts || updateAllState.updateAll) {
      choice = 'yes';
    } else {
      choice = await promptFileOverwrite(dirName, skipPrompts);
      if (choice === 'all') {
        updateAllState.updateAll = true;
      }
    }
    if (choice === 'no') continue;

    await fs.rm(targetDir, { recursive: true, force: true });
    await copyDirRecursive({ src: sourceDir, dest: targetDir });
    console.log(chalk.green(`Updated ${relativeDir}`));
  }
}

/** Detect which adapters need plugin installation, logging already-installed adapters. */
async function detectAdaptersNeedingInstall(
  devAdapters: CLIAdapter[],
  projectRoot: string,
): Promise<CLIAdapter[]> {
  const result: CLIAdapter[] = [];
  for (const adapter of devAdapters) {
    if (!adapter.installPlugin) continue;

    if (adapter.detectPlugin) {
      const existingScope = await adapter.detectPlugin(projectRoot);
      if (existingScope) {
        console.log(
          chalk.dim(
            `${adapter.name} plugin already installed at ${existingScope} scope, skipping install`,
          ),
        );
        continue;
      }
    }

    result.push(adapter);
  }
  return result;
}

/** Install skills for non-Claude/Codex adapters (e.g. Gemini, Cursor). */
async function installOtherAdapterSkills(
  projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
  updateAllState: UpdateAllState,
): Promise<void> {
  const seen = new Set<string>();
  for (const adapter of devAdapters) {
    if (
      adapter.name === 'claude' ||
      adapter.name === 'codex' ||
      adapter.name === 'github-copilot'
    )
      continue;
    const dir = adapter.getProjectSkillDir();
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      await installSkillsWithChecksums(
        projectRoot,
        dir,
        skipPrompts,
        updateAllState,
      );
    }
  }
}

async function installExternalFiles(
  projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
): Promise<void> {
  const updateAllState: UpdateAllState = { updateAll: false };
  const devAdapterNames = new Set(devAdapters.map((adapter) => adapter.name));

  const adaptersNeedingInstall = await detectAdaptersNeedingInstall(
    devAdapters,
    projectRoot,
  );

  // Prompt for scope only when at least one adapter needs installation
  const needsScope =
    adaptersNeedingInstall.length > 0 || devAdapterNames.has('codex');
  const installScope: 'user' | 'project' = needsScope
    ? await promptInstallScope(skipPrompts)
    : 'project';

  for (const adapter of adaptersNeedingInstall) {
    await installAdapterPlugin(adapter, projectRoot, installScope);
  }

  if (devAdapterNames.has('codex')) {
    const codexBaseDir = getCodexSkillsBaseDir(installScope);
    await installSkillsWithChecksums(
      projectRoot,
      codexBaseDir,
      skipPrompts,
      updateAllState,
    );
  }

  await installOtherAdapterSkills(
    projectRoot,
    devAdapters,
    skipPrompts,
    updateAllState,
  );
}

async function printPostInitInstructions(devCLINames: string[]): Promise<void> {
  const hasNative = devCLINames.some((name) => NATIVE_CLIS.has(name));
  const hasCodex = devCLINames.includes('codex');
  const otherNonNativeNames = devCLINames.filter(
    (name) => !NATIVE_CLIS.has(name) && name !== 'codex',
  );
  const hasOtherNonNative = otherNonNativeNames.length > 0;

  console.log();
  if (hasNative) {
    console.log(
      chalk.bold(
        'To complete setup, run /validator-setup in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Validator will run.',
      ),
    );
  }
  if (hasCodex) {
    console.log(
      chalk.bold(
        'To complete setup in Codex, reference the setup skill: .agents/skills/validator-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Validator will run.',
      ),
    );
    console.log();
    console.log('Available Codex skills:');
    for (const dirName of await getSkillDirNames()) {
      console.log(`  .agents/skills/${dirName}/SKILL.md`);
    }
  }
  if (hasOtherNonNative) {
    console.log(
      chalk.bold(
        'To complete setup, reference the setup skill in your CLI: @.claude/skills/validator-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Validator will run.',
      ),
    );
    console.log();
    console.log('Available skills:');
    for (const dirName of await getSkillDirNames()) {
      console.log(`  @.claude/skills/${dirName}/SKILL.md`);
    }
  }
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
  const allAdapters = [...getAllAdapters()].sort(
    (a, b) =>
      CLI_PREFERENCE_ORDER.indexOf(a.name) -
      CLI_PREFERENCE_ORDER.indexOf(b.name),
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

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import { type CLIAdapter, getAllAdapters } from '../cli-adapters/index.js';
import { computeSkillChecksum } from './init-checksums.js';
import {
  detectInstalledPlugin,
  getCodexSkillsBaseDir,
  installClaudePluginWithFallback,
} from './init-plugin.js';
import {
  type OverwriteChoice,
  promptDevCLIs,
  promptFileOverwrite,
  promptInstallScope,
  promptNumReviews,
  promptReviewCLIs,
} from './init-prompts.js';
import { runPluginUpdate } from './plugin-update.js';
import { exists } from './shared.js';

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
  'codex',
  'claude',
  'cursor',
  'github-copilot',
  'gemini',
];

type AdapterCfg = {
  allow_tool_use: boolean;
  thinking_budget: string;
  model?: string;
};
const ADAPTER_CONFIG: Record<string, AdapterCfg> = {
  claude: { allow_tool_use: false, thinking_budget: 'high' },
  codex: { allow_tool_use: false, thinking_budget: 'low' },
  gemini: { allow_tool_use: false, thinking_budget: 'low' },
  cursor: { allow_tool_use: false, thinking_budget: 'low', model: 'codex' },
  'github-copilot': {
    allow_tool_use: false,
    thinking_budget: 'low',
    model: 'codex',
  },
};

interface InitOptions {
  yes?: boolean;
}

/** Native CLIs that support the /gauntlet-setup skill invocation. */
const NATIVE_CLIS = new Set(['claude', 'cursor']);

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize .gauntlet configuration')
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
    if (!message.includes('Claude plugin is not installed')) throw error;
    console.log(
      chalk.yellow('Plugin not installed yet, running fresh install...'),
    );
    const installScope = await promptInstallScope(skipPrompts);
    await installExternalFiles(
      projectRoot,
      availableAdapters,
      skipPrompts,
      installScope,
    );
  }
}

async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = process.cwd();
  const targetDir = path.join(projectRoot, '.gauntlet');
  const skipPrompts = options.yes ?? false;

  console.log('Detecting available CLI agents...');
  const availableAdapters = await detectAvailableCLIs();

  if (availableAdapters.length === 0) {
    printNoCLIsMessage();
    return;
  }

  const detectedNames = availableAdapters.map((a) => a.name);
  const gauntletExists = await exists(targetDir);

  let devAdapters: CLIAdapter[];
  let instructionCLINames: string[];
  let installScope: 'user' | 'project' = 'project';

  if (gauntletExists) {
    console.log(chalk.dim('.gauntlet/ already exists, skipping scaffolding'));
    instructionCLINames = detectedNames;
    await handleRerun(projectRoot, availableAdapters, skipPrompts);
  } else {
    const devCLINames = await promptDevCLIs(detectedNames, skipPrompts);
    devAdapters = availableAdapters.filter((a) => devCLINames.includes(a.name));

    const existingPluginScope = devCLINames.includes('claude')
      ? await detectInstalledPlugin(projectRoot)
      : null;
    if (existingPluginScope) {
      console.log(
        chalk.dim(
          `Claude plugin already installed at ${existingPluginScope} scope, skipping install`,
        ),
      );
      installScope = existingPluginScope;
    } else {
      installScope = await promptInstallScope(skipPrompts);
    }

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
    console.log(
      chalk.cyan(
        "Agent Gauntlet's built-in code quality reviewer will be installed.",
      ),
    );

    await scaffoldGauntletDir(
      projectRoot,
      targetDir,
      reviewCLINames,
      numReviews,
    );
    instructionCLINames = devCLINames;
    await installExternalFiles(
      projectRoot,
      devAdapters,
      skipPrompts,
      installScope,
      existingPluginScope !== null,
    );
  }
  await addToGitignore(projectRoot, 'gauntlet_logs');
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

async function scaffoldGauntletDir(
  _projectRoot: string,
  targetDir: string,
  reviewCLINames: string[],
  numReviews: number,
): Promise<void> {
  if (await exists(targetDir)) {
    console.log(chalk.dim('.gauntlet/ already exists, skipping scaffolding'));
    return;
  }

  await fs.mkdir(targetDir);
  await fs.mkdir(path.join(targetDir, 'checks'));
  await fs.mkdir(path.join(targetDir, 'reviews'));

  await writeConfigYml(targetDir, reviewCLINames);

  await fs.writeFile(
    path.join(targetDir, 'reviews', 'code-quality.yml'),
    `builtin: code-quality\nnum_reviews: ${numReviews}\n`,
  );
  console.log(chalk.green('Created .gauntlet/reviews/code-quality.yml'));
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

async function installExternalFiles(
  projectRoot: string,
  devAdapters: CLIAdapter[],
  skipPrompts: boolean,
  installScope: 'user' | 'project',
  skipClaudePlugin = false,
): Promise<void> {
  const updateAllState: UpdateAllState = { updateAll: false };
  const devAdapterNames = new Set(devAdapters.map((adapter) => adapter.name));

  if (devAdapterNames.has('claude') && !skipClaudePlugin) {
    await installClaudePluginWithFallback(installScope);
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

  const seen = new Set<string>();
  for (const adapter of devAdapters) {
    if (adapter.name === 'claude' || adapter.name === 'codex') {
      continue;
    }
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
        'To complete setup, run /gauntlet-setup in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Gauntlet will run.',
      ),
    );
  }
  if (hasCodex) {
    console.log(
      chalk.bold(
        'To complete setup in Codex, reference the setup skill: .agents/skills/gauntlet-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Gauntlet will run.',
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
        'To complete setup, reference the setup skill in your CLI: @.claude/skills/gauntlet-setup/SKILL.md. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Gauntlet will run.',
      ),
    );
    console.log();
    console.log('Available skills:');
    for (const dirName of await getSkillDirNames()) {
      console.log(`  @.claude/skills/${dirName}/SKILL.md`);
    }
  }
}

async function writeConfigYml(
  targetDir: string,
  reviewCLINames: string[],
): Promise<void> {
  const baseBranch = await detectBaseBranch();
  const cliList = reviewCLINames.map((name) => `    - ${name}`).join('\n');
  const adapterSettings = buildAdapterSettingsBlock(reviewCLINames);

  const content = `# Ordered list of CLI agents to try for reviews
cli:
  default_preference:
${cliList}
${adapterSettings}
# entry_points configured by /gauntlet-setup
entry_points: []

# -------------------------------------------------------------------
# All settings below are optional. Uncomment and change as needed.
# -------------------------------------------------------------------

# Git ref for detecting local changes via git diff (default: origin/main)
# base_branch: ${baseBranch}

# Directory for per-job logs (default: gauntlet_logs)
# log_dir: gauntlet_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

# Maximum retry attempts before declaring "Retry limit exceeded" (default: 3)
# max_retries: 3

# Archived session directories to keep during log rotation (default: 3, 0 = disable)
# max_previous_logs: 3

# Priority threshold for filtering new violations during reruns (default: medium)
# Options: critical, high, medium, low
# rerun_new_issue_threshold: medium

# Stop hook — auto-run gauntlet when the agent stops
# Precedence: env vars > project config > global config (~/.config/agent-gauntlet/config.yml)
# Env overrides: GAUNTLET_STOP_HOOK_ENABLED, GAUNTLET_STOP_HOOK_INTERVAL_MINUTES
# stop_hook:
#   enabled: false
#   run_interval_minutes: 5       # Minimum minutes between runs (0 = always run)

# Debug log — persistent debug logging to .debug.log
# debug_log:
#   enabled: false
#   max_size_mb: 10               # Max size before rotation to .debug.log.1

# Structured logging via LogTape
# logging:
#   level: debug                  # Options: debug, info, warning, error
#   console:
#     enabled: true
#     format: pretty              # Options: pretty, json
#   file:
#     enabled: true
#     format: text                # Options: text, json
`;
  await fs.writeFile(path.join(targetDir, 'config.yml'), content);
  console.log(chalk.green('Created .gauntlet/config.yml'));
}

async function addToGitignore(
  projectRoot: string,
  entry: string,
): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  let content = '';
  if (await exists(gitignorePath)) {
    content = await fs.readFile(gitignorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) return;
  }

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await fs.appendFile(gitignorePath, `${suffix}${entry}\n`);
  console.log(chalk.green(`Added ${entry} to .gitignore`));
}

function gitSilent(args: string[], opts?: { timeout?: number }): string | null {
  try {
    return (
      execFileSync('git', args, {
        encoding: 'utf-8',
        timeout: opts?.timeout,
        stdio: ['pipe', 'pipe', 'ignore'],
      }) as string
    ).trim();
  } catch {
    return null;
  }
}

async function detectBaseBranch(): Promise<string> {
  gitSilent(['remote', 'set-head', 'origin', '--auto'], { timeout: 5000 });
  const ref = gitSilent(['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (ref) return ref.replace('refs/remotes/', '');

  for (const candidate of ['origin/main', 'origin/master']) {
    if (gitSilent(['rev-parse', '--verify', candidate]) !== null) {
      return candidate;
    }
  }
  return 'origin/main';
}

function buildAdapterSettingsBlock(adapterNames: string[]): string {
  const items = adapterNames.filter((name) => ADAPTER_CONFIG[name]);
  if (items.length === 0) return '';
  const lines = items.map((name) => {
    const c = ADAPTER_CONFIG[name];
    let block = `    ${name}:\n      allow_tool_use: ${c?.allow_tool_use}\n      thinking_budget: ${c?.thinking_budget}`;
    if (c?.model) {
      block += `\n      model: ${c.model}`;
    }
    return block;
  });
  return `  # Recommended settings (see docs/eval-results.md)\n  adapters:\n${lines.join('\n')}\n`;
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

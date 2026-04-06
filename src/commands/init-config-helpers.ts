import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import YAML from 'yaml';
import type { ReviewConfig } from './init-reviews.js';

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
  opencode: { allow_tool_use: false, thinking_budget: 'low' },
};

function gitSilent(args: string[], opts?: { timeout?: number }): string | null {
  try {
    return (
      execFileSync('git', args, {
        encoding: 'utf-8',
        timeout: opts?.timeout,
        stdio: ['pipe', 'pipe', 'ignore'],
      }) as string
    ).trim();
  } catch (error: unknown) {
    const cmd = `git ${args.join(' ')}`;
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.warn(`Warning: git not found when running: ${cmd}`);
      } else if (code === 'ETIMEDOUT' || code === 'ERR_CHILD_PROCESS_TIMEOUT') {
        console.warn(`Warning: ${cmd} timed out`);
      }
      // Non-zero exit status is expected for probing commands — return null silently
    }
    return null;
  }
}

export async function detectBaseBranch(): Promise<string> {
  gitSilent(['remote', 'set-head', 'origin', '--auto'], { timeout: 5000 });
  const ref = gitSilent(['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (ref) return ref.replace('refs/remotes/', '');

  for (const candidate of ['origin/main', 'origin/master']) {
    if (gitSilent(['rev-parse', '--verify', candidate]) !== null) {
      return candidate;
    }
  }
  console.warn(
    'Warning: Unable to detect base branch; defaulting to origin/main',
  );
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

export async function writeConfigYml(
  targetDir: string,
  reviewCLINames: string[],
  numReviews: number,
  reviewConfig: ReviewConfig,
): Promise<void> {
  const baseBranch = await detectBaseBranch();
  const cliList = reviewCLINames.map((name) => `    - ${name}`).join('\n');
  const adapterSettings = buildAdapterSettingsBlock(reviewCLINames);

  // Build inline review entries for the root entry point
  const inlineReviews = reviewConfig.reviews.map((r) => {
    const obj: Record<string, unknown> = {
      builtin: r.builtin,
      num_reviews: numReviews,
    };
    if (r.cli_preference) obj.cli_preference = r.cli_preference;
    if (r.model) obj.model = r.model;
    return { [r.name]: obj };
  });

  const rootEntryPoint: Record<string, unknown> = { path: '.' };
  if (inlineReviews.length > 0) {
    rootEntryPoint.reviews = inlineReviews;
  }

  const entryPointsBlock = YAML.stringify([rootEntryPoint], {
    indent: 2,
    flowCollectionPadding: false,
  })
    .trimEnd()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  const content = `# Ordered list of CLI agents to try for reviews
cli:
  default_preference:
${cliList}
${adapterSettings}
# entry_points configured by /validator-setup
entry_points:
${entryPointsBlock}

# -------------------------------------------------------------------
# All settings below are optional. Uncomment and change as needed.
# -------------------------------------------------------------------

# Git ref for detecting local changes via git diff (default: origin/main)
# base_branch: ${baseBranch}

# Directory for per-job logs (default: validator_logs)
# log_dir: validator_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

# Maximum retry attempts before declaring "Retry limit exceeded" (default: 3)
# max_retries: 3

# Archived session directories to keep during log rotation (default: 3, 0 = disable)
# max_previous_logs: 3

# Priority threshold for filtering new violations during reruns (default: medium)
# Options: critical, high, medium, low
# rerun_new_issue_threshold: medium

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
  console.log(chalk.green('Created .validator/config.yml'));
}

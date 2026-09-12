import {
  ADAPTER_CONFIG,
  type AdapterInitDefaults,
} from './adapter-defaults.js';
import type {
  AdapterConfig,
  LoadedReviewGateConfig,
  NormalizedValidatorConfig,
  ReviewerOverrideIdentity,
} from './types.js';

export const REVIEWER_CLI_ENV = 'AGENT_VALIDATOR_REVIEWER_CLI';
export const REVIEWER_MODEL_ENV = 'AGENT_VALIDATOR_REVIEWER_MODEL';
export const REVIEWER_EFFORT_ENV = 'AGENT_VALIDATOR_REVIEWER_EFFORT';

const RUNNER_CLI_TO_ADAPTER = {
  claude: 'claude',
  codex: 'codex',
  cursor: 'cursor',
  opencode: 'opencode',
  copilot: 'github-copilot',
} as const;

type RunnerCli = keyof typeof RUNNER_CLI_TO_ADAPTER;
export type MappedReviewerAdapter = (typeof RUNNER_CLI_TO_ADAPTER)[RunnerCli];

const EFFORT_TO_BUDGET = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
} as const;

type RunnerEffort = keyof typeof EFFORT_TO_BUDGET;
export type OverlayThinkingBudget = AdapterInitDefaults['thinking_budget'];

export class ReviewerOverrideError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'ReviewerOverrideError';
    this.variable = variable;
  }
}

export type ReviewerOverrideParseResult =
  | { active: false }
  | {
      active: true;
      adapter: MappedReviewerAdapter;
      model?: string;
      thinkingBudget?: OverlayThinkingBudget;
      effortCollapsed?: 'xhigh';
    };

/** The parse result once an override is known to be active. */
type ActiveReviewerOverride = Extract<
  ReviewerOverrideParseResult,
  { active: true }
>;

function readTrimmed(
  env: NodeJS.Dict<string | undefined>,
  key: string,
): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isRunnerCli(value: string): value is RunnerCli {
  return Object.hasOwn(RUNNER_CLI_TO_ADAPTER, value);
}

function isRunnerEffort(value: string): value is RunnerEffort {
  return Object.hasOwn(EFFORT_TO_BUDGET, value);
}

export function applyReviewerOverrideToConfig(
  project: NormalizedValidatorConfig,
  reviews: Record<string, LoadedReviewGateConfig>,
  parsed: ActiveReviewerOverride,
): ReviewerOverrideIdentity {
  const mapped = parsed.adapter;
  project.cli.default_preference = [mapped];
  for (const review of Object.values(reviews)) {
    review.cli_preference = [mapped];
  }
  overlayAdapterBlock(project, parsed);
  return {
    source: 'runner-reviewer-role',
    adapter: mapped,
    ...(parsed.effortCollapsed
      ? { effortCollapsed: parsed.effortCollapsed }
      : {}),
  };
}

function overlayAdapterBlock(
  project: NormalizedValidatorConfig,
  parsed: ActiveReviewerOverride,
): void {
  const mapped = parsed.adapter;
  const adapters = { ...project.cli.adapters };
  const existing = adapters[mapped];
  const base = existing ?? initDefaultsFor(mapped);
  adapters[mapped] = withRoleOverlay(base, parsed);
  project.cli.adapters = adapters;
}

function initDefaultsFor(adapter: MappedReviewerAdapter): AdapterInitDefaults {
  const defaults = ADAPTER_CONFIG[adapter];
  if (!defaults) {
    throw new Error(`Missing init defaults for adapter "${adapter}"`);
  }
  return defaults;
}

function withRoleOverlay(
  base: AdapterConfig | AdapterInitDefaults,
  parsed: ActiveReviewerOverride,
): AdapterConfig {
  return {
    allow_tool_use: base.allow_tool_use,
    thinking_budget: parsed.thinkingBudget ?? base.thinking_budget,
    model: parsed.model ?? base.model,
  };
}

export function parseReviewerOverrideEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
): ReviewerOverrideParseResult {
  const cli = readTrimmed(env, REVIEWER_CLI_ENV);
  const model = readTrimmed(env, REVIEWER_MODEL_ENV);
  const effort = readTrimmed(env, REVIEWER_EFFORT_ENV);
  // A variable that is blank after trimming counts as absent, so a caller that
  // exports all three unconditionally and leaves them empty means "no reviewer
  // role" rather than a malformed override.
  const active =
    cli !== undefined || model !== undefined || effort !== undefined;

  if (!active) {
    return { active: false };
  }

  if (cli === undefined) {
    throw new ReviewerOverrideError(
      REVIEWER_CLI_ENV,
      'is required when a reviewer override is active',
    );
  }

  if (!isRunnerCli(cli)) {
    throw new ReviewerOverrideError(
      REVIEWER_CLI_ENV,
      `has unmapped value "${cli}"`,
    );
  }

  if (effort !== undefined && !isRunnerEffort(effort)) {
    throw new ReviewerOverrideError(
      REVIEWER_EFFORT_ENV,
      `has invalid value "${effort}"`,
    );
  }

  return {
    active: true,
    adapter: RUNNER_CLI_TO_ADAPTER[cli],
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined
      ? {
          thinkingBudget: EFFORT_TO_BUDGET[effort],
          ...(effort === 'xhigh' ? { effortCollapsed: 'xhigh' as const } : {}),
        }
      : {}),
  };
}

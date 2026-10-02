import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  type CliSource,
  checkEffectiveCli,
  describeCliSource,
  InvalidCliConfigError,
  MissingCliConfigError,
} from './cli-resolution.js';
import {
  type GlobalConfigReadResult,
  getGlobalConfigPath,
  globalConfigFromReadResult,
  loadGlobalConfig,
} from './global.js';
import { loadCheckGates } from './load-checks.js';
import { loadReviewGates } from './load-reviews.js';
import { fileExists } from './loader-utils.js';
import {
  applyReviewerOverrideToConfig,
  parseReviewerOverrideEnv,
} from './reviewer-override.js';
import { validatorConfigSchema } from './schema.js';
import type {
  CheckGateConfig,
  LoadedCheckGateConfig,
  LoadedConfig,
  LoadedProjectConfig,
  LoadedReviewGateConfig,
  NormalizedEntryPoint,
  NormalizedValidatorConfig,
  ReviewYamlConfig,
  ValidatorConfig,
} from './types.js';

const VALIDATOR_DIR = '.validator';
const LEGACY_GAUNTLET_DIR = '.gauntlet';
const CONFIG_FILE = 'config.yml';

function resolveConfigDir(rootDir: string): string {
  const validatorPath = path.join(rootDir, VALIDATOR_DIR);
  const legacyPath = path.join(rootDir, LEGACY_GAUNTLET_DIR);
  if (existsSync(validatorPath)) return validatorPath;
  if (existsSync(legacyPath)) return legacyPath;
  return validatorPath; // default for new projects
}

export interface LoadConfigOptions {
  applyReviewerOverride?: boolean;
  requireCli?: boolean;
  globalConfigPath?: string;
  /** A global config already read in this invocation; avoids a second read. */
  globalConfigRead?: GlobalConfigReadResult;
}

export class ProjectConfigNotFoundError extends Error {
  constructor(configPath: string) {
    super(`Configuration file not found at ${configPath}`);
    this.name = 'ProjectConfigNotFoundError';
  }
}

export function isProjectConfigNotFound(
  error: unknown,
): error is ProjectConfigNotFoundError {
  return error instanceof ProjectConfigNotFoundError;
}

export async function loadConfig(
  rootDir: string = process.cwd(),
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const configDir = resolveConfigDir(rootDir);
  const configPath = path.join(configDir, CONFIG_FILE);

  // 1. Load project config
  if (!(await fileExists(configPath))) {
    throw new ProjectConfigNotFoundError(configPath);
  }

  const configContent = await fs.readFile(configPath, 'utf-8');
  const projectConfigRaw = YAML.parse(configContent);
  const projectConfig = validatorConfigSchema.parse(projectConfigRaw);

  const globalConfigPath =
    options.globalConfigRead?.path ??
    options.globalConfigPath ??
    getGlobalConfigPath();
  const globalConfig = options.globalConfigRead
    ? globalConfigFromReadResult(options.globalConfigRead)
    : await loadGlobalConfig(globalConfigPath);
  const effective = checkEffectiveCli({
    projectCli: projectConfig.cli,
    projectConfigPath: configPath,
    globalCli: globalConfig.cli,
    globalConfigPath,
  });
  // Only `ci list-jobs` opts out; it never uses CLI settings.
  const requireCli = options.requireCli !== false;
  if (requireCli && effective.status === 'missing') {
    throw new MissingCliConfigError(configPath, globalConfigPath);
  }
  if (
    requireCli &&
    effective.status === 'resolved' &&
    effective.issues.length > 0
  ) {
    throw new InvalidCliConfigError(effective.source, effective.issues);
  }
  const cliSource =
    effective.status === 'resolved' ? effective.source : undefined;
  // CLI-dependent steps below run only for a required, valid CLI block.
  const enforcedCliSource = requireCli ? cliSource : undefined;
  const effectiveProject = {
    ...projectConfig,
    cli: effective.status === 'resolved' ? effective.cli : {},
  };

  // 2. Extract inline gates from entry_points and normalize arrays to strings.
  const { inlineChecks, inlineReviews, normalizedEntryPoints } =
    extractInlineGates(effectiveProject);
  const normalizedConfig: LoadedProjectConfig = {
    ...effectiveProject,
    entry_points: normalizedEntryPoints,
  };

  // 3. Load checks (file-based + entry-point inline)
  const checks = await loadCheckGates(configDir, inlineChecks);

  // 4. Load reviews (file-based + entry-point inline)
  const reviews = await loadReviewGates(configDir, inlineReviews);

  const reviewerOverride =
    options.applyReviewerOverride && enforcedCliSource
      ? overlayReviewerIfActive(normalizedConfig, reviews)
      : undefined;

  // 5. Merge default CLI preference if not specified
  if (enforcedCliSource) {
    mergeCliPreferences(reviews, normalizedConfig, enforcedCliSource);
  }

  // 6. Validate entry point references
  validateLoadedEntryPoints(normalizedConfig, checks, reviews);

  return {
    project: normalizedConfig,
    globalConfig,
    cliSource,
    checks,
    reviews,
    ...(reviewerOverride ? { reviewerOverride } : {}),
  };
}

function overlayReviewerIfActive(
  project: LoadedProjectConfig,
  reviews: Record<string, LoadedReviewGateConfig>,
) {
  const parsed = parseReviewerOverrideEnv();
  if (!parsed.active) return undefined;
  return applyReviewerOverrideToConfig(project, reviews, parsed);
}

/**
 * Normalise a mixed array of strings and inline-definition objects into
 * a plain string[] of gate names, collecting inline definitions into `out`.
 */
function extractInlineItems<T>(
  items: (string | Record<string, T>)[],
  gateKind: string,
  out: Record<string, T>,
): string[] {
  const names: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      names.push(item);
      continue;
    }
    const entry = Object.entries(item as Record<string, T>)[0];
    if (!entry) {
      throw new Error(
        `${gateKind} inline item must have exactly one key (the gate name)`,
      );
    }
    const [name, config] = entry;
    if (out[name]) {
      throw new Error(
        `${gateKind} "${name}" is defined inline in more than one entry point. Define it once and reference by name in other entry points.`,
      );
    }
    out[name] = config;
    names.push(name);
  }
  return names;
}

/**
 * Walk entry_points, pull out inline check/review objects, and return
 * normalised entry points where each array contains only gate-name strings.
 */
function extractInlineGates(projectConfig: ValidatorConfig): {
  inlineChecks: Record<string, CheckGateConfig>;
  inlineReviews: Record<string, ReviewYamlConfig>;
  normalizedEntryPoints: NormalizedEntryPoint[];
} {
  const inlineChecks: Record<string, CheckGateConfig> = {};
  const inlineReviews: Record<string, ReviewYamlConfig> = {};

  const normalizedEntryPoints = projectConfig.entry_points.map((ep) => ({
    ...ep,
    checks: ep.checks
      ? extractInlineItems(ep.checks, 'Check', inlineChecks)
      : undefined,
    reviews: ep.reviews
      ? extractInlineItems(ep.reviews, 'Review', inlineReviews)
      : undefined,
  }));

  return { inlineChecks, inlineReviews, normalizedEntryPoints };
}

function mergeCliPreferences(
  reviews: Record<string, LoadedReviewGateConfig>,
  projectConfig: LoadedProjectConfig,
  source: CliSource,
): void {
  for (const [name, review] of Object.entries(reviews)) {
    if (review.cli_preference) {
      const allowedTools = new Set(projectConfig.cli.default_preference);
      for (const tool of review.cli_preference) {
        if (!allowedTools.has(tool)) {
          throw new Error(
            `Review "${name}" uses CLI tool "${tool}" which is not in the allowed list (cli.default_preference in ${describeCliSource(source)}).`,
          );
        }
      }
    } else {
      review.cli_preference = projectConfig.cli.default_preference;
    }
  }
}

function validateLoadedEntryPoints(
  projectConfig: NormalizedValidatorConfig,
  checks: Record<string, LoadedCheckGateConfig>,
  reviews: Record<string, LoadedReviewGateConfig>,
): void {
  const checkNames = new Set(Object.keys(checks));
  const reviewNames = new Set(Object.keys(reviews));

  for (const entryPoint of projectConfig.entry_points) {
    validateGateReferences(
      entryPoint.path,
      'check',
      entryPoint.checks,
      checkNames,
    );
    validateGateReferences(
      entryPoint.path,
      'review',
      entryPoint.reviews,
      reviewNames,
    );
  }
}

function validateGateReferences(
  entryPointPath: string,
  gateKind: string,
  references: string[] | undefined,
  knownNames: Set<string>,
): void {
  if (!references) {
    return;
  }
  for (const name of references) {
    if (!knownNames.has(name)) {
      throw new Error(
        `Entry point "${entryPointPath}" references non-existent ${gateKind} gate: "${name}"`,
      );
    }
  }
}

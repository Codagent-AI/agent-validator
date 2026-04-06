import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { loadCheckGates } from './load-checks.js';
import { loadReviewGates } from './load-reviews.js';
import { fileExists } from './loader-utils.js';
import { validatorConfigSchema } from './schema.js';
import type {
  CheckGateConfig,
  LoadedCheckGateConfig,
  LoadedConfig,
  LoadedReviewGateConfig,
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

export async function loadConfig(
  rootDir: string = process.cwd(),
): Promise<LoadedConfig> {
  const configDir = resolveConfigDir(rootDir);
  const configPath = path.join(configDir, CONFIG_FILE);

  // 1. Load project config
  if (!(await fileExists(configPath))) {
    throw new Error(`Configuration file not found at ${configPath}`);
  }

  const configContent = await fs.readFile(configPath, 'utf-8');
  const projectConfigRaw = YAML.parse(configContent);
  const projectConfig = validatorConfigSchema.parse(projectConfigRaw);

  // Infer default_preference from adapter keys when not explicitly set
  if (!projectConfig.cli.default_preference) {
    const adapterKeys = projectConfig.cli.adapters
      ? Object.keys(projectConfig.cli.adapters)
      : [];
    if (adapterKeys.length > 0) {
      projectConfig.cli.default_preference = adapterKeys;
    }
  }

  // 2. Extract inline gates from entry_points and normalize arrays to strings.
  //    After this call, entry_points arrays contain only gate-name strings.
  const { inlineChecks, inlineReviews } = extractInlineGates(projectConfig);
  const normalizedConfig =
    projectConfig as unknown as NormalizedValidatorConfig;

  // 3. Load checks (file-based + entry-point inline)
  const checks = await loadCheckGates(configDir, inlineChecks);

  // 4. Load reviews (file-based + entry-point inline)
  const reviews = await loadReviewGates(configDir, inlineReviews);

  // 5. Merge default CLI preference if not specified
  mergeCliPreferences(reviews, normalizedConfig);

  // 6. Validate entry point references
  validateLoadedEntryPoints(normalizedConfig, checks, reviews);

  return {
    project: normalizedConfig,
    checks,
    reviews,
  };
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
 * Walk entry_points, pull out inline check/review objects, and normalise
 * each array to contain only gate-name strings.  Mutates projectConfig
 * in-place so downstream code sees string-only arrays.
 */
function extractInlineGates(projectConfig: ValidatorConfig): {
  inlineChecks: Record<string, CheckGateConfig>;
  inlineReviews: Record<string, ReviewYamlConfig>;
} {
  const inlineChecks: Record<string, CheckGateConfig> = {};
  const inlineReviews: Record<string, ReviewYamlConfig> = {};

  for (const ep of projectConfig.entry_points) {
    if (ep.checks) {
      (ep as { checks: string[] }).checks = extractInlineItems(
        ep.checks,
        'Check',
        inlineChecks,
      );
    }
    if (ep.reviews) {
      (ep as { reviews: string[] }).reviews = extractInlineItems(
        ep.reviews,
        'Review',
        inlineReviews,
      );
    }
  }

  return { inlineChecks, inlineReviews };
}

function mergeCliPreferences(
  reviews: Record<string, LoadedReviewGateConfig>,
  projectConfig: NormalizedValidatorConfig,
): void {
  for (const [name, review] of Object.entries(reviews)) {
    if (review.cli_preference) {
      const allowedTools = new Set(projectConfig.cli.default_preference);
      for (const tool of review.cli_preference) {
        if (!allowedTools.has(tool)) {
          throw new Error(
            `Review "${name}" uses CLI tool "${tool}" which is not in the project-level allowed list (cli.default_preference).`,
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

// biome-ignore lint/nursery/noExcessiveLinesPerFile: backward-compat config-dir resolution added lines
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { getValidCLITools } from '../cli-adapters/index.js';
import {
  checkGateSchema,
  entryPointSchema,
  validatorConfigSchema,
} from './schema.js';
import type {
  CheckGateConfig,
  EntryPointConfig,
  ReviewPromptFrontmatter,
  ValidatorConfig,
} from './types.js';
import { validateReviewGates } from './validate-reviews.js';

const VALIDATOR_DIR = '.validator';
const LEGACY_GAUNTLET_DIR = '.gauntlet';
const CONFIG_FILE = 'config.yml';
const CHECKS_DIR = 'checks';
const REVIEWS_DIR = 'reviews';

function resolveConfigDir(rootDir: string): string {
  const validatorPath = path.join(rootDir, VALIDATOR_DIR);
  const legacyPath = path.join(rootDir, LEGACY_GAUNTLET_DIR);
  if (existsSync(validatorPath)) return validatorPath;
  if (existsSync(legacyPath)) return legacyPath;
  return validatorPath;
}

export interface ValidationIssue {
  file: string;
  severity: 'error' | 'warning';
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  filesChecked: string[];
}

interface ValidatorContext {
  configDir: string;
  configPath: string;
  issues: ValidationIssue[];
  filesChecked: string[];
}

export async function validateConfig(
  rootDir: string = process.cwd(),
): Promise<ValidationResult> {
  const configDir = resolveConfigDir(rootDir);
  const configPath = path.join(configDir, CONFIG_FILE);
  const ctx: ValidatorContext = {
    configDir,
    configPath,
    issues: [],
    filesChecked: [],
  };

  const projectConfig = await validateProjectConfig(ctx);
  const { existingCheckNames } = await validateCheckGates(ctx);
  const { reviews, reviewSourceFiles, existingReviewNames } =
    await validateReviewGatesWrapper(ctx);

  if (projectConfig?.entry_points) {
    // Collect inline gate names from entry_points so reference validation passes
    collectInlineGateNames(
      projectConfig,
      existingCheckNames,
      existingReviewNames,
    );
    validateEntryPointReferences(
      projectConfig,
      existingCheckNames,
      existingReviewNames,
      ctx,
    );
  }

  if (projectConfig) {
    validateProjectLevelConfig(projectConfig, ctx);
    validateCliConfig(projectConfig, reviews, reviewSourceFiles, ctx);
  }

  const valid = ctx.issues.filter((i) => i.severity === 'error').length === 0;
  return { valid, issues: ctx.issues, filesChecked: ctx.filesChecked };
}

async function validateProjectConfig(
  ctx: ValidatorContext,
): Promise<ValidatorConfig | null> {
  try {
    if (await fileExists(ctx.configPath)) {
      ctx.filesChecked.push(ctx.configPath);
      const configContent = await fs.readFile(ctx.configPath, 'utf-8');
      return parseProjectConfig(configContent, ctx);
    }
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: 'Config file not found',
    });
    return null;
  } catch (error: unknown) {
    const err = error as { message?: string };
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: `Error reading file: ${err.message}`,
    });
    return null;
  }
}

function parseProjectConfig(
  configContent: string,
  ctx: ValidatorContext,
): ValidatorConfig | null {
  try {
    const raw = YAML.parse(configContent);
    return validatorConfigSchema.parse(raw);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      for (const err of error.issues) {
        ctx.issues.push({
          file: ctx.configPath,
          severity: 'error',
          message: err.message,
          field: err.path.join('.'),
        });
      }
    } else {
      pushYamlOrParseError(error, ctx.configPath, ctx.issues);
    }
    return null;
  }
}

async function validateCheckGates(ctx: ValidatorContext): Promise<{
  checks: Record<string, CheckGateConfig>;
  existingCheckNames: Set<string>;
}> {
  const checks: Record<string, CheckGateConfig> = {};
  const existingCheckNames = new Set<string>();
  const checksPath = path.join(ctx.configDir, CHECKS_DIR);

  if (!(await dirExists(checksPath))) {
    return { checks, existingCheckNames };
  }

  try {
    const checkFiles = await fs.readdir(checksPath);
    for (const file of checkFiles) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        await parseCheckFile(file, checksPath, checks, existingCheckNames, ctx);
      }
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    ctx.issues.push({
      file: checksPath,
      severity: 'error',
      message: `Error reading checks directory: ${err.message}`,
    });
  }

  return { checks, existingCheckNames };
}

async function parseCheckFile(
  file: string,
  checksPath: string,
  checks: Record<string, CheckGateConfig>,
  existingCheckNames: Set<string>,
  ctx: ValidatorContext,
): Promise<void> {
  const filePath = path.join(checksPath, file);
  ctx.filesChecked.push(filePath);
  const name = path.basename(file, path.extname(file));
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = YAML.parse(content);
    const parsed = checkGateSchema.parse(raw);
    existingCheckNames.add(name);
    checks[name] = parsed;

    if (!parsed.command || parsed.command.trim() === '') {
      ctx.issues.push({
        file: filePath,
        severity: 'error',
        message: 'command field is required and cannot be empty',
        field: 'command',
      });
    }
  } catch (error: unknown) {
    existingCheckNames.add(name);
    if (error instanceof ZodError) {
      for (const err of error.issues) {
        ctx.issues.push({
          file: filePath,
          severity: 'error',
          message: err.message,
          field: err.path.join('.'),
        });
      }
    } else {
      pushYamlOrParseError(error, filePath, ctx.issues);
    }
  }
}

async function validateReviewGatesWrapper(ctx: ValidatorContext): Promise<{
  reviews: Record<string, ReviewPromptFrontmatter>;
  reviewSourceFiles: Record<string, string>;
  existingReviewNames: Set<string>;
}> {
  const reviewsPath = path.join(ctx.configDir, REVIEWS_DIR);

  if (!(await dirExists(reviewsPath))) {
    return {
      reviews: {},
      reviewSourceFiles: {},
      existingReviewNames: new Set<string>(),
    };
  }

  return validateReviewGates(reviewsPath, ctx.issues, ctx.filesChecked);
}

function addInlineNames(
  items: EntryPointConfig['checks'] | EntryPointConfig['reviews'],
  target: Set<string>,
): void {
  if (!items) return;
  for (const item of items) {
    if (typeof item !== 'string') {
      for (const name of Object.keys(item)) target.add(name);
    }
  }
}

function collectInlineGateNames(
  projectConfig: ValidatorConfig,
  existingCheckNames: Set<string>,
  existingReviewNames: Set<string>,
): void {
  for (const ep of projectConfig.entry_points) {
    addInlineNames(ep.checks, existingCheckNames);
    addInlineNames(ep.reviews, existingReviewNames);
  }
}

function validateEntryPointReferences(
  projectConfig: ValidatorConfig,
  existingCheckNames: Set<string>,
  existingReviewNames: Set<string>,
  ctx: ValidatorContext,
): void {
  for (let i = 0; i < projectConfig.entry_points.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    const entryPoint = projectConfig.entry_points[i]!;
    const entryPointPath = `entry_points[${i}]`;

    validateEntryPointSchema(entryPoint, entryPointPath, ctx);
    validateReferencedChecks(
      entryPoint,
      entryPointPath,
      existingCheckNames,
      ctx,
    );
    validateReferencedReviews(
      entryPoint,
      entryPointPath,
      existingReviewNames,
      ctx,
    );
    validateEntryPointHasGates(entryPoint, entryPointPath, ctx);
    validateEntryPointPathField(entryPoint, entryPointPath, ctx);
  }
}

/** Extract gate name from a union item (string or single-key object). */
function gateItemName(item: string | Record<string, unknown>): string {
  if (typeof item === 'string') return item;
  const keys = Object.keys(item);
  if (keys.length !== 1) {
    throw new Error(
      `Inline gate item must have exactly one key, got ${keys.length}`,
    );
  }
  return keys[0] as string;
}

function validateEntryPointSchema(
  entryPoint: EntryPointConfig,
  entryPointPath: string,
  ctx: ValidatorContext,
): void {
  try {
    entryPointSchema.parse(entryPoint);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      for (const err of error.issues) {
        ctx.issues.push({
          file: ctx.configPath,
          severity: 'error',
          message: err.message,
          field: `${entryPointPath}.${err.path.join('.')}`,
        });
      }
    }
  }
}

function validateReferencedChecks(
  entryPoint: EntryPointConfig,
  entryPointPath: string,
  existingCheckNames: Set<string>,
  ctx: ValidatorContext,
): void {
  if (!entryPoint.checks) {
    return;
  }
  for (const item of entryPoint.checks) {
    const checkName = gateItemName(item);
    if (!existingCheckNames.has(checkName)) {
      ctx.issues.push({
        file: ctx.configPath,
        severity: 'error',
        message: `Entry point references non-existent check gate: "${checkName}"`,
        field: `${entryPointPath}.checks`,
      });
    }
  }
}

function validateReferencedReviews(
  entryPoint: EntryPointConfig,
  entryPointPath: string,
  existingReviewNames: Set<string>,
  ctx: ValidatorContext,
): void {
  if (!entryPoint.reviews) {
    return;
  }
  for (const item of entryPoint.reviews) {
    const reviewName = gateItemName(item);
    if (!existingReviewNames.has(reviewName)) {
      ctx.issues.push({
        file: ctx.configPath,
        severity: 'error',
        message: `Entry point references non-existent review gate: "${reviewName}"`,
        field: `${entryPointPath}.reviews`,
      });
    }
  }
}

function validateEntryPointHasGates(
  entryPoint: EntryPointConfig,
  entryPointPath: string,
  ctx: ValidatorContext,
): void {
  if (
    (!entryPoint.checks || entryPoint.checks.length === 0) &&
    (!entryPoint.reviews || entryPoint.reviews.length === 0)
  ) {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'warning',
      message: `Entry point at "${entryPoint.path}" has no checks or reviews configured`,
      field: `${entryPointPath}`,
    });
  }
}

function validateEntryPointPathField(
  entryPoint: { path: string },
  entryPointPath: string,
  ctx: ValidatorContext,
): void {
  if (!entryPoint.path || entryPoint.path.trim() === '') {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: 'Entry point path cannot be empty',
      field: `${entryPointPath}.path`,
    });
  }
}

function validateProjectLevelConfig(
  projectConfig: ValidatorConfig,
  ctx: ValidatorContext,
): void {
  if (
    projectConfig.log_dir !== undefined &&
    projectConfig.log_dir.trim() === ''
  ) {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: 'log_dir cannot be empty',
      field: 'log_dir',
    });
  }

  if (
    projectConfig.base_branch !== undefined &&
    projectConfig.base_branch.trim() === ''
  ) {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: 'base_branch cannot be empty',
      field: 'base_branch',
    });
  }

  if (
    projectConfig.entry_points === undefined ||
    projectConfig.entry_points.length === 0
  ) {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message: 'entry_points is required and cannot be empty',
      field: 'entry_points',
    });
  }
}

function validateCliConfig(
  projectConfig: ValidatorConfig,
  reviews: Record<string, ReviewPromptFrontmatter>,
  reviewSourceFiles: Record<string, string>,
  ctx: ValidatorContext,
): void {
  if (!projectConfig.cli) {
    return;
  }

  // Infer default_preference from adapter keys when not explicitly set
  const defaults =
    projectConfig.cli.default_preference ??
    (projectConfig.cli.adapters
      ? Object.keys(projectConfig.cli.adapters)
      : undefined);
  if (!(defaults && Array.isArray(defaults)) || defaults.length === 0) {
    ctx.issues.push({
      file: ctx.configPath,
      severity: 'error',
      message:
        'cli.default_preference is required when multiple adapters are configured (or set cli.adapters with at least one entry)',
      field: 'cli.default_preference',
    });
    return;
  }

  validateDefaultPreferenceTools(defaults, ctx);
  validateReviewPreferencesAgainstDefaults(
    defaults,
    reviews,
    reviewSourceFiles,
    ctx,
  );
}

function validateDefaultPreferenceTools(
  defaults: string[],
  ctx: ValidatorContext,
): void {
  for (let i = 0; i < defaults.length; i++) {
    const toolName = defaults[i] as string;
    if (!getValidCLITools().includes(toolName)) {
      ctx.issues.push({
        file: ctx.configPath,
        severity: 'error',
        message: `Invalid CLI tool "${toolName}" in default_preference. Valid options are: ${getValidCLITools().join(', ')}`,
        field: `cli.default_preference[${i}]`,
      });
    }
  }
}

function validateReviewPreferencesAgainstDefaults(
  defaults: string[],
  reviews: Record<string, ReviewPromptFrontmatter>,
  reviewSourceFiles: Record<string, string>,
  ctx: ValidatorContext,
): void {
  const reviewsPath = path.join(ctx.configDir, REVIEWS_DIR);
  const allowedTools = new Set(defaults);
  for (const [reviewName, reviewConfig] of Object.entries(reviews)) {
    const pref = reviewConfig.cli_preference;
    if (pref && Array.isArray(pref)) {
      const reviewFile =
        reviewSourceFiles[reviewName] ||
        path.join(reviewsPath, `${reviewName}.md`);
      for (let i = 0; i < pref.length; i++) {
        const tool = pref[i] as string;
        if (!allowedTools.has(tool)) {
          ctx.issues.push({
            file: reviewFile,
            severity: 'error',
            message: `CLI tool "${tool}" is not in project-level default_preference. Review gates can only use tools enabled in config.yml`,
            field: `cli_preference[${i}]`,
          });
        }
      }
    }
  }
}

function pushYamlOrParseError(
  error: unknown,
  filePath: string,
  issues: ValidationIssue[],
): void {
  const err = error as { name?: string; message?: string };
  const isYaml =
    err.name === 'YAMLSyntaxError' || err.message?.includes('YAML');
  issues.push({
    file: filePath,
    severity: 'error',
    message: isYaml
      ? `Malformed YAML: ${err.message}`
      : `Parse error: ${err.message}`,
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((s) => s.isFile())
    .catch(() => false);
}

async function dirExists(dirPath: string): Promise<boolean> {
  return fs
    .stat(dirPath)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

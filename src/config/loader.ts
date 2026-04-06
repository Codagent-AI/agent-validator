import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import {
  isBuiltInReview,
  loadBuiltInReview,
} from '../built-in-reviews/index.js';
import {
  checkGateSchema,
  reviewPromptFrontmatterSchema,
  reviewYamlSchema,
  validatorConfigSchema,
} from './schema.js';
import type {
  CheckGateConfig,
  LoadedCheckGateConfig,
  LoadedConfig,
  LoadedReviewGateConfig,
  ReviewYamlConfig,
  ValidatorConfig,
} from './types.js';

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

  // 2. Load checks (file-based + inline)
  const checks = await loadCheckGates(configDir, projectConfig.checks);

  // 3. Load reviews (file-based + inline)
  const reviews = await loadReviewGates(configDir, projectConfig.reviews);

  // 3b. Merge default CLI preference if not specified
  mergeCliPreferences(reviews, projectConfig);

  // 4. Validate entry point references
  validateLoadedEntryPoints(projectConfig, checks, reviews);

  return {
    project: projectConfig,
    checks,
    reviews,
  };
}

async function buildLoadedCheck(
  name: string,
  parsed: CheckGateConfig,
  configDir: string,
): Promise<LoadedCheckGateConfig> {
  const fixFile = parsed.fix_instructions_file || parsed.fix_instructions;
  const loadedCheck: LoadedCheckGateConfig = { ...parsed, name };

  if (fixFile) {
    loadedCheck.fixInstructionsContent = await loadPromptFile(
      fixFile,
      configDir,
      `check "${name}"`,
    );
  }
  if (parsed.fix_with_skill) {
    loadedCheck.fixWithSkill = parsed.fix_with_skill;
  }
  return loadedCheck;
}

async function loadCheckGates(
  configDir: string,
  inlineChecks?: Record<string, CheckGateConfig>,
): Promise<Record<string, LoadedCheckGateConfig>> {
  const checksPath = path.join(configDir, CHECKS_DIR);
  const checks: Record<string, LoadedCheckGateConfig> = {};

  // Load file-based checks
  if (await dirExists(checksPath)) {
    const checkFiles = await fs.readdir(checksPath);
    for (const file of checkFiles) {
      if (!(file.endsWith('.yml') || file.endsWith('.yaml'))) {
        continue;
      }
      const filePath = path.join(checksPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const raw = YAML.parse(content);
      const name = path.basename(file, path.extname(file));
      const parsed: CheckGateConfig = checkGateSchema.parse(raw);
      checks[name] = await buildLoadedCheck(name, parsed, configDir);
    }
  }

  // Merge inline checks
  if (inlineChecks) {
    for (const [name, parsed] of Object.entries(inlineChecks)) {
      if (checks[name]) {
        throw new Error(
          `Check "${name}" is defined both inline in config.yml and as a file in ${CHECKS_DIR}/. Remove one to resolve the conflict.`,
        );
      }
      checks[name] = await buildLoadedCheck(name, parsed, configDir);
    }
  }

  return checks;
}

async function buildInlineReview(
  name: string,
  parsed: ReviewYamlConfig,
  configDir: string,
): Promise<LoadedReviewGateConfig> {
  const review: LoadedReviewGateConfig = {
    name,
    prompt: 'inline',
    model: parsed.model,
    cli_preference: parsed.cli_preference,
    num_reviews: parsed.num_reviews,
    parallel: parsed.parallel,
    run_in_ci: parsed.run_in_ci,
    run_locally: parsed.run_locally,
    timeout: parsed.timeout,
    enabled: parsed.enabled,
  };

  if (parsed.prompt_file) {
    review.promptContent = await loadPromptFile(
      parsed.prompt_file,
      configDir,
      `review "${name}"`,
    );
  }
  if (parsed.skill_name) {
    review.skillName = parsed.skill_name;
  }
  if (parsed.builtin) {
    review.promptContent = loadBuiltInReview(parsed.builtin);
  }
  return review;
}

async function loadFileBasedReviews(
  configDir: string,
): Promise<Record<string, LoadedReviewGateConfig>> {
  const reviewsPath = path.join(configDir, REVIEWS_DIR);
  const reviews: Record<string, LoadedReviewGateConfig> = {};

  if (!(await dirExists(reviewsPath))) {
    return reviews;
  }

  const reviewFiles = await fs.readdir(reviewsPath);
  detectDuplicateReviewNames(reviewFiles);

  for (const file of reviewFiles) {
    if (file.endsWith('.md')) {
      reviews[path.basename(file, '.md')] = await loadMarkdownReview(
        file,
        reviewsPath,
        configDir,
      );
    } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      reviews[path.basename(file, path.extname(file))] = await loadYamlReview(
        file,
        reviewsPath,
        configDir,
      );
    }
  }

  return reviews;
}

async function loadReviewGates(
  configDir: string,
  inlineReviews?: Record<string, ReviewYamlConfig>,
): Promise<Record<string, LoadedReviewGateConfig>> {
  const reviews = await loadFileBasedReviews(configDir);

  if (inlineReviews) {
    for (const [name, parsed] of Object.entries(inlineReviews)) {
      if (reviews[name]) {
        throw new Error(
          `Review "${name}" is defined both inline in config.yml and as a file in ${REVIEWS_DIR}/. Remove one to resolve the conflict.`,
        );
      }
      reviews[name] = await buildInlineReview(name, parsed, configDir);
    }
  }

  return reviews;
}

function detectDuplicateReviewNames(reviewFiles: string[]): void {
  const reviewNameSources = new Map<string, string[]>();
  for (const file of reviewFiles) {
    if (
      !(file.endsWith('.md') || file.endsWith('.yml') || file.endsWith('.yaml'))
    ) {
      continue;
    }

    const name = path.basename(file, path.extname(file));

    // Reject user-defined review files with the reserved built-in: prefix
    if (isBuiltInReview(name)) {
      throw new Error(
        `Review file "${file}" uses the reserved "built-in:" prefix. Rename the file to avoid conflicts with built-in reviews.`,
      );
    }

    const sources = reviewNameSources.get(name) || [];
    sources.push(file);
    reviewNameSources.set(name, sources);
  }

  for (const [name, sources] of reviewNameSources) {
    if (sources.length > 1) {
      throw new Error(
        `Duplicate review name "${name}" found across files: ${sources.join(', ')}. Each review name must be unique.`,
      );
    }
  }
}

async function loadMarkdownReview(
  file: string,
  reviewsPath: string,
  configDir: string,
): Promise<LoadedReviewGateConfig> {
  const filePath = path.join(reviewsPath, file);
  const content = await fs.readFile(filePath, 'utf-8');
  const { data: frontmatter, content: promptBody } = matter(content);

  const parsedFrontmatter = reviewPromptFrontmatterSchema.parse(frontmatter);
  const name = path.basename(file, '.md');

  const review: LoadedReviewGateConfig = {
    name,
    prompt: file,
    promptContent: promptBody,
    model: parsedFrontmatter.model,
    cli_preference: parsedFrontmatter.cli_preference,
    num_reviews: parsedFrontmatter.num_reviews,
    parallel: parsedFrontmatter.parallel,
    run_in_ci: parsedFrontmatter.run_in_ci,
    run_locally: parsedFrontmatter.run_locally,
    timeout: parsedFrontmatter.timeout,
    enabled: parsedFrontmatter.enabled,
  };

  // If prompt_file is specified, override the markdown body
  if (parsedFrontmatter.prompt_file) {
    review.promptContent = await loadPromptFile(
      parsedFrontmatter.prompt_file,
      configDir,
      `review "${name}"`,
    );
  }

  // If skill_name is specified, ignore body and set skillName
  if (parsedFrontmatter.skill_name) {
    review.promptContent = undefined;
    review.skillName = parsedFrontmatter.skill_name;
  }

  return review;
}

async function loadYamlReview(
  file: string,
  reviewsPath: string,
  configDir: string,
): Promise<LoadedReviewGateConfig> {
  const filePath = path.join(reviewsPath, file);
  const content = await fs.readFile(filePath, 'utf-8');
  const raw = YAML.parse(content);
  const parsed = reviewYamlSchema.parse(raw);
  const name = path.basename(file, path.extname(file));

  const review: LoadedReviewGateConfig = {
    name,
    prompt: file,
    model: parsed.model,
    cli_preference: parsed.cli_preference,
    num_reviews: parsed.num_reviews,
    parallel: parsed.parallel,
    run_in_ci: parsed.run_in_ci,
    run_locally: parsed.run_locally,
    timeout: parsed.timeout,
    enabled: parsed.enabled,
  };

  if (parsed.prompt_file) {
    review.promptContent = await loadPromptFile(
      parsed.prompt_file,
      configDir,
      `review "${name}"`,
    );
  }

  if (parsed.skill_name) {
    review.skillName = parsed.skill_name;
  }

  if (parsed.builtin) {
    review.promptContent = loadBuiltInReview(parsed.builtin);
  }

  return review;
}

function mergeCliPreferences(
  reviews: Record<string, LoadedReviewGateConfig>,
  projectConfig: ValidatorConfig,
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
  projectConfig: ValidatorConfig,
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

async function loadPromptFile(
  filePath: string,
  configDir: string,
  source: string,
): Promise<string> {
  let resolvedPath: string;
  if (path.isAbsolute(filePath)) {
    console.warn(
      `Warning: ${source} uses absolute path "${filePath}". Prefer relative paths for portability.`,
    );
    resolvedPath = filePath;
  } else {
    resolvedPath = path.resolve(configDir, filePath);
  }
  // Warn if resolved path escapes the config directory (including via relative traversal)
  const normalizedConfigDir = path.resolve(configDir);
  const relativeToConfigDir = path.relative(normalizedConfigDir, resolvedPath);
  if (
    relativeToConfigDir.startsWith('..') ||
    path.isAbsolute(relativeToConfigDir)
  ) {
    console.warn(
      `Warning: ${source} references file outside config directory: "${filePath}" (resolves to ${resolvedPath}). Review config changes carefully in PRs.`,
    );
  }
  if (!(await fileExists(resolvedPath))) {
    throw new Error(
      `File not found: ${resolvedPath} (referenced by ${source})`,
    );
  }
  return fs.readFile(resolvedPath, 'utf-8');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

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
  gauntletConfigSchema,
  reviewPromptFrontmatterSchema,
  reviewYamlSchema,
} from './schema.js';
import type {
  CheckGateConfig,
  GauntletConfig,
  LoadedCheckGateConfig,
  LoadedConfig,
  LoadedReviewGateConfig,
} from './types.js';

const GAUNTLET_DIR = '.gauntlet';
const CONFIG_FILE = 'config.yml';
const CHECKS_DIR = 'checks';
const REVIEWS_DIR = 'reviews';

export async function loadConfig(
  rootDir: string = process.cwd(),
): Promise<LoadedConfig> {
  const gauntletPath = path.join(rootDir, GAUNTLET_DIR);
  const configPath = path.join(gauntletPath, CONFIG_FILE);

  // 1. Load project config
  if (!(await fileExists(configPath))) {
    throw new Error(`Configuration file not found at ${configPath}`);
  }

  const configContent = await fs.readFile(configPath, 'utf-8');
  const projectConfigRaw = YAML.parse(configContent);
  const projectConfig = gauntletConfigSchema.parse(projectConfigRaw);

  // 2. Load checks
  const checks = await loadCheckGates(gauntletPath);

  // 3. Load reviews
  const reviews = await loadReviewGates(gauntletPath);

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

async function loadCheckGates(
  gauntletPath: string,
): Promise<Record<string, LoadedCheckGateConfig>> {
  const checksPath = path.join(gauntletPath, CHECKS_DIR);
  const checks: Record<string, LoadedCheckGateConfig> = {};

  if (!(await dirExists(checksPath))) {
    return checks;
  }

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

    // Normalize deprecated alias in loader (not schema) for reliability
    const fixFile = parsed.fix_instructions_file || parsed.fix_instructions;

    const loadedCheck: LoadedCheckGateConfig = {
      ...parsed,
      name,
    };

    // Load fix instructions file if specified
    if (fixFile) {
      loadedCheck.fixInstructionsContent = await loadPromptFile(
        fixFile,
        gauntletPath,
        `check "${name}"`,
      );
    }

    // Store fix_with_skill if specified
    if (parsed.fix_with_skill) {
      loadedCheck.fixWithSkill = parsed.fix_with_skill;
    }

    checks[name] = loadedCheck;
  }

  return checks;
}

async function loadReviewGates(
  gauntletPath: string,
): Promise<Record<string, LoadedReviewGateConfig>> {
  const reviewsPath = path.join(gauntletPath, REVIEWS_DIR);
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
        gauntletPath,
      );
    } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      reviews[path.basename(file, path.extname(file))] = await loadYamlReview(
        file,
        reviewsPath,
        gauntletPath,
      );
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
  gauntletPath: string,
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
      gauntletPath,
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
  gauntletPath: string,
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
      gauntletPath,
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
  projectConfig: GauntletConfig,
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
  projectConfig: GauntletConfig,
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
  gauntletPath: string,
  source: string,
): Promise<string> {
  let resolvedPath: string;
  if (path.isAbsolute(filePath)) {
    console.warn(
      `Warning: ${source} uses absolute path "${filePath}". Prefer relative paths for portability.`,
    );
    resolvedPath = filePath;
  } else {
    resolvedPath = path.resolve(gauntletPath, filePath);
  }
  // Warn if resolved path escapes the .gauntlet/ directory (including via relative traversal)
  const normalizedGauntletPath = path.resolve(gauntletPath);
  const relativeToDotGauntlet = path.relative(
    normalizedGauntletPath,
    resolvedPath,
  );
  if (
    relativeToDotGauntlet.startsWith('..') ||
    path.isAbsolute(relativeToDotGauntlet)
  ) {
    console.warn(
      `Warning: ${source} references file outside .gauntlet/ directory: "${filePath}" (resolves to ${resolvedPath}). Review .gauntlet/ config changes carefully in PRs.`,
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

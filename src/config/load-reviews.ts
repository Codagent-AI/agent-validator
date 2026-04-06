import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import {
  isBuiltInReview,
  loadBuiltInReview,
} from '../built-in-reviews/index.js';
import { dirExists, loadPromptFile } from './loader-utils.js';
import { reviewPromptFrontmatterSchema, reviewYamlSchema } from './schema.js';
import type { LoadedReviewGateConfig, ReviewYamlConfig } from './types.js';

const REVIEWS_DIR = 'reviews';

async function buildReviewFromYaml(
  name: string,
  parsed: ReviewYamlConfig,
  configDir: string,
  source: string,
): Promise<LoadedReviewGateConfig> {
  const review: LoadedReviewGateConfig = {
    name,
    prompt: source,
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
  if (parsed.skill_name) review.skillName = parsed.skill_name;
  if (parsed.builtin) review.promptContent = loadBuiltInReview(parsed.builtin);
  return review;
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
  return buildReviewFromYaml(name, parsed, configDir, file);
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

export async function loadReviewGates(
  configDir: string,
  inlineReviews?: Record<string, ReviewYamlConfig>,
): Promise<Record<string, LoadedReviewGateConfig>> {
  const reviews = await loadFileBasedReviews(configDir);

  if (inlineReviews) {
    for (const [name, parsed] of Object.entries(inlineReviews)) {
      if (reviews[name]) {
        throw new Error(
          `Review "${name}" is defined both inline in an entry point and as a file in ${REVIEWS_DIR}/. Remove one to resolve the conflict.`,
        );
      }
      reviews[name] = await buildReviewFromYaml(
        name,
        parsed,
        configDir,
        'inline',
      );
    }
  }

  return reviews;
}

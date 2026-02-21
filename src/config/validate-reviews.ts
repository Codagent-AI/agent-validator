import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { getValidCLITools } from '../cli-adapters/index.js';
import { reviewPromptFrontmatterSchema, reviewYamlSchema } from './schema.js';
import type { ReviewPromptFrontmatter } from './types.js';
import type { ValidationIssue } from './validator.js';

export interface ReviewValidationResult {
  reviews: Record<string, ReviewPromptFrontmatter>;
  reviewSourceFiles: Record<string, string>;
  existingReviewNames: Set<string>;
}

export async function validateReviewGates(
  reviewsPath: string,
  issues: ValidationIssue[],
  filesChecked: string[],
): Promise<ReviewValidationResult> {
  const reviews: Record<string, ReviewPromptFrontmatter> = {};
  const reviewSourceFiles: Record<string, string> = {};
  const existingReviewNames = new Set<string>();

  try {
    const reviewFiles = await fs.readdir(reviewsPath);

    detectDuplicateReviewNames(reviewFiles, reviewsPath, issues);

    for (const file of reviewFiles) {
      if (file.endsWith('.md')) {
        validateMarkdownReview(
          file,
          reviewsPath,
          reviews,
          reviewSourceFiles,
          existingReviewNames,
          issues,
          filesChecked,
        );
      } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        validateYamlReview(
          file,
          reviewsPath,
          reviews,
          reviewSourceFiles,
          existingReviewNames,
          issues,
          filesChecked,
        );
      }
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    issues.push({
      file: reviewsPath,
      severity: 'error',
      message: `Error reading reviews directory: ${
        err.message || String(error)
      }`,
    });
  }

  return { reviews, reviewSourceFiles, existingReviewNames };
}

function detectDuplicateReviewNames(
  reviewFiles: string[],
  reviewsPath: string,
  issues: ValidationIssue[],
): void {
  const reviewNameSources = new Map<string, string[]>();
  for (const file of reviewFiles) {
    if (
      file.endsWith('.md') ||
      file.endsWith('.yml') ||
      file.endsWith('.yaml')
    ) {
      const name = path.basename(file, path.extname(file));
      const sources = reviewNameSources.get(name) || [];
      sources.push(file);
      reviewNameSources.set(name, sources);
    }
  }
  for (const [name, sources] of reviewNameSources) {
    if (sources.length > 1) {
      issues.push({
        file: reviewsPath,
        severity: 'error',
        message: `Duplicate review name "${name}" found across files: ${sources.join(', ')}`,
      });
    }
  }
}

async function validateMarkdownReview(
  file: string,
  reviewsPath: string,
  reviews: Record<string, ReviewPromptFrontmatter>,
  reviewSourceFiles: Record<string, string>,
  existingReviewNames: Set<string>,
  issues: ValidationIssue[],
  filesChecked: string[],
): Promise<void> {
  const filePath = path.join(reviewsPath, file);
  const reviewName = path.basename(file, '.md');
  existingReviewNames.add(reviewName);
  filesChecked.push(filePath);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data: frontmatter, content: _promptBody } = matter(content);

    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      issues.push({
        file: filePath,
        severity: 'error',
        message: 'Review gate must have YAML frontmatter',
      });
      return;
    }

    validateCliPreferenceTools(frontmatter, filePath, issues);

    const parsedFrontmatter = reviewPromptFrontmatterSchema.parse(frontmatter);
    const name = path.basename(file, '.md');
    reviews[name] = parsedFrontmatter;
    reviewSourceFiles[name] = filePath;

    validateReviewSemantics(parsedFrontmatter, filePath, issues);
  } catch (error: unknown) {
    handleReviewValidationError(error, filePath, issues);
  }
}

async function validateYamlReview(
  file: string,
  reviewsPath: string,
  reviews: Record<string, ReviewPromptFrontmatter>,
  reviewSourceFiles: Record<string, string>,
  existingReviewNames: Set<string>,
  issues: ValidationIssue[],
  filesChecked: string[],
): Promise<void> {
  const filePath = path.join(reviewsPath, file);
  const reviewName = path.basename(file, path.extname(file));
  existingReviewNames.add(reviewName);
  filesChecked.push(filePath);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = YAML.parse(content);

    validateCliPreferenceTools(raw, filePath, issues);

    const parsed = reviewYamlSchema.parse(raw);
    reviews[reviewName] = parsed;
    reviewSourceFiles[reviewName] = filePath;

    validateReviewSemantics(parsed, filePath, issues);
  } catch (error: unknown) {
    handleReviewValidationError(error, filePath, issues);
  }
}

export function validateCliPreferenceTools(
  data: Record<string, unknown>,
  filePath: string,
  issues: ValidationIssue[],
): void {
  if (data.cli_preference && Array.isArray(data.cli_preference)) {
    for (let i = 0; i < data.cli_preference.length; i++) {
      const toolName = data.cli_preference[i];
      if (
        typeof toolName === 'string' &&
        !getValidCLITools().includes(toolName)
      ) {
        issues.push({
          file: filePath,
          severity: 'error',
          message: `Invalid CLI tool "${toolName}" in cli_preference. Valid options are: ${getValidCLITools().join(', ')}`,
          field: `cli_preference[${i}]`,
        });
      }
    }
  }
}

export function validateReviewSemantics(
  parsed: { cli_preference?: string[]; num_reviews?: number; timeout?: number },
  filePath: string,
  issues: ValidationIssue[],
): void {
  if (parsed.cli_preference !== undefined) {
    validateReviewCliPreference(parsed.cli_preference, filePath, issues);
  }

  if (parsed.num_reviews !== undefined && parsed.num_reviews < 1) {
    issues.push({
      file: filePath,
      severity: 'error',
      message: 'num_reviews must be at least 1',
      field: 'num_reviews',
    });
  }

  if (parsed.timeout !== undefined && parsed.timeout <= 0) {
    issues.push({
      file: filePath,
      severity: 'error',
      message: 'timeout must be greater than 0',
      field: 'timeout',
    });
  }
}

function validateReviewCliPreference(
  cliPreference: string[],
  filePath: string,
  issues: ValidationIssue[],
): void {
  if (cliPreference.length === 0) {
    issues.push({
      file: filePath,
      severity: 'error',
      message:
        'cli_preference if provided cannot be an empty array. Remove it to use defaults.',
      field: 'cli_preference',
    });
    return;
  }
  for (let i = 0; i < cliPreference.length; i++) {
    const toolName = cliPreference[i] as string;
    if (!getValidCLITools().includes(toolName)) {
      issues.push({
        file: filePath,
        severity: 'error',
        message: `Invalid CLI tool "${toolName}" in cli_preference. Valid options are: ${getValidCLITools().join(', ')}`,
        field: `cli_preference[${i}]`,
      });
    }
  }
}

export function handleReviewValidationError(
  error: unknown,
  filePath: string,
  issues: ValidationIssue[],
): void {
  if (error instanceof ZodError) {
    pushZodIssues(error, filePath, issues);
    return;
  }
  const err = error as { name?: string; message?: string };
  if (err.name === 'YAMLSyntaxError' || err.message?.includes('YAML')) {
    issues.push({
      file: filePath,
      severity: 'error',
      message: `Malformed YAML: ${err.message || 'Unknown YAML error'}`,
    });
    return;
  }
  pushGenericError(err, error, filePath, issues);
}

function pushZodIssues(
  error: ZodError,
  filePath: string,
  issues: ValidationIssue[],
): void {
  for (const err of error.issues) {
    const fieldPath =
      err.path && Array.isArray(err.path) ? err.path.join('.') : undefined;
    const message = err.message || `Invalid value for ${fieldPath || 'field'}`;
    issues.push({
      file: filePath,
      severity: 'error',
      message,
      field: fieldPath,
    });
  }
}

function pushGenericError(
  err: { name?: string; message?: string },
  error: unknown,
  filePath: string,
  issues: ValidationIssue[],
): void {
  const errorMessage = err.message || String(error);
  try {
    const parsed = JSON.parse(errorMessage);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const fieldPath =
          item.path && Array.isArray(item.path)
            ? item.path.join('.')
            : undefined;
        issues.push({
          file: filePath,
          severity: 'error',
          message: item.message || `Invalid value for ${fieldPath || 'field'}`,
          field: fieldPath,
        });
      }
      return;
    }
    issues.push({
      file: filePath,
      severity: 'error',
      message: errorMessage,
    });
  } catch {
    issues.push({
      file: filePath,
      severity: 'error',
      message: errorMessage,
    });
  }
}

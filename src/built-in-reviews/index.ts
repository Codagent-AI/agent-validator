// @ts-expect-error Bun text import
import allReviewersContent from './all-reviewers.md' with { type: 'text' };
// @ts-expect-error Bun text import
import codeQualityContent from './code-quality.md' with { type: 'text' };
// @ts-expect-error Bun text import
import errorHandlingContent from './error-handling.md' with { type: 'text' };
// @ts-expect-error Bun text import
import securityContent from './security.md' with { type: 'text' };
// @ts-expect-error Bun text import
import securityAndErrorsContent from './security-and-errors.md' with {
  type: 'text',
};

const BUILT_IN_PREFIX = 'built-in:';

/** Primary built-in reviews offered during `init`. */
const primaryBuiltIns: Record<string, string> = {
  'code-quality': codeQualityContent,
  security: securityContent,
  'error-handling': errorHandlingContent,
};

/** Combined built-in reviews (aggregates of primary reviews). */
const combinedBuiltIns: Record<string, string> = {
  'all-reviewers': allReviewersContent,
  'security-and-errors': securityAndErrorsContent,
};

const builtInSources: Record<string, string> = {
  ...primaryBuiltIns,
  ...combinedBuiltIns,
};

/**
 * Return the names of primary built-in reviews (for init prompts).
 */
export function getBuiltInReviewNames(): string[] {
  return Object.keys(primaryBuiltIns);
}

/**
 * Check if a review name uses the built-in prefix.
 */
export function isBuiltInReview(name: string): boolean {
  return name.startsWith(BUILT_IN_PREFIX);
}

/**
 * Load a built-in review prompt by name. Returns the raw markdown content.
 */
export function loadBuiltInReview(name: string): string {
  const source = builtInSources[name];

  if (!source) {
    throw new Error(`Unknown built-in review: "${name}"`);
  }

  return source;
}

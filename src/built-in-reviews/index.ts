// @ts-expect-error Bun text import
import codeQualityContent from './code-quality.md' with { type: 'text' };
// @ts-expect-error Bun text import
import errorHandlingContent from './error-handling.md' with { type: 'text' };
// @ts-expect-error Bun text import
import securityContent from './security.md' with { type: 'text' };
// @ts-expect-error Bun text import
import taskComplianceContent from './task-compliance.md' with { type: 'text' };

const BUILT_IN_PREFIX = 'built-in:';

/** Primary built-in reviews offered during `init`. */
const primaryBuiltIns: Record<string, string> = {
  'code-quality': codeQualityContent,
  security: securityContent,
  'error-handling': errorHandlingContent,
};

/** Opt-in built-in reviews (not offered during init, activated via --enable-review). */
const optInBuiltIns: Record<string, string> = {
  'task-compliance': taskComplianceContent,
};

/** Definitions for combined reviews: which primaries to concatenate. */
const combinedDefinitions: Record<string, string[]> = {
  'security-and-errors': ['security', 'error-handling'],
  'all-reviewers': ['code-quality', 'security', 'error-handling'],
};

/** Combined built-in reviews built at runtime from primaries. */
const combinedBuiltIns: Record<string, string> = Object.fromEntries(
  Object.entries(combinedDefinitions).map(([name, primaries]) => [
    name,
    primaries.map((key) => primaryBuiltIns[key]).join('\n\n---\n\n'),
  ]),
);

const builtInSources: Record<string, string> = {
  ...primaryBuiltIns,
  ...optInBuiltIns,
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

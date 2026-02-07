// @ts-expect-error Bun text import
import codeQualityContent from "./code-quality.md" with { type: "text" };

const BUILT_IN_PREFIX = "built-in:";

const builtInSources: Record<string, string> = {
	"code-quality": codeQualityContent,
};

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

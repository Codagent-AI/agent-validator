import matter from "gray-matter";
import { reviewPromptFrontmatterSchema } from "../config/schema.js";
import type { LoadedReviewGateConfig } from "../config/types.js";

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
 * Extract the review name from a built-in reference (e.g., "code-quality" from "built-in:code-quality").
 */
export function getBuiltInReviewName(fullName: string): string {
	if (!fullName.startsWith(BUILT_IN_PREFIX)) {
		throw new Error(
			`Invalid built-in review reference: "${fullName}" (must start with "${BUILT_IN_PREFIX}")`,
		);
	}
	return fullName.slice(BUILT_IN_PREFIX.length);
}

/**
 * Load a built-in review by its full name (e.g., "built-in:code-quality").
 * Parses the bundled markdown with gray-matter, validates frontmatter, and returns a LoadedReviewGateConfig.
 */
export function loadBuiltInReview(fullName: string): LoadedReviewGateConfig {
	const shortName = getBuiltInReviewName(fullName);
	const source = builtInSources[shortName];

	if (!source) {
		throw new Error(`Unknown built-in review: "${shortName}"`);
	}

	const { data: frontmatter, content: promptBody } = matter(source);
	const parsed = reviewPromptFrontmatterSchema.parse(frontmatter);

	return {
		name: fullName,
		prompt: fullName,
		promptContent: promptBody,
		model: parsed.model,
		cli_preference: parsed.cli_preference,
		num_reviews: parsed.num_reviews,
		parallel: parsed.parallel,
		run_in_ci: parsed.run_in_ci,
		run_locally: parsed.run_locally,
		timeout: parsed.timeout,
		isBuiltIn: true,
	};
}

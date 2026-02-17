// Tier suffixes to exclude from model resolution
const TIER_SUFFIXES = ["-low", "-high", "-xhigh", "-fast"];

/** Only allow model IDs with alphanumeric chars, hyphens, and dots. */
const SAFE_MODEL_ID = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate that a model ID is safe for shell interpolation.
 * Rejects IDs containing shell metacharacters.
 */
export function isSafeModelId(modelId: string): boolean {
	return SAFE_MODEL_ID.test(modelId);
}

/**
 * Check if a model ID contains the base name as a complete hyphen-delimited segment.
 * e.g. "codex" matches "gpt-5.3-codex" (codex is a segment), but NOT "gpt-5.3-codecx"
 */
export function matchesBaseName(modelId: string, baseName: string): boolean {
	const segments = modelId.split("-");
	return segments.includes(baseName);
}

/**
 * Check if a model ID ends with a tier suffix (-low, -high, -xhigh, -fast).
 */
export function isTierVariant(modelId: string): boolean {
	return TIER_SUFFIXES.some((suffix) => modelId.endsWith(suffix));
}

/**
 * Extract version as [major, minor] from a model ID.
 * Finds the first numeric segment matching X.Y pattern.
 * Returns null if no version found.
 */
export function extractVersion(modelId: string): [number, number] | null {
	const match = modelId.match(/(\d+)\.(\d+)/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2])];
}

/**
 * Apply thinking preference filter to candidate models.
 * When preferThinking is true, narrows to -thinking variants if available.
 * When false, excludes -thinking variants.
 */
function applyThinkingFilter(
	candidates: string[],
	preferThinking: boolean,
): string[] {
	if (preferThinking) {
		const thinking = candidates.filter((id) => id.endsWith("-thinking"));
		return thinking.length > 0 ? thinking : candidates;
	}
	return candidates.filter((id) => !id.endsWith("-thinking"));
}

/** Compare two version tuples descending (higher version first). */
function compareVersionsDesc(
	a: [number, number] | null,
	b: [number, number] | null,
): number {
	if (!a && !b) return 0;
	if (!a) return 1;
	if (!b) return -1;
	if (a[0] !== b[0]) return b[0] - a[0];
	return b[1] - a[1];
}

/**
 * Core model resolution logic shared between adapters.
 * Filters by base name, excludes tier variants, handles thinking preference,
 * sorts by version descending, and returns the best match.
 */
export function resolveModelFromList(
	allModels: string[],
	baseName: string,
	opts: { preferThinking: boolean },
): string | undefined {
	const candidates = allModels
		.filter((id) => matchesBaseName(id, baseName))
		.filter((id) => !isTierVariant(id));

	if (candidates.length === 0) return undefined;

	const filtered = applyThinkingFilter(candidates, opts.preferThinking);
	if (filtered.length === 0) return undefined;

	filtered.sort((a, b) =>
		compareVersionsDesc(extractVersion(a), extractVersion(b)),
	);

	return filtered[0];
}

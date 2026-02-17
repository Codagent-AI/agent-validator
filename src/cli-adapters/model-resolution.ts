// Tier suffixes to exclude from model resolution
const TIER_SUFFIXES = ["-low", "-high", "-xhigh", "-fast"];

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
 * Core model resolution logic shared between adapters.
 * Filters by base name, excludes tier variants, handles thinking preference,
 * sorts by version descending, and returns the best match.
 */
export function resolveModelFromList(
	allModels: string[],
	baseName: string,
	opts: { preferThinking: boolean },
): string | undefined {
	// Filter by base name segment match
	let candidates = allModels.filter((id) => matchesBaseName(id, baseName));

	// Exclude tier variants
	candidates = candidates.filter((id) => !isTierVariant(id));

	if (candidates.length === 0) return undefined;

	if (opts.preferThinking) {
		const thinkingCandidates = candidates.filter((id) =>
			id.endsWith("-thinking"),
		);
		if (thinkingCandidates.length > 0) {
			candidates = thinkingCandidates;
		}
		// If no thinking variants, fall back to non-thinking candidates
	} else {
		// When thinking is not preferred, exclude thinking variants
		candidates = candidates.filter((id) => !id.endsWith("-thinking"));
	}

	if (candidates.length === 0) return undefined;

	// Sort by version descending
	candidates.sort((a, b) => {
		const vA = extractVersion(a);
		const vB = extractVersion(b);
		if (!vA && !vB) return 0;
		if (!vA) return 1;
		if (!vB) return -1;
		if (vA[0] !== vB[0]) return vB[0] - vA[0];
		return vB[1] - vA[1];
	});

	return candidates[0];
}

// Tier suffixes to exclude from model resolution
const TIER_SUFFIXES = ['-low', '-high', '-xhigh', '-fast'];

/** Only allow model IDs starting with an alphanumeric char, followed by alphanumeric, hyphens, or dots. */
export const SAFE_MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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
    const thinking = candidates.filter((id) => id.endsWith('-thinking'));
    return thinking.length > 0 ? thinking : candidates;
  }
  return candidates.filter((id) => !id.endsWith('-thinking'));
}

/** Compare two version tuples descending (higher version first). */
function compareVersionsDesc(
  a: [number, number] | null,
  b: [number, number] | null,
): number {
  if (!(a || b)) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a[0] !== b[0]) return b[0] - a[0];
  return b[1] - a[1];
}

/**
 * Core model resolution logic shared between adapters.
 * Filters by base name segment, excludes tier variants, handles thinking
 * preference, sorts by version descending, and returns the best match.
 */
export function resolveModelFromList(
  allModels: string[],
  opts: { baseName: string; preferThinking: boolean },
): string | undefined {
  // Exact model IDs (e.g. `composer-2`) return as-is; preferThinking only applies
  // when resolving a base segment like `opus` to `-thinking` variants, not for full IDs.
  if (allModels.includes(opts.baseName)) {
    return opts.baseName;
  }

  const candidates = allModels
    .filter((id) => id.split('-').includes(opts.baseName))
    .filter((id) => !TIER_SUFFIXES.some((s) => id.endsWith(s)));

  if (candidates.length === 0) return undefined;

  const filtered = applyThinkingFilter(candidates, opts.preferThinking);
  if (filtered.length === 0) return undefined;

  filtered.sort((a, b) => {
    const vA = a.match(/(\d+)\.(\d+)/);
    const vB = b.match(/(\d+)\.(\d+)/);
    return compareVersionsDesc(
      vA ? [Number(vA[1]), Number(vA[2])] : null,
      vB ? [Number(vB[1]), Number(vB[2])] : null,
    );
  });

  return filtered[0];
}

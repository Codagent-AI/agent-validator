import type {
	AdapterViolation,
	GroundTruthIssue,
	JudgeMatch,
	LocationFlag,
	MatchDiagnostics,
} from "./types.js";

/**
 * Lines a matched violation may sit outside its ground-truth `line_range`
 * before the match is flagged. Reviewers often cite the function signature or
 * the line after the defect, so an exact-range check would be too noisy.
 */
export const LOCATION_LINE_TOLERANCE = 5;

/** Normalizes a repo-relative path: forward slashes, no `./`, `a/`/`b/` diff prefixes, or leading `/`. */
export function normalizePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^(?:\.\/|[ab]\/)+/, "")
		.replace(/^\/+/, "");
}

/** True when the paths are equal after normalization, or one is a path-suffix of the other. */
export function sameFile(a: string, b: string): boolean {
	const na = normalizePath(a);
	const nb = normalizePath(b);
	if (!na || !nb) return false;
	return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

/** Why a violation's location is inconsistent with a ground-truth issue, or null if consistent. */
export function locationMismatch(
	violation: Pick<AdapterViolation, "file" | "line">,
	issue: Pick<GroundTruthIssue, "file" | "line_range">,
	tolerance = LOCATION_LINE_TOLERANCE,
): LocationFlag["reason"] | null {
	if (!sameFile(violation.file ?? "", issue.file)) return "file";
	const [start, end] = issue.line_range;
	const line = Number(violation.line);
	if (!Number.isFinite(line)) return "line";
	return line < start - tolerance || line > end + tolerance ? "line" : null;
}

/**
 * Flags judge matches whose violation location disagrees with the matched
 * ground-truth issue. Diagnostic only: it never changes true-positive counts.
 * Matches pointing at an unknown ground-truth id or a missing violation index
 * are flagged as `unresolved`.
 */
export function checkMatchLocations(
	matches: JudgeMatch[],
	violations: AdapterViolation[],
	groundTruth: GroundTruthIssue[],
	tolerance = LOCATION_LINE_TOLERANCE,
): LocationFlag[] {
	const issues = new Map(groundTruth.map((gt) => [gt.id, gt]));
	return matches.flatMap((match): LocationFlag[] => {
		const issue = issues.get(match.groundTruthId);
		const violation = violations[match.violationIndex];
		const reason =
			issue && violation
				? locationMismatch(violation, issue, tolerance)
				: "unresolved";
		if (!reason) return [];
		return [
			{
				groundTruthId: match.groundTruthId,
				violationIndex: match.violationIndex,
				violationFile: violation?.file ?? null,
				violationLine: violation?.line ?? null,
				expectedFile: issue?.file ?? null,
				expectedRange: issue?.line_range ?? null,
				confidence: match.confidence,
				reason,
			},
		];
	});
}

/** Location flags plus low-confidence match count for one judged run. */
export function diagnoseMatches(
	matches: JudgeMatch[],
	violations: AdapterViolation[],
	groundTruth: GroundTruthIssue[],
	tolerance = LOCATION_LINE_TOLERANCE,
): MatchDiagnostics {
	const locationFlags = checkMatchLocations(
		matches,
		violations,
		groundTruth,
		tolerance,
	);
	return {
		locationFlagCount: locationFlags.length,
		locationFlags,
		lowConfidenceMatches: matches.filter((m) => m.confidence === "low")
			.length,
	};
}

/** One-line description of a flag, e.g. `py-foo: src/a.py:90 vs src/a.py:[56-56] (line, medium)`. */
export function formatLocationFlag(flag: LocationFlag): string {
	const actual = flag.violationFile
		? `${flag.violationFile}:${flag.violationLine ?? "?"}`
		: `violation #${flag.violationIndex}`;
	const expected = flag.expectedFile
		? `${flag.expectedFile}:[${flag.expectedRange?.join("-")}]`
		: "unknown issue";
	return `${flag.groundTruthId}: ${actual} vs ${expected} (${flag.reason}, ${flag.confidence})`;
}

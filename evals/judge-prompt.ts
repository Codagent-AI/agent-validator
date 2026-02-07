import type { AdapterViolation, GroundTruthIssue } from "./types.js";

export function buildJudgePrompt(
	groundTruth: GroundTruthIssue[],
	violations: AdapterViolation[],
): string {
	const gtList = groundTruth
		.map(
			(gt, i) =>
				`  ${i + 1}. [${gt.id}] ${gt.file}:${gt.line_range[0]}-${gt.line_range[1]} — ${gt.description.trim()} (category: ${gt.category}, difficulty: ${gt.difficulty}, requires_tool_use: ${gt.requires_tool_use})`,
		)
		.join("\n");

	const violationList =
		violations.length === 0
			? "  (no violations reported)"
			: violations
					.map(
						(v, i) =>
							`  ${i}. ${v.file}:${v.line} [${v.priority}] — ${v.issue}${v.fix ? ` (fix: ${v.fix})` : ""}`,
					)
					.join("\n");

	return `You are an eval judge for code review quality. Your job is to compare an adapter's reported violations against a ground truth list of known issues.

## Ground Truth Issues

${gtList}

## Adapter-Reported Violations

${violationList}

## Instructions

For each ground truth issue, determine whether any adapter violation matches it. A match requires:
1. Same file (exact path match)
2. Line number within 5 lines of the ground truth range
3. Semantically the same problem (the adapter describes the same bug/vulnerability, even if using different words)

For each adapter violation, determine whether it matches any ground truth issue. Violations that don't match any ground truth issue are false positives.

## Output Format

Return ONLY a valid JSON object with this structure:
{
  "matches": [
    {
      "groundTruthId": "issue-id",
      "violationIndex": 0,
      "confidence": "high",
      "reasoning": "Brief explanation of why this is a match"
    }
  ],
  "missedIssues": ["issue-id-1", "issue-id-2"],
  "falsePositives": [1, 3],
  "reasoning": "Brief overall assessment"
}

Where:
- matches: ground truth issues successfully detected by the adapter
- confidence: "high" (clearly same issue), "medium" (likely same issue), "low" (possibly same issue)
- missedIssues: ground truth issue IDs not detected
- falsePositives: violation indices (0-based) that don't match any ground truth issue
- reasoning: brief overall assessment of the adapter's performance

Be generous in matching — if the adapter identifies the same underlying problem but describes it differently, that's a match. But don't match violations that address a fundamentally different concern.`;
}

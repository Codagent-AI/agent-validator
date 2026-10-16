import type { GroundTruthIssue } from "../types.js";

export interface SourceFile {
	path: string;
	content: string;
}

function numbered(content: string): string {
	return content
		.split("\n")
		.map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
		.join("\n");
}

/**
 * Asks the judge which seeded issues the lead agent fixed and what its changes
 * broke. The judge sees the final code and the agent's own diff; the issue
 * locations refer to the code before the agent's changes.
 */
export function buildOraclePrompt(
	groundTruth: GroundTruthIssue[],
	finalFiles: SourceFile[],
	agentDiff: string,
): string {
	const issues = groundTruth
		.map(
			(gt) =>
				`- [${gt.id}] ${gt.file}:${gt.line_range[0]}-${gt.line_range[1]} (${gt.category}, ${gt.priority}) — ${gt.description.trim()}`,
		)
		.join("\n");
	const files = finalFiles
		.map((f) => `### ${f.path}\n\n\`\`\`\n${numbered(f.content)}\n\`\`\``)
		.join("\n\n");

	return `You are grading an AI coding agent's work. The agent was given a feature branch containing known, seeded problems. A code reviewer reported findings, and the agent fixed or skipped them. Decide which seeded problems are now actually fixed, and what the agent's changes broke.

## Seeded problems

Locations refer to the code before the agent's changes; lines may have moved.

${issues}

## The agent's changes (diff from the original feature to the final code)

\`\`\`diff
${agentDiff.trim() || "(no changes)"}
\`\`\`

## Final code

${files}

## Instructions

For EVERY seeded problem, give one verdict about the final code:
- "fixed": the problem no longer exists and the code still does what the feature intended.
- "partially_fixed": mitigated but not fully resolved (for example one of several call sites fixed, or a check that is still bypassable).
- "not_fixed": the problem is still present.
- "removed": the agent deleted or disabled the affected functionality instead of fixing it.

Judge the final code, not the agent's intent or comments. A fix that introduces a different bug at the same place still counts as fixed for that problem; report the new bug as a regression.

Then list regressions: problems the agent's changes introduced that were not there before, such as new bugs, broken behavior, wrong error handling, removed functionality the feature needed, or changed public behavior without reason. Do not list seeded problems that remain, pre-existing issues the agent did not touch, or style preferences. A behavior change that a fix of a seeded problem requires is not a regression (for example, reading a hardcoded secret from the environment, or restricting URLs to close an SSRF). It is a regression when the change breaks a flow that worked, adds a restriction no seeded problem called for, or goes beyond what the fix needs.

Severity: "high" means a working flow is now broken or a new bug or vulnerability was introduced; "medium" means behavior changed in a way callers would notice; "low" means a minor or cosmetic change.

## Output format

Return ONLY a JSON object:
{
  "issues": [{ "id": "seeded-problem-id", "verdict": "fixed", "reasoning": "one sentence" }],
  "regressions": [{ "file": "src/x.ts", "description": "what broke and where", "severity": "high" }],
  "reasoning": "two or three sentences of overall assessment"
}

"severity" is "high", "medium" or "low". Include every seeded problem id exactly once.`;
}

import type { E2ERunResult, E2ERunScore, FixVerdict } from "./types.js";

function sumKnown(values: (number | null | undefined)[]): number | null {
	if (values.some((v) => v === null || v === undefined)) return null;
	return (values as number[]).reduce((sum, v) => sum + v, 0);
}

export function scoreE2ERun(result: E2ERunResult): E2ERunScore {
	const count = (verdict: FixVerdict) =>
		result.oracle.issues.filter((i) => i.verdict === verdict).length;
	const decisions = (status: string) =>
		result.evidence.findings.filter((f) => f.status === status).length;
	return {
		configLabel: result.configLabel,
		runIndex: result.runIndex,
		fixed: count("fixed"),
		partiallyFixed: count("partially_fixed"),
		notFixed: count("not_fixed"),
		removed: count("removed"),
		totalIssues: result.oracle.issues.length,
		regressions: result.oracle.regressions.length,
		highRegressions: result.oracle.regressions.filter((r) => r.severity === "high").length,
		syntaxErrors: result.oracle.syntax.filter((s) => !s.ok).length,
		findings: result.evidence.findings.length,
		fixDecisions: decisions("fixed"),
		skipDecisions: decisions("skipped"),
		validatorRuns: result.evidence.validatorRuns,
		finalStatus: result.evidence.finalStatus,
		leadCostUsd: result.lead.costUsd,
		reviewerCostUsd: result.evidence.reviewerCostUsd,
		totalCostUsd: sumKnown([result.lead.costUsd, result.evidence.reviewerCostUsd]),
		wallClockMs: result.wallClockMs,
		leadTurns: result.lead.numTurns,
	};
}

export interface E2EConfigSummary {
	configLabel: string;
	runs: number;
	meanFixed: number;
	meanFixRate: number;
	meanRegressions: number;
	meanFindings: number;
	meanValidatorRuns: number;
	meanLeadCostUsd: number | null;
	meanReviewerCostUsd: number | null;
	meanTotalCostUsd: number | null;
	/** Mean total cost divided by mean issues fixed. */
	costPerFixUsd: number | null;
	meanWallClockMs: number;
}

function mean(values: number[]): number {
	return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function meanKnown(values: (number | null)[]): number | null {
	const known = values.filter((v): v is number => v !== null);
	return known.length === values.length && known.length > 0 ? mean(known) : null;
}

/** Means per config; costs are null if any run's cost is unknown. */
export function summarizeE2E(scores: E2ERunScore[]): E2EConfigSummary[] {
	const labels = [...new Set(scores.map((s) => s.configLabel))];
	return labels.map((label) => {
		const runs = scores.filter((s) => s.configLabel === label);
		const meanFixed = mean(runs.map((r) => r.fixed));
		const meanTotalCostUsd = meanKnown(runs.map((r) => r.totalCostUsd));
		return {
			configLabel: label,
			runs: runs.length,
			meanFixed,
			meanFixRate: mean(runs.map((r) => (r.totalIssues > 0 ? r.fixed / r.totalIssues : 0))),
			meanRegressions: mean(runs.map((r) => r.regressions)),
			meanFindings: mean(runs.map((r) => r.findings)),
			meanValidatorRuns: mean(runs.map((r) => r.validatorRuns)),
			meanLeadCostUsd: meanKnown(runs.map((r) => r.leadCostUsd)),
			meanReviewerCostUsd: meanKnown(runs.map((r) => r.reviewerCostUsd)),
			meanTotalCostUsd,
			costPerFixUsd: meanTotalCostUsd !== null && meanFixed > 0 ? meanTotalCostUsd / meanFixed : null,
			meanWallClockMs: mean(runs.map((r) => r.wallClockMs)),
		};
	});
}

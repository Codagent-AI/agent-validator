import type { E2EConfigSummary } from "./scoring.js";
import type { E2ERunScore } from "./types.js";

function usd(value: number | null): string {
	return value === null ? "?" : `$${value.toFixed(2)}`;
}

function seconds(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
}

export function formatRunLine(score: E2ERunScore): string {
	return [
		`  fixed ${score.fixed}/${score.totalIssues}`,
		`(partial ${score.partiallyFixed}, removed ${score.removed})`,
		`regressions ${score.regressions} (high ${score.highRegressions})`,
		`syntax errors ${score.syntaxErrors}`,
		`findings ${score.findings} (fix ${score.fixDecisions} / skip ${score.skipDecisions})`,
		`validator runs ${score.validatorRuns}`,
		`status ${score.finalStatus ?? "none"}`,
		`lead ${usd(score.leadCostUsd)} + reviewer ${usd(score.reviewerCostUsd)} = ${usd(score.totalCostUsd)}`,
		seconds(score.wallClockMs),
	].join(" | ");
}

/** Markdown table of per-run scores, ready for an eval report. */
export function formatRunTable(scores: E2ERunScore[]): string {
	const header =
		"| Config | Run | Fixed | Partial | Removed | Regressions (high) | Findings | Fix / Skip | Validator runs | Status | Lead $ | Reviewer $ | Total $ | Time |";
	const divider = `|${header.split("|").slice(1, -1).map(() => "---").join("|")}|`;
	const rows = scores.map((s) =>
		[
			"",
			s.configLabel,
			`R${s.runIndex + 1}`,
			`${s.fixed}/${s.totalIssues}`,
			s.partiallyFixed,
			s.removed,
			`${s.regressions} (${s.highRegressions})`,
			s.findings,
			`${s.fixDecisions} / ${s.skipDecisions}`,
			s.validatorRuns,
			s.finalStatus ?? "none",
			usd(s.leadCostUsd),
			usd(s.reviewerCostUsd),
			usd(s.totalCostUsd),
			seconds(s.wallClockMs),
			"",
		].join(" | ").trim(),
	);
	return [header, divider, ...rows].join("\n");
}

/** Markdown table of per-config means. */
export function formatSummaryTable(summaries: E2EConfigSummary[]): string {
	const header =
		"| Config | Runs | Fixed (mean) | Fix rate | Regressions | Findings | Validator runs | Lead $ | Reviewer $ | Total $ | $ per fix | Time |";
	const divider = `|${header.split("|").slice(1, -1).map(() => "---").join("|")}|`;
	const rows = summaries.map((s) =>
		[
			"",
			s.configLabel,
			s.runs,
			s.meanFixed.toFixed(1),
			s.meanFixRate.toFixed(2),
			s.meanRegressions.toFixed(1),
			s.meanFindings.toFixed(0),
			s.meanValidatorRuns.toFixed(1),
			usd(s.meanLeadCostUsd),
			usd(s.meanReviewerCostUsd),
			usd(s.meanTotalCostUsd),
			s.costPerFixUsd === null ? "?" : `$${s.costPerFixUsd.toFixed(3)}`,
			seconds(s.meanWallClockMs),
			"",
		].join(" | ").trim(),
	);
	return [header, divider, ...rows].join("\n");
}

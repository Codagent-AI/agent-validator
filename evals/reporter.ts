import chalk from "chalk";
import type { ConfigAggregate, EvalResults, GroundTruthIssue } from "./types.js";

export function printReport(
	results: EvalResults,
	groundTruth: GroundTruthIssue[],
): void {
	console.log("");
	console.log(chalk.bold("=== Eval Results ==="));
	console.log(`Timestamp: ${results.timestamp}`);
	console.log(`Fixture: ${results.fixture}`);
	console.log(`Ground truth issues: ${results.groundTruthCount}`);
	console.log("");

	printConfigTable(results);
	printDetectionRates(results, groundTruth);

	console.log("");
}

function printConfigTable(results: EvalResults): void {
	const sorted = [...results.configs].sort((a, b) => b.meanF1 - a.meanF1);

	console.log(chalk.bold("Configuration Comparison (sorted by F1):"));
	console.log(
		chalk.dim(
			"Config".padEnd(35) +
				"Prec".padStart(7) +
				"Rec".padStart(7) +
				"F1".padStart(7) +
				"Cons".padStart(7) +
				"Time".padStart(8),
		),
	);
	console.log(chalk.dim("-".repeat(71)));

	for (const config of sorted) {
		console.log(formatConfigRow(config));
	}

	console.log("");
}

function formatConfigRow(config: ConfigAggregate): string {
	const vals = Object.values(config.consistency);
	const consistency =
		vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
	const timeStr = `${(config.meanDurationMs / 1000).toFixed(1)}s`;
	const f1Color =
		config.meanF1 >= 0.7
			? chalk.green
			: config.meanF1 >= 0.4
				? chalk.yellow
				: chalk.red;

	return (
		config.configLabel.padEnd(35) +
		config.meanPrecision.toFixed(2).padStart(7) +
		config.meanRecall.toFixed(2).padStart(7) +
		f1Color(config.meanF1.toFixed(2).padStart(7)) +
		(consistency * 100).toFixed(0).padStart(6) +
		"%" +
		timeStr.padStart(7)
	);
}

function printDetectionRates(
	results: EvalResults,
	groundTruth: GroundTruthIssue[],
): void {
	console.log(chalk.bold("Per-Issue Detection Rates:"));

	const byDifficulty = {
		easy: [] as string[],
		medium: [] as string[],
		hard: [] as string[],
	};
	for (const gt of groundTruth) {
		byDifficulty[gt.difficulty].push(gt.id);
	}

	for (const difficulty of ["easy", "medium", "hard"] as const) {
		const issueIds = byDifficulty[difficulty];
		if (issueIds.length === 0) continue;

		console.log(
			chalk.dim(`\n  ${difficulty.toUpperCase()} (${issueIds.length} issues):`),
		);

		for (const issueId of issueIds) {
			printIssueLine(issueId, groundTruth, results);
		}
	}
}

function printIssueLine(
	issueId: string,
	groundTruth: GroundTruthIssue[],
	results: EvalResults,
): void {
	const gt = groundTruth.find((g) => g.id === issueId);
	if (!gt) return;
	const rates = formatIssueRates(issueId, results);
	const toolUseTag = gt.requires_tool_use ? chalk.cyan(" [tool-use]") : "";
	console.log(`    ${issueId}${toolUseTag}: ${rates.join("  ")}`);
}

function colorByRate(rate: number, pct: string): string {
	if (rate >= 0.67) return chalk.green(pct);
	if (rate >= 0.33) return chalk.yellow(pct);
	return chalk.red(pct);
}

function formatIssueRates(issueId: string, results: EvalResults): string[] {
	return results.configs.map((config) => {
		const rate = config.consistency[issueId] ?? 0;
		const pct = `${(rate * 100).toFixed(0)}%`;
		return `${config.configLabel.split("/")[0]}:${colorByRate(rate, pct)}`;
	});
}

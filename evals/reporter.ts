import chalk from "chalk";
import type {
	ConfigAggregate,
	EvalResults,
	GroundTruthIssue,
} from "./types.js";

export function printReport(
	results: EvalResults,
	groundTruth: GroundTruthIssue[],
): void {
	console.log("");
	console.log(chalk.bold("=== Eval Results ==="));
	console.log(`Timestamp: ${results.timestamp}`);
	console.log(`Fixture: ${results.fixture}`);
	console.log(`Ground truth issues: ${results.groundTruthCount}`);
	if (results.versions?.length) {
		for (const v of results.versions) {
			const modelStr = v.model ? ` (model: ${v.model})` : "";
			console.log(`Adapter: ${v.adapter} ${v.cliVersion}${modelStr}`);
		}
	}
	console.log("");

	printConfigTable(results);
	printDetectionRates(results, groundTruth);

	console.log("");
}

function printConfigTable(results: EvalResults): void {
	const sorted = [...results.configs].sort(
		(a, b) => b.meanRecall - a.meanRecall,
	);

	console.log(chalk.bold("Configuration Comparison (sorted by Recall):"));
	console.log(
		chalk.dim(
			"Config".padEnd(35) +
				"Prec".padStart(7) +
				"Rec".padStart(7) +
				"Time".padStart(8) +
				"In".padStart(9) +
				"Out".padStart(9) +
				"Think".padStart(9) +
				"Total".padStart(9) +
				"Tools".padStart(7),
		),
	);
	console.log(chalk.dim("-".repeat(100)));

	for (const config of sorted) {
		console.log(formatConfigRow(config));
	}

	console.log("");
}

function formatConfigRow(config: ConfigAggregate): string {
	const timeStr = `${(config.meanDurationMs / 1000).toFixed(1)}s`;
	const recallColor =
		config.meanRecall >= 0.7
			? chalk.green
			: config.meanRecall >= 0.4
				? chalk.yellow
				: chalk.red;

	const t = config.totalTokens;
	const totalTok = t.inputTokens + t.outputTokens + t.thinkingTokens;

	return (
		config.configLabel.padEnd(35) +
		config.meanPrecision.toFixed(2).padStart(7) +
		recallColor(config.meanRecall.toFixed(2).padStart(7)) +
		timeStr.padStart(7) +
		formatTokenCount(t.inputTokens).padStart(9) +
		formatTokenCount(t.outputTokens).padStart(9) +
		formatTokenCount(t.thinkingTokens).padStart(9) +
		formatTokenCount(totalTok).padStart(9) +
		String(t.toolCalls).padStart(7)
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

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

import { summarizeCosts } from "./cost.js";
import { diagnoseMatches } from "./location-check.js";
import { sumTelemetry } from "./parse-telemetry.js";
import type {
	AdapterRunResult,
	ConfigAggregate,
	EvalConfiguration,
	GroundTruthIssue,
	JudgeResult,
	RunScore,
} from "./types.js";

/** Scores one adapter run against ground truth using its judge result, if any. */
export function scoreRun(
	config: EvalConfiguration,
	run: AdapterRunResult,
	judgeResult: JudgeResult | undefined,
	groundTruth: GroundTruthIssue[],
): RunScore {
	const base = {
		configLabel: config.label,
		adapter: config.adapter,
		runIndex: run.runIndex,
		durationMs: run.durationMs,
		adapterTokens: run.telemetrySummary,
		cost: run.cost,
		judgeCost: judgeResult?.cost,
	};

	if (!judgeResult) {
		return {
			...base,
			truePositives: 0,
			falsePositives: 0,
			missedIssues: groundTruth.map((gt) => gt.id),
			precision: 0,
			recall: 0,
			f1: 0,
		};
	}

	const tp = judgeResult.matches.length;
	const fp = judgeResult.falsePositives.length;
	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const recall = groundTruth.length > 0 ? tp / groundTruth.length : 0;
	const f1 =
		precision + recall > 0
			? (2 * precision * recall) / (precision + recall)
			: 0;

	return {
		...base,
		truePositives: tp,
		falsePositives: fp,
		missedIssues: judgeResult.missedIssues,
		precision,
		recall,
		f1,
		judgeTokens: judgeResult.telemetrySummary,
		...diagnoseMatches(judgeResult.matches, run.violations, groundTruth),
	};
}

function meanOf(runs: RunScore[], pick: (run: RunScore) => number): number {
	return runs.length > 0
		? runs.reduce((s, r) => s + pick(r), 0) / runs.length
		: 0;
}

/** Aggregates quality, time, token, and cost metrics for one configuration. */
export function aggregateConfig(
	config: EvalConfiguration,
	allRuns: AdapterRunResult[],
	judgeResultsByRun: Map<AdapterRunResult, JudgeResult>,
	groundTruth: GroundTruthIssue[],
): ConfigAggregate {
	const configRuns = allRuns.filter((r) => r.configLabel === config.label);
	const runScores = configRuns.map((run) =>
		scoreRun(config, run, judgeResultsByRun.get(run), groundTruth),
	);

	// Compute consistency per issue
	const consistency: Record<string, number> = {};
	for (const gt of groundTruth) {
		const found = configRuns.filter((run) =>
			judgeResultsByRun
				.get(run)
				?.matches.some((m) => m.groundTruthId === gt.id),
		).length;
		consistency[gt.id] = configRuns.length > 0 ? found / configRuns.length : 0;
	}

	const allTelemetry = runScores.flatMap((r) => [
		r.adapterTokens,
		r.judgeTokens,
	]);

	return {
		configLabel: config.label,
		adapter: config.adapter,
		allowToolUse: config.allowToolUse,
		thinkingBudget: config.thinkingBudget,
		runs: runScores,
		meanPrecision: meanOf(runScores, (r) => r.precision),
		meanRecall: meanOf(runScores, (r) => r.recall),
		meanF1: meanOf(runScores, (r) => r.f1),
		meanDurationMs: meanOf(runScores, (r) => r.durationMs),
		consistency,
		totalTokens: sumTelemetry(allTelemetry),
		cost: summarizeCosts(runScores),
	};
}

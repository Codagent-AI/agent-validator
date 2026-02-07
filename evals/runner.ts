import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { getAdapter } from "../src/cli-adapters/index.js";
// Re-export JSON_SYSTEM_INSTRUCTION from review gate
import { JSON_SYSTEM_INSTRUCTION } from "../src/gates/review.js";
import { runAdapter } from "./adapter-runner.js";
import { judgeRun } from "./judge.js";
import { printReport } from "./reporter.js";
import type {
	AdapterRunResult,
	ConfigAggregate,
	EvalAdapterName,
	EvalConfiguration,
	EvalResults,
	GroundTruthIssue,
	JudgeResult,
	RunScore,
} from "./types.js";

interface EvalConfig {
	fixture: string;
	matrix: {
		adapters: EvalAdapterName[];
		configurations: {
			name: string;
			allow_tool_use: boolean;
			thinking_budget: string;
		}[];
	};
	runs_per_config: number;
	timeout_ms: number;
	judge: {
		adapter: EvalAdapterName;
		thinking_budget: string;
	};
}

export interface RunEvalOptions {
	adapterFilter?: string;
	configFilter?: string;
	dryRun?: boolean;
	skipJudge?: boolean;
}

export async function runEval(
	options: RunEvalOptions = {},
): Promise<EvalResults> {
	const evalsDir = dirname(new URL(import.meta.url).pathname);

	// Load eval config
	const configPath = resolve(evalsDir, "eval-config.yml");
	const configRaw = readFileSync(configPath, "utf-8");
	const evalConfig: EvalConfig = YAML.parse(configRaw);

	// Load fixture
	const fixturePath = resolve(evalsDir, evalConfig.fixture);
	const diffPath = resolve(fixturePath, "diff.patch");
	const groundTruthPath = resolve(fixturePath, "ground-truth.yml");
	const codebasePath = resolve(fixturePath, "codebase");

	const diff = readFileSync(diffPath, "utf-8");
	const groundTruthRaw = YAML.parse(readFileSync(groundTruthPath, "utf-8"));
	const groundTruth: GroundTruthIssue[] = groundTruthRaw.issues;

	// Build review prompt (code-quality prompt + JSON instruction)
	const promptPath = resolve(
		evalsDir,
		"../src/built-in-reviews/code-quality.md",
	);
	const promptContent = readFileSync(promptPath, "utf-8");
	const fullPrompt = `${promptContent}\n${JSON_SYSTEM_INSTRUCTION}`;

	// Generate eval matrix
	let matrix: EvalConfiguration[] = [];
	for (const adapterName of evalConfig.matrix.adapters) {
		for (const config of evalConfig.matrix.configurations) {
			matrix.push({
				adapter: adapterName,
				allowToolUse: config.allow_tool_use,
				thinkingBudget: config.thinking_budget,
				label: `${adapterName}/${config.name}`,
			});
		}
	}

	// Apply filters
	if (options.adapterFilter) {
		matrix = matrix.filter((c) => c.adapter === options.adapterFilter);
	}
	if (options.configFilter) {
		const filter = options.configFilter;
		matrix = matrix.filter((c) => c.label.includes(filter));
	}

	// Check adapter availability
	const availableAdapters = new Set<string>();
	for (const adapterName of evalConfig.matrix.adapters) {
		const adapter = getAdapter(adapterName);
		if (!adapter) {
			console.log(`  Skipping ${adapterName}: adapter not found`);
			continue;
		}
		const health = await adapter.checkHealth();
		if (health.available) {
			availableAdapters.add(adapterName);
		} else {
			console.log(
				`  Skipping ${adapterName}: ${health.message ?? health.status}`,
			);
		}
	}
	matrix = matrix.filter((c) => availableAdapters.has(c.adapter));

	console.log(
		`\nEval matrix: ${matrix.length} configurations x ${evalConfig.runs_per_config} runs = ${matrix.length * evalConfig.runs_per_config} total runs`,
	);
	for (const config of matrix) {
		console.log(
			`  ${config.label} (toolUse=${config.allowToolUse}, thinking=${config.thinkingBudget})`,
		);
	}

	if (options.dryRun) {
		return {
			timestamp: new Date().toISOString(),
			fixture: evalConfig.fixture,
			groundTruthCount: groundTruth.length,
			configs: [],
			rawRuns: [],
			judgeResults: [],
		};
	}

	// Execute runs sequentially
	const allRuns: AdapterRunResult[] = [];
	const judgeResultsByRun = new Map<AdapterRunResult, JudgeResult>();
	const skippedAdapters = new Set<string>();
	const originalCwd = process.cwd();

	for (const config of matrix) {
		if (skippedAdapters.has(config.adapter)) {
			console.log(`\n  Skipping ${config.label} (adapter hit usage limit)`);
			continue;
		}

		for (let run = 0; run < evalConfig.runs_per_config; run++) {
			if (skippedAdapters.has(config.adapter)) break;

			console.log(
				`\n  Running ${config.label} [run ${run + 1}/${evalConfig.runs_per_config}]...`,
			);

			let result: AdapterRunResult;
			try {
				process.chdir(codebasePath);
				result = await runAdapter(
					config,
					fullPrompt,
					diff,
					evalConfig.timeout_ms,
				);
			} finally {
				process.chdir(originalCwd);
			}

			result.runIndex = run;
			allRuns.push(result);

			console.log(
				`    Status: ${result.status}, Violations: ${result.violations.length}, Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
			);

			if (result.error) {
				console.log(`    Error: ${result.error}`);
				if (result.error === "Usage limit reached") {
					skippedAdapters.add(config.adapter);
					break;
				}
			}

			// Judge this run
			if (!options.skipJudge && result.status !== "error") {
				try {
					console.log("    Judging...");
					const judgeResult = await judgeRun(
						result.violations,
						groundTruth,
						evalConfig.judge.adapter,
						evalConfig.judge.thinking_budget,
					);
					judgeResultsByRun.set(result, judgeResult);
					console.log(
						`    Matches: ${judgeResult.matches.length}, Missed: ${judgeResult.missedIssues.length}, FP: ${judgeResult.falsePositives.length}`,
					);
				} catch (err) {
					console.log(
						`    Judge error: ${err instanceof Error ? err.message : err}`,
					);
					judgeResultsByRun.set(result, {
						matches: [],
						missedIssues: groundTruth.map((gt) => gt.id),
						falsePositives: [],
						reasoning: "Judge failed",
					});
				}
			}
		}
	}

	// Compute scores and aggregates
	const configAggregates: ConfigAggregate[] = [];

	for (const config of matrix) {
		const configRuns = allRuns.filter((r) => r.configLabel === config.label);
		const runScores: RunScore[] = [];

		for (const run of configRuns) {
			const judgeResult = judgeResultsByRun.get(run);

			if (!judgeResult) {
				runScores.push({
					configLabel: config.label,
					adapter: config.adapter,
					runIndex: run.runIndex,
					durationMs: run.durationMs,
					truePositives: 0,
					falsePositives: 0,
					missedIssues: groundTruth.map((gt) => gt.id),
					precision: 0,
					recall: 0,
					f1: 0,
				});
				continue;
			}

			const tp = judgeResult.matches.length;
			const fp = judgeResult.falsePositives.length;
			const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
			const recall = groundTruth.length > 0 ? tp / groundTruth.length : 0;
			const f1 =
				precision + recall > 0
					? (2 * precision * recall) / (precision + recall)
					: 0;

			runScores.push({
				configLabel: config.label,
				adapter: config.adapter,
				runIndex: run.runIndex,
				durationMs: run.durationMs,
				truePositives: tp,
				falsePositives: fp,
				missedIssues: judgeResult.missedIssues,
				precision,
				recall,
				f1,
			});
		}

		// Compute consistency per issue
		const consistency: Record<string, number> = {};
		for (const gt of groundTruth) {
			let found = 0;
			for (const configRun of configRuns) {
				const judgeResult = judgeResultsByRun.get(configRun);
				if (judgeResult?.matches.some((m) => m.groundTruthId === gt.id)) {
					found++;
				}
			}
			consistency[gt.id] =
				configRuns.length > 0 ? found / configRuns.length : 0;
		}

		const meanPrecision =
			runScores.length > 0
				? runScores.reduce((s, r) => s + r.precision, 0) / runScores.length
				: 0;
		const meanRecall =
			runScores.length > 0
				? runScores.reduce((s, r) => s + r.recall, 0) / runScores.length
				: 0;
		const meanF1 =
			runScores.length > 0
				? runScores.reduce((s, r) => s + r.f1, 0) / runScores.length
				: 0;
		const meanDurationMs =
			runScores.length > 0
				? runScores.reduce((s, r) => s + r.durationMs, 0) / runScores.length
				: 0;

		configAggregates.push({
			configLabel: config.label,
			adapter: config.adapter,
			allowToolUse: config.allowToolUse,
			thinkingBudget: config.thinkingBudget,
			runs: runScores,
			meanPrecision,
			meanRecall,
			meanF1,
			meanDurationMs,
			consistency,
		});
	}

	const results: EvalResults = {
		timestamp: new Date().toISOString(),
		fixture: evalConfig.fixture,
		groundTruthCount: groundTruth.length,
		configs: configAggregates,
		rawRuns: allRuns,
		judgeResults: [...judgeResultsByRun.values()],
	};

	// Write results
	const resultsDir = resolve(evalsDir, "results");
	mkdirSync(resultsDir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const resultsPath = resolve(resultsDir, `eval-${ts}.json`);
	writeFileSync(resultsPath, JSON.stringify(results, null, 2));
	console.log(`\nResults written to: ${resultsPath}`);

	// Print report
	printReport(results, groundTruth);

	return results;
}

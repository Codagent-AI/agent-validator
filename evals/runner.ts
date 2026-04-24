import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { getAdapter } from "../src/cli-adapters/index.js";
import { loadBuiltInReview } from "../src/built-in-reviews/index.js";
// Re-export JSON_SYSTEM_INSTRUCTION from review gate
import { JSON_SYSTEM_INSTRUCTION } from "../src/gates/review.js";
import { runAdapter } from "./adapter-runner.js";
import { judgeRun } from "./judge.js";
import { sumTelemetry } from "./parse-telemetry.js";
import { printReport } from "./reporter.js";
import type {
	AdapterRunResult,
	AdapterVersionInfo,
	ConfigAggregate,
	EvalAdapterName,
	EvalConfiguration,
	EvalResults,
	GroundTruthIssue,
	JudgeResult,
	RunScore,
} from "./types.js";

interface AdapterConfig {
	name: EvalAdapterName;
	model?: string;
	alias?: string;
	allow_tool_use?: boolean;
	thinking_budget?: string;
}

interface EvalConfig {
	fixture: string;
	/** When set, load prompt via `loadBuiltInReview` (combined built-ins: `all-reviewers`, `security-and-errors`, …). */
	builtin_prompt?: string;
	reviewer?: string;
	adapters: (EvalAdapterName | AdapterConfig)[];
	runs_per_config: number;
	timeout_ms: number;
	judge: {
		adapter: EvalAdapterName;
		thinking_budget: string;
		/** Passed to the judge adapter (e.g. Copilot `--model`). */
		model?: string;
	};
}

export interface RunEvalOptions {
	/** Path to eval YAML (absolute, or relative to cwd or evals/). Default: evals/eval-config.yml */
	evalConfigPath?: string;
	adapterFilter?: string;
	configFilter?: string;
	dryRun?: boolean;
	skipJudge?: boolean;
}

/** CLI commands to retrieve the version string for each adapter. */
const VERSION_COMMANDS: Record<EvalAdapterName, string> = {
	claude: "claude --version",
	codex: "codex --version",
	cursor: "agent --version",
	gemini: "gemini --version",
	"github-copilot": "copilot --version",
};

const MODEL_DETECTORS: Record<EvalAdapterName, () => string | undefined> = {
	claude: () => {
		try {
			return execSync("claude -p 'reply with only your model ID' --output-format text", {
				timeout: 30_000,
			}).toString().trim();
		} catch { return undefined; }
	},
	codex: () => {
		try {
			const toml = readFileSync(
				resolve(process.env.HOME ?? "~", ".codex/config.toml"),
				"utf-8",
			);
			const match = toml.match(/^model\s*=\s*"(.+)"/m);
			return match?.[1];
		} catch { return undefined; }
	},
	gemini: () => {
		try {
			const raw = execSync(
				"gemini -p 'Reply with only your model ID, nothing else' --output-format text --sandbox",
				{ timeout: 30_000 },
			).toString().trim();
			// Filter out MCP noise lines — the model ID is the last non-empty line
			// that looks like a model name (starts with "gemini")
			const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
			const geminiLine = [...lines].reverse().find((l) => l.startsWith("gemini"));
			return geminiLine ?? lines[lines.length - 1];
		} catch { return undefined; }
	},
	"github-copilot": () => undefined,
	cursor: () => undefined,
};

/** Resolve eval YAML path: absolute paths as-is; otherwise prefer cwd, then evals/. */
function resolveEvalConfigPath(
	evalsDir: string,
	explicit: string | undefined,
): string {
	const defaultPath = resolve(evalsDir, "eval-config.yml");
	if (!explicit) return defaultPath;
	if (isAbsolute(explicit)) return explicit;
	const fromCwd = resolve(process.cwd(), explicit);
	if (existsSync(fromCwd)) return fromCwd;
	const fromEvals = resolve(evalsDir, explicit);
	if (existsSync(fromEvals)) return fromEvals;
	return fromCwd;
}

function getAdapterVersionInfo(
	adapter: EvalAdapterName,
	skipModelDetection = false,
): AdapterVersionInfo {
	let cliVersion = "unknown";
	try {
		cliVersion = execSync(VERSION_COMMANDS[adapter], { timeout: 10_000 })
			.toString()
			.trim();
	} catch { /* CLI not available */ }

	const model = skipModelDetection ? undefined : MODEL_DETECTORS[adapter]();
	return { adapter, cliVersion, ...(model && { model }) };
}

export async function runEval(
	options: RunEvalOptions = {},
): Promise<EvalResults> {
	const evalsDir = dirname(new URL(import.meta.url).pathname);

	// Load eval config
	const configPath = resolveEvalConfigPath(evalsDir, options.evalConfigPath);
	const configRaw = readFileSync(configPath, "utf-8");
	const evalConfig: EvalConfig = YAML.parse(configRaw);

	// Load fixture
	const fixturePath = resolve(evalsDir, evalConfig.fixture);
	const diffPath = resolve(fixturePath, "diff.patch");
	const groundTruthPath = resolve(fixturePath, "ground-truth.yml");
	const codebasePath = resolve(fixturePath, "codebase");

	const diff = readFileSync(diffPath, "utf-8");
	const groundTruthRaw = YAML.parse(readFileSync(groundTruthPath, "utf-8"));
	let groundTruth: GroundTruthIssue[] = groundTruthRaw.issues;

	// Filter ground truth by reviewer if configured
	if (evalConfig.reviewer) {
		const reviewer = evalConfig.reviewer;
		const before = groundTruth.length;
		groundTruth = groundTruth.filter((gt) => gt.reviewer === reviewer);
		console.log(
			`Reviewer filter: ${reviewer} (${groundTruth.length}/${before} issues)`,
		);
	}

	// Build review prompt — optional builtin_prompt loads combined built-ins only; else .md then fallback
	const fixtureBasename = evalConfig.fixture.split("/").pop() ?? "code-quality";
	const reviewKey =
		evalConfig.builtin_prompt ?? evalConfig.reviewer ?? fixtureBasename;
	let promptContent: string;
	if (evalConfig.builtin_prompt) {
		try {
			promptContent = loadBuiltInReview(reviewKey);
		} catch (error) {
			const underlying =
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to load built-in review "${reviewKey}": ${underlying}\n` +
					`Set "builtin_prompt" to a valid name (e.g. all-reviewers, security-and-errors).`,
			);
		}
	} else {
		const promptPath = resolve(
			evalsDir,
			`../src/built-in-reviews/${reviewKey}.md`,
		);
		if (existsSync(promptPath)) {
			promptContent = readFileSync(promptPath, "utf-8");
		} else {
			try {
				promptContent = loadBuiltInReview(reviewKey);
			} catch (error) {
				const underlying =
					error instanceof Error ? error.message : String(error);
				throw new Error(
					`Review prompt not found: ${promptPath}\n` +
						`Set "builtin_prompt" to a combined built-in (e.g. all-reviewers, security-and-errors), ` +
						`or "reviewer" to an existing built-in name.\n` +
						`Underlying error: ${underlying}`,
				);
			}
		}
	}
	const fullPrompt = `${promptContent}\n${JSON_SYSTEM_INSTRUCTION}`;

	// Generate eval matrix — one entry per adapter config (no cross-product)
	let matrix: EvalConfiguration[] = [];
	for (const adapterEntry of evalConfig.adapters) {
		const isString = typeof adapterEntry === "string";
		const adapterName = isString ? adapterEntry : adapterEntry.name;
		const model = isString ? undefined : adapterEntry.model;
		const displayName = isString
			? adapterEntry
			: adapterEntry.alias ?? adapterEntry.name;
		const allowToolUse = isString ? false : (adapterEntry.allow_tool_use ?? false);
		const thinkingBudget = isString ? "off" : (adapterEntry.thinking_budget ?? "off");
		matrix.push({
			adapter: adapterName,
			allowToolUse,
			thinkingBudget,
			label: displayName,
			model,
		});
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
	for (const adapterEntry of evalConfig.adapters) {
		const adapterName =
			typeof adapterEntry === "string" ? adapterEntry : adapterEntry.name;
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

	// Collect version info for all adapters in the matrix
	// Skip model detection in dry-run mode to avoid API calls (e.g. claude -p)
	const adapterNames = [...new Set(matrix.map((c) => c.adapter))];
	const versions = adapterNames.map((a) =>
		getAdapterVersionInfo(a, options.dryRun),
	);
	// Override detected model with configured model if present
	for (const v of versions) {
		const configuredModel = matrix.find(
			(c) => c.adapter === v.adapter && c.model,
		)?.model;
		if (configuredModel) v.model = configuredModel;
		const modelStr = v.model ? `, model: ${v.model}` : "";
		console.log(`  ${v.adapter}: ${v.cliVersion}${modelStr}`);
	}

	console.log(
		`\nEval matrix: ${matrix.length} adapters x ${evalConfig.runs_per_config} runs = ${matrix.length * evalConfig.runs_per_config} total runs`,
	);
	for (const config of matrix) {
		const modelStr = config.model ? `, model=${config.model}` : "";
		console.log(
			`  ${config.label} (toolUse=${config.allowToolUse}, thinking=${config.thinkingBudget}${modelStr})`,
		);
	}

	if (options.dryRun) {
		return {
			timestamp: new Date().toISOString(),
			fixture: evalConfig.fixture,
			groundTruthCount: groundTruth.length,
			versions,
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
						{ model: evalConfig.judge.model },
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
					adapterTokens: run.telemetrySummary,
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
				adapterTokens: run.telemetrySummary,
				judgeTokens: judgeResult.telemetrySummary,
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

		const allTelemetry = runScores.flatMap((r) => [
			r.adapterTokens,
			r.judgeTokens,
		]);
		const totalTokens = sumTelemetry(allTelemetry);

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
			totalTokens,
		});
	}

	const results: EvalResults = {
		timestamp: new Date().toISOString(),
		fixture: evalConfig.fixture,
		groundTruthCount: groundTruth.length,
		versions,
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

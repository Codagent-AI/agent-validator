import { describe, expect, it, spyOn } from "bun:test";
import { readFile } from "node:fs/promises";
import { runAdapter } from "../../evals/adapter-runner.js";
import { computeRunCost, summarizeCosts } from "../../evals/cost.js";
import { JudgeRunError, judgeRun } from "../../evals/judge.js";
import { formatUsd, printReport } from "../../evals/reporter.js";
import { listPriceCost, lookupModelPrice, MODEL_PRICES } from "../../evals/pricing.js";
import { aggregateConfig } from "../../evals/scoring.js";
import type {
	AdapterRunResult,
	EvalConfiguration,
	EvalResults,
	GroundTruthIssue,
	JudgeResult,
	RunScore,
} from "../../evals/types.js";
import { parseClaudeOtelTelemetry } from "../../src/cli-adapters/claude-otel.js";
import { parseCodexTelemetry } from "../../src/cli-adapters/codex.js";
import {
	AdapterExecutionFailure,
	type CLIAdapter,
	createUnavailableTelemetry,
	observedMeasurement,
} from "../../src/cli-adapters/shared.js";

const fixture = (name: string) =>
	readFile(
		new URL(`../cli-adapters/fixtures/native-telemetry/${name}`, import.meta.url),
		"utf8",
	);

// Recorded Codex turn: input 12766 (5888 cached), output 5.
// gpt-5.5: (6878 * 5 + 5888 * 0.5 + 5 * 30) / 1e6
const CODEX_GPT55_USD = (6878 * 5 + 5888 * 0.5 + 5 * 30) / 1_000_000;

const codexConfig: EvalConfiguration = {
	adapter: "codex",
	allowToolUse: false,
	thinkingBudget: "medium",
	label: "codex-gpt5.5",
	model: "gpt-5.5",
};

describe("eval pricing", () => {
	it("uses the 2026-09-29 OpenAI standard-tier table", () => {
		expect(MODEL_PRICES["gpt-6-astra"]).toEqual({ input: 10, cachedInput: 1, output: 50 });
		expect(MODEL_PRICES["gpt-6-sol"]).toEqual({ input: 2, cachedInput: 0.2, output: 10 });
		expect(MODEL_PRICES["gpt-5.5"]).toEqual({ input: 5, cachedInput: 0.5, output: 30 });
	});

	it("prices uncached input, cached input, and output separately", () => {
		const price = lookupModelPrice("gpt-6-astra");
		expect(price).toBeDefined();
		const usd = listPriceCost(price!, { inputTotal: 1_000_000, cachedInput: 400_000, output: 100_000 });
		expect(usd).toBeCloseTo(0.6 * 10 + 0.4 * 1 + 0.1 * 50, 10);
	});

	it("normalizes case and provider prefix, and leaves unknown models unpriced", () => {
		expect(lookupModelPrice("OpenAI/GPT-6-Sol")).toEqual(MODEL_PRICES["gpt-6-sol"]);
		expect(lookupModelPrice("claude-sonnet-4.6")).toBeUndefined();
		expect(lookupModelPrice(undefined)).toBeUndefined();
	});
});

describe("computeRunCost", () => {
	it("prefers provider-reported cost", async () => {
		const telemetry = parseClaudeOtelTelemetry(await fixture("claude-2.1.261-cache-write.txt"));
		expect(computeRunCost(telemetry, "claude-opus")).toEqual({
			usd: 0.015039,
			source: "reported",
			coverage: "full",
			model: "claude-opus",
		});
	});

	it("does not treat a partial reported cost as the whole attempt", async () => {
		const telemetry = parseClaudeOtelTelemetry(await fixture("claude-2.1.261-cache-write.txt"));
		const [row] = telemetry.provider_reported_costs;
		if (!row) throw new Error("fixture has no reported cost");
		row.coverage = "partial";
		const text = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheTokens: 0, toolCalls: 0, apiRequests: 0, cost: 0.01 };
		expect(computeRunCost(telemetry, "claude-opus", text)).toEqual({
			usd: null,
			source: "unavailable",
			reason: "reported_cost_partial",
			model: "claude-opus",
		});
	});

	it("estimates Codex cost from structured tokens at list price", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		const cost = computeRunCost(telemetry, "gpt-5.5");
		expect(cost.source).toBe("list_price");
		expect(cost.usd).toBeCloseTo(CODEX_GPT55_USD, 12);
	});

	it("prefers the resolved model over the configured one", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		telemetry.resolved_identity.model = "gpt-6-sol";
		const cost = computeRunCost(telemetry, "gpt-5.5");
		expect(cost.model).toBe("gpt-6-sol");
		expect(cost.usd).toBeCloseTo((6878 * 2 + 5888 * 0.2 + 5 * 10) / 1_000_000, 12);
	});

	it("marks unknown models unavailable instead of zero", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		expect(computeRunCost(telemetry, "some-future-model")).toEqual({
			usd: null,
			source: "unavailable",
			reason: "no_list_price",
			model: "some-future-model",
		});
	});

	it("does not price runs whose cached-input split is unknown", () => {
		const telemetry = createUnavailableTelemetry("codex");
		telemetry.tokens.input_total = observedMeasurement(1000, "provider_event");
		telemetry.tokens.output = observedMeasurement(10, "provider_event");
		expect(computeRunCost(telemetry, "gpt-5.5")).toMatchObject({
			usd: null,
			source: "unavailable",
			reason: "token_breakdown_unavailable",
		});
	});

	it("adds reasoning to output only when it is not already included", () => {
		const telemetry = createUnavailableTelemetry("codex");
		telemetry.tokens.input_total = observedMeasurement(0, "provider_event");
		telemetry.tokens.cache_read = observedMeasurement(0, "provider_event");
		telemetry.tokens.output = observedMeasurement(1_000_000, "provider_event");
		telemetry.tokens.reasoning = observedMeasurement(1_000_000, "provider_event");
		expect(computeRunCost(telemetry, "gpt-6-sol").usd).toBeCloseTo(20, 10);
		telemetry.tokens.reasoning = observedMeasurement(1_000_000, "provider_event", "exact", ["output"]);
		expect(computeRunCost(telemetry, "gpt-6-sol").usd).toBeCloseTo(10, 10);
	});

	it("falls back to text-telemetry cost only when structured evidence is unusable", () => {
		const text = { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cacheTokens: 0, toolCalls: 0, apiRequests: 1, cost: 0.42 };
		expect(computeRunCost(undefined, undefined, text)).toEqual({ usd: 0.42, source: "reported", coverage: "unknown" });
		expect(computeRunCost(undefined, undefined)).toMatchObject({ usd: null, reason: "no_structured_telemetry" });
	});
});

function score(overrides: Partial<RunScore>): RunScore {
	return {
		configLabel: "c",
		adapter: "codex",
		runIndex: 0,
		durationMs: 1000,
		truePositives: 0,
		falsePositives: 0,
		missedIssues: [],
		precision: 0,
		recall: 0,
		f1: 0,
		...overrides,
	};
}

describe("summarizeCosts", () => {
	it("averages known costs, divides by true positives of costed runs, and keeps judge cost separate", () => {
		const summary = summarizeCosts([
			score({ truePositives: 2, cost: { usd: 0.1, source: "list_price" }, judgeCost: { usd: 0.5, source: "reported" } }),
			score({ truePositives: 3, cost: { usd: 0.3, source: "list_price" }, judgeCost: { usd: 0.7, source: "reported" } }),
			score({ truePositives: 10, cost: { usd: null, source: "unavailable" } }),
		]);
		expect(summary.meanCostUsd).toBeCloseTo(0.2, 10);
		expect(summary.totalCostUsd).toBeCloseTo(0.4, 10);
		expect(summary.costPerTruePositiveUsd).toBeCloseTo(0.4 / 5, 10);
		expect(summary.costedRuns).toBe(2);
		expect(summary.totalRuns).toBe(3);
		expect(summary.sources).toEqual(["list_price"]);
		expect(summary.meanJudgeCostUsd).toBeCloseTo(0.6, 10);
		expect(summary.totalJudgeCostUsd).toBeCloseTo(1.2, 10);
	});

	it("reports unavailable rather than zero when nothing is costed", () => {
		const summary = summarizeCosts([score({ truePositives: 1 })]);
		expect(summary.meanCostUsd).toBeNull();
		expect(summary.costPerTruePositiveUsd).toBeNull();
		expect(summary.meanJudgeCostUsd).toBeNull();
		expect(summary.sources).toEqual(["unavailable"]);
	});
});

type Execute = CLIAdapter["execute"];

/** Injected fake adapter; avoids the globally mocked adapter registry. */
function fakeAdapter(execute: Execute): (name: string) => CLIAdapter {
	return (name) => ({ name, execute }) as unknown as CLIAdapter;
}

describe("eval harness cost capture", () => {
	it("runAdapter computes candidate cost from structured telemetry", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		const resolve = fakeAdapter(async (opts) => {
			opts.onOutput?.("[codex-telemetry] in=1 out=1\n");
			return { text: '{"status":"pass","violations":[]}', telemetry };
		});

		const result = await runAdapter(codexConfig, "prompt", "diff", 1000, resolve);
		expect(result.status).toBe("pass");
		expect(result.adapterTelemetry).toBe(telemetry);
		expect(result.cost?.source).toBe("list_price");
		expect(result.cost?.usd).toBeCloseTo(CODEX_GPT55_USD, 12);
		expect(result.telemetrySummary?.inputTokens).toBe(1);
	});

	it("runAdapter keeps the cost of a failed execution", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		const resolve = fakeAdapter(async () => {
			throw new AdapterExecutionFailure(new Error("boom"), telemetry);
		});

		const result = await runAdapter(codexConfig, "prompt", "diff", 1000, resolve);
		expect(result.status).toBe("error");
		expect(result.error).toBe("boom");
		expect(result.cost?.usd).toBeCloseTo(CODEX_GPT55_USD, 12);
	});

	it("runAdapter falls back to the last streamed telemetry when execution throws", async () => {
		const telemetry = parseCodexTelemetry(await fixture("codex-0.153.4.jsonl"));
		const resolve = fakeAdapter(async (opts) => {
			opts.onTelemetry?.(telemetry);
			throw new Error("Command timed out");
		});

		const result = await runAdapter(codexConfig, "prompt", "diff", 1000, resolve);
		expect(result.cost?.usd).toBeCloseTo(CODEX_GPT55_USD, 12);
	});

	it("judgeRun reports judge cost, including when the judge's answer is unusable", async () => {
		const telemetry = parseClaudeOtelTelemetry(await fixture("claude-2.1.261.txt"));
		let text = '```json\n{"matches":[],"missedIssues":["a"],"falsePositives":[],"reasoning":"ok"}\n```';
		const resolve = fakeAdapter(async () => ({ text, telemetry }));

		const judged = await judgeRun([], [], "claude", "high", { model: "claude-opus" }, resolve);
		expect(judged.cost).toMatchObject({ usd: 0.0035240000000000002, source: "reported" });

		text = "no json here";
		const failure = await judgeRun([], [], "claude", "high", {}, resolve).catch((err: unknown) => err);
		expect(failure).toBeInstanceOf(JudgeRunError);
		expect((failure as JudgeRunError).cost.usd).toBe(0.0035240000000000002);
	});
});

describe("cost aggregation and reporting", () => {
	const groundTruth: GroundTruthIssue[] = [
		{ id: "a", file: "f.ts", line_range: [1, 2], description: "d", category: "bug", difficulty: "easy", priority: "high", requires_tool_use: false },
		{ id: "b", file: "f.ts", line_range: [3, 4], description: "d", category: "bug", difficulty: "easy", priority: "high", requires_tool_use: false },
	];
	const run: AdapterRunResult = {
		configLabel: codexConfig.label,
		adapter: "codex",
		runIndex: 0,
		rawOutput: "",
		violations: [],
		status: "fail",
		durationMs: 2000,
		telemetry: [],
		cost: { usd: 0.2, source: "list_price", model: "gpt-5.5" },
	};
	const judge: JudgeResult = {
		matches: [
			{ groundTruthId: "a", violationIndex: 0, confidence: "high", reasoning: "" },
			{ groundTruthId: "b", violationIndex: 1, confidence: "high", reasoning: "" },
		],
		missedIssues: [],
		falsePositives: [],
		reasoning: "",
		cost: { usd: 0.05, source: "reported" },
	};

	it("attaches per-run and per-config cost to aggregates", () => {
		const aggregate = aggregateConfig(codexConfig, [run], new Map([[run, judge]]), groundTruth);
		expect(aggregate.meanRecall).toBe(1);
		expect(aggregate.runs[0]?.cost).toEqual(run.cost);
		expect(aggregate.runs[0]?.judgeCost).toEqual(judge.cost);
		expect(aggregate.cost).toMatchObject({ meanCostUsd: 0.2, costPerTruePositiveUsd: 0.1, totalJudgeCostUsd: 0.05, sources: ["list_price"] });
	});

	it("prints cost columns and the judge cost separately", () => {
		const aggregate = aggregateConfig(codexConfig, [run], new Map([[run, judge]]), groundTruth);
		const results: EvalResults = {
			timestamp: "t",
			fixture: "fixtures/x",
			groundTruthCount: 2,
			versions: [],
			configs: [aggregate],
			rawRuns: [run],
			judgeResults: [judge],
		};
		const lines: string[] = [];
		const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.join(" "));
		});
		try {
			printReport(results, groundTruth);
		} finally {
			spy.mockRestore();
		}
		const output = lines.join("\n");
		expect(output).toContain("$/run");
		expect(output).toContain("$/TP");
		expect(output).toMatch(/codex-gpt5\.5.*\$0\.2000.*\$0\.1000.*list/);
		expect(output).toContain("Judge cost (excluded from $/run): $0.0500 total");
	});

	it("formats unknown cost as n/a", () => {
		expect(formatUsd(null)).toBe("n/a");
		expect(formatUsd(12.345)).toBe("$12.35");
	});
});

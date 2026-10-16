import { describe, expect, it } from "bun:test";
import { mergePassResults, sumCosts } from "../../evals/multi-pass.js";
import { loadReviewPasses } from "../../evals/runner.js";
import { scoreRun } from "../../evals/scoring.js";
import type { AdapterRunResult, EvalConfiguration } from "../../evals/types.js";

const config: EvalConfiguration = {
	adapter: "claude",
	allowToolUse: false,
	thinkingBudget: "low",
	label: "claude-two-pass",
	model: "claude-haiku-5-5",
};

function passRun(overrides: Partial<AdapterRunResult>): AdapterRunResult {
	return {
		configLabel: config.label,
		adapter: "claude",
		runIndex: 0,
		rawOutput: "{}",
		violations: [],
		status: "pass",
		durationMs: 1000,
		telemetry: [],
		...overrides,
	};
}

const violation = (file: string, line: number) => ({
	file,
	line,
	issue: `issue at ${file}:${line}`,
	priority: "high",
	status: "new",
});

describe("mergePassResults", () => {
	it("keeps every pass's violations, including cross-pass duplicates", () => {
		const merged = mergePassResults(
			config,
			[
				{ prompt: "code-quality", result: passRun({ status: "fail", violations: [violation("a.ts", 1)] }) },
				{
					prompt: "security-and-errors",
					result: passRun({ status: "fail", violations: [violation("a.ts", 1), violation("b.ts", 2)] }),
				},
			],
			1500,
		);
		expect(merged.violations).toHaveLength(3);
		expect(merged.status).toBe("fail");
		expect(merged.durationMs).toBe(1500);
		expect(merged.passes?.map((p) => [p.prompt, p.violations])).toEqual([
			["code-quality", 1],
			["security-and-errors", 2],
		]);
	});

	it("sums known pass costs", () => {
		const merged = mergePassResults(
			config,
			[
				{ prompt: "a", result: passRun({ cost: { usd: 0.02, source: "reported", model: "m" } }) },
				{ prompt: "b", result: passRun({ cost: { usd: 0.03, source: "reported", model: "m" } }) },
			],
			1000,
		);
		expect(merged.cost?.usd).toBeCloseTo(0.05);
		expect(merged.cost?.source).toBe("reported");
	});

	it("marks the run as an error when any pass errors", () => {
		const merged = mergePassResults(
			config,
			[
				{ prompt: "a", result: passRun({ status: "fail" }) },
				{ prompt: "b", result: passRun({ status: "error", error: "Usage limit reached" }) },
			],
			1000,
		);
		expect(merged.status).toBe("error");
		expect(merged.error).toBe("b: Usage limit reached");
	});
});

describe("sumCosts", () => {
	it("is unavailable when any pass cost is unknown, never undercounted", () => {
		const cost = sumCosts([
			{ usd: 0.02, source: "reported" },
			{ usd: null, source: "unavailable", reason: "no_structured_telemetry" },
		]);
		expect(cost.usd).toBeNull();
		expect(cost.source).toBe("unavailable");
	});

	it("labels a mix of reported and list-price passes as list_price", () => {
		const cost = sumCosts([
			{ usd: 0.02, source: "reported" },
			{ usd: 0.01, source: "list_price" },
		]);
		expect(cost.usd).toBeCloseTo(0.03);
		expect(cost.source).toBe("list_price");
	});
});

describe("loadReviewPasses", () => {
	const evalsDir = new URL("../../evals/", import.meta.url).pathname;
	const base = {
		fixture: "fixtures/all-reviewers",
		adapters: [],
		runs_per_config: 1,
		timeout_ms: 1000,
		judge: { adapter: "claude" as const, thinking_budget: "high" },
	};

	it("loads one pass per configured prompt", () => {
		const passes = loadReviewPasses(evalsDir, {
			...base,
			prompts: ["code-quality", "security", "error-handling"],
		});
		expect(passes.map((p) => p.name)).toEqual(["code-quality", "security", "error-handling"]);
		expect(new Set(passes.map((p) => p.prompt)).size).toBe(3);
	});

	it("keeps single-prompt configs as one pass", () => {
		const passes = loadReviewPasses(evalsDir, { ...base, builtin_prompt: "all-reviewers" });
		expect(passes.map((p) => p.name)).toEqual(["all-reviewers"]);
	});

	it("rejects builtin_prompt together with prompts", () => {
		expect(() =>
			loadReviewPasses(evalsDir, { ...base, builtin_prompt: "all-reviewers", prompts: ["security"] }),
		).toThrow(/either "builtin_prompt" or "prompts"/);
	});
});

describe("scoreRun with duplicate matches", () => {
	const gt = (id: string) => ({
		id,
		file: "a.ts",
		line_range: [1, 1] as [number, number],
		description: id,
		category: "bug" as const,
		difficulty: "easy" as const,
		priority: "high" as const,
		requires_tool_use: false,
	});
	const match = (groundTruthId: string, violationIndex: number) => ({
		groundTruthId,
		violationIndex,
		confidence: "high" as const,
		reasoning: "",
	});

	it("counts distinct issues for recall and keeps duplicates out of false positives", () => {
		const run = passRun({
			violations: [violation("a.ts", 1), violation("a.ts", 1), violation("a.ts", 1)],
		});
		const score = scoreRun(
			config,
			run,
			{
				matches: [match("x", 0), match("x", 1)],
				missedIssues: ["y"],
				falsePositives: [2],
				reasoning: "",
			},
			[gt("x"), gt("y")],
		);
		expect(score.truePositives).toBe(1);
		expect(score.duplicateMatches).toBe(1);
		expect(score.recall).toBe(0.5);
		expect(score.precision).toBeCloseTo(2 / 3);
	});
});

import type {
	AdapterRunResult,
	EvalConfiguration,
	PassResult,
	RunCost,
	TelemetrySummary,
} from "./types.js";

/**
 * Combines the passes of one multi-pass run into a single run result, the way
 * the validator would report several review gates on the same diff: all
 * violations are kept (duplicates across passes included), cost is the sum of
 * the passes, and duration is wall-clock time because passes run in parallel.
 */
export function mergePassResults(
	config: EvalConfiguration,
	passes: PassResult[],
	wallClockMs: number,
): AdapterRunResult {
	const runs = passes.map((p) => p.result);
	const errors = passes.filter((p) => p.result.status === "error");
	const status: AdapterRunResult["status"] =
		errors.length > 0 ? "error" : runs.some((r) => r.status === "fail") ? "fail" : "pass";

	return {
		configLabel: config.label,
		adapter: config.adapter,
		runIndex: 0,
		rawOutput: passes.map((p) => `--- pass: ${p.prompt} ---\n${p.result.rawOutput}`).join("\n"),
		violations: runs.flatMap((r) => r.violations),
		status,
		durationMs: wallClockMs,
		...(errors.length > 0 && {
			error: errors.map((p) => `${p.prompt}: ${p.result.error ?? "error"}`).join("; "),
		}),
		telemetry: runs.flatMap((r) => r.telemetry),
		telemetrySummary: sumTelemetry(runs.map((r) => r.telemetrySummary)),
		cost: sumCosts(runs.map((r) => r.cost)),
		passes: passes.map((p) => ({
			prompt: p.prompt,
			status: p.result.status,
			violations: p.result.violations.length,
			durationMs: p.result.durationMs,
			cost: p.result.cost,
		})),
	};
}

/** Sum of pass costs; unknown if any pass cost is unknown (never undercounted). */
export function sumCosts(costs: (RunCost | undefined)[]): RunCost {
	const known = costs.filter((c): c is RunCost => c !== undefined && c.usd !== null);
	if (known.length === 0 || known.length < costs.length) {
		return { usd: null, source: "unavailable", reason: "pass_cost_unavailable" };
	}
	const sources = [...new Set(known.map((c) => c.source))];
	const model = known[0]?.model;
	return {
		usd: known.reduce((s, c) => s + (c.usd ?? 0), 0),
		// Mixed reported/list-price passes are labelled list_price: an estimate is involved.
		source: sources.length === 1 && sources[0] ? sources[0] : "list_price",
		...(model && { model }),
	};
}

function sumTelemetry(
	summaries: (TelemetrySummary | undefined)[],
): TelemetrySummary | undefined {
	const present = summaries.filter((s): s is TelemetrySummary => s !== undefined);
	if (present.length === 0) return undefined;
	const total = (pick: (s: TelemetrySummary) => number) =>
		present.reduce((acc, s) => acc + pick(s), 0);
	const costs = present.map((s) => s.cost);
	return {
		inputTokens: total((s) => s.inputTokens),
		outputTokens: total((s) => s.outputTokens),
		thinkingTokens: total((s) => s.thinkingTokens),
		cacheTokens: total((s) => s.cacheTokens),
		...(costs.every((c) => c !== undefined) && {
			cost: costs.reduce((acc: number, c) => acc + (c ?? 0), 0),
		}),
		toolCalls: total((s) => s.toolCalls),
		apiRequests: total((s) => s.apiRequests),
	};
}

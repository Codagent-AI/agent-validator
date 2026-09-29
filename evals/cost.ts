import type { AdapterTelemetry } from "../src/cli-adapters/shared.js";
import type { TokenValue } from "../src/metrics/types.js";
import { listPriceCost, lookupModelPrice, type PricedTokens } from "./pricing.js";
import type { CostSummary, RunCost, RunScore, TelemetrySummary } from "./types.js";

/**
 * Per-run dollar cost. Preference order:
 *   1. provider-reported USD for the whole attempt (structured telemetry)
 *   2. API list-price estimate from structured token counts
 *   3. provider-reported cost scraped from text telemetry lines
 * Anything else is `unavailable` (never zero).
 */
export function computeRunCost(
	telemetry: AdapterTelemetry | undefined,
	configuredModel: string | undefined,
	textSummary?: TelemetrySummary,
): RunCost {
	const model = telemetry?.resolved_identity.model ?? configuredModel;
	const modelField = model ? { model } : {};

	const reported = telemetry && reportedAttemptCost(telemetry);
	if (reported) {
		return { usd: reported.usd, source: "reported", coverage: reported.coverage, ...modelField };
	}

	const tokens = telemetry && pricedTokens(telemetry);
	const price = lookupModelPrice(model);
	if (tokens && price) {
		return { usd: listPriceCost(price, tokens), source: "list_price", ...modelField };
	}

	if (textSummary?.cost !== undefined) {
		return { usd: textSummary.cost, source: "reported", coverage: "unknown", ...modelField };
	}

	return {
		usd: null,
		source: "unavailable",
		reason: unavailableReason(telemetry, tokens, model),
		...modelField,
	};
}

function reportedAttemptCost(
	telemetry: AdapterTelemetry,
): { usd: number; coverage: RunCost["coverage"] } | undefined {
	const row = telemetry.provider_reported_costs.find(
		(cost) =>
			cost.scope === "attempt" &&
			cost.amount.availability === "available" &&
			cost.currency.value === "USD",
	);
	if (row?.amount.availability !== "available") return undefined;
	return { usd: row.amount.value, coverage: row.coverage };
}

function availableValue(token: TokenValue): number | undefined {
	return token.availability === "available" ? token.value : undefined;
}

/** Maps canonical token fields onto the list-price formula's inputs. */
export function pricedTokens(telemetry: AdapterTelemetry): PricedTokens | undefined {
	const t = telemetry.tokens;
	const cachedInput = availableValue(t.cache_read);
	const output = availableValue(t.output);
	const inputTotal =
		availableValue(t.input_total) ??
		sumDefined(availableValue(t.input_uncached), cachedInput);
	if (inputTotal === undefined || cachedInput === undefined || output === undefined) {
		return undefined;
	}
	// Reasoning is billed as output; add it only when not already counted there.
	const reasoning = availableValue(t.reasoning);
	const reasoningInOutput = t.reasoning.included_in?.includes("output") ?? false;
	const extra = reasoning !== undefined && !reasoningInOutput ? reasoning : 0;
	return { inputTotal, cachedInput, output: output + extra };
}

function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
	return a === undefined || b === undefined ? undefined : a + b;
}

function unavailableReason(
	telemetry: AdapterTelemetry | undefined,
	tokens: PricedTokens | undefined,
	model: string | undefined,
): string {
	if (!telemetry) return "no_structured_telemetry";
	if (!tokens) return "token_breakdown_unavailable";
	if (!model) return "model_unknown";
	return "no_list_price";
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function costedValues(costs: (RunCost | undefined)[]): number[] {
	return costs.flatMap((c) => (c && c.usd !== null ? [c.usd] : []));
}

function mean(values: number[]): number | null {
	return values.length > 0 ? sum(values) / values.length : null;
}

function sum(values: number[]): number {
	return values.reduce((s, v) => s + v, 0);
}

/**
 * Summarizes candidate and judge cost for one configuration. Means and
 * cost-per-true-positive use only runs whose cost is known, so an unavailable
 * run is never counted as free.
 */
export function summarizeCosts(runs: RunScore[]): CostSummary {
	const candidate = costedValues(runs.map((r) => r.cost));
	const judge = costedValues(runs.map((r) => r.judgeCost));
	const costedRuns = runs.filter((r) => r.cost && r.cost.usd !== null);
	const truePositives = sum(costedRuns.map((r) => r.truePositives));
	const sources = [...new Set(runs.map((r) => r.cost?.source ?? "unavailable"))];

	return {
		meanCostUsd: mean(candidate),
		totalCostUsd: candidate.length > 0 ? sum(candidate) : null,
		costedRuns: candidate.length,
		totalRuns: runs.length,
		sources,
		costPerTruePositiveUsd:
			candidate.length > 0 && truePositives > 0 ? sum(candidate) / truePositives : null,
		meanJudgeCostUsd: mean(judge),
		totalJudgeCostUsd: judge.length > 0 ? sum(judge) : null,
	};
}

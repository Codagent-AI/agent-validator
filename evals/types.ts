import type { AdapterTelemetry } from "../src/cli-adapters/shared.js";

export type EvalAdapterName =
	| "claude"
	| "codex"
	| "cursor"
	| "gemini"
	| "github-copilot";

export interface EvalConfiguration {
	adapter: EvalAdapterName;
	allowToolUse: boolean;
	thinkingBudget: string;
	label: string;
	model?: string;
}

export interface GroundTruthIssue {
	id: string;
	file: string;
	line_range: [number, number];
	description: string;
	category: "bug" | "security" | "performance";
	difficulty: "easy" | "medium" | "hard";
	priority: "critical" | "high" | "medium" | "low";
	requires_tool_use: boolean;
	reviewer?: string;
}

export interface AdapterViolation {
	file: string;
	line: number;
	issue: string;
	fix?: string;
	priority: string;
	status: string;
}

export interface TelemetrySummary {
	inputTokens: number;
	outputTokens: number;
	thinkingTokens: number;
	cacheTokens: number;
	cost?: number;
	toolCalls: number;
	apiRequests: number;
}

/**
 * Where a run's dollar cost came from:
 * - `reported`: the provider/CLI reported USD for the run (e.g. Claude OTel).
 * - `list_price`: API-equivalent estimate from token counts and `evals/pricing.ts`.
 * - `unavailable`: neither was possible; the cost is unknown, not zero.
 */
export type CostSource = "reported" | "list_price" | "unavailable";

export interface RunCost {
	usd: number | null;
	source: CostSource;
	/** Model used for pricing/identification, when known. */
	model?: string;
	/** Provider-declared coverage of a reported cost. */
	coverage?: "full" | "partial" | "unknown";
	/** Why the cost is unavailable. */
	reason?: string;
}

export interface CostSummary {
	/** Mean candidate cost over runs whose cost is known. */
	meanCostUsd: number | null;
	totalCostUsd: number | null;
	/** Runs with a known candidate cost, out of `totalRuns`. */
	costedRuns: number;
	totalRuns: number;
	sources: CostSource[];
	/** Known candidate cost divided by true positives of those same runs. */
	costPerTruePositiveUsd: number | null;
	meanJudgeCostUsd: number | null;
	totalJudgeCostUsd: number | null;
}

export interface AdapterRunResult {
	configLabel: string;
	adapter: EvalAdapterName;
	runIndex: number;
	rawOutput: string;
	violations: AdapterViolation[];
	status: "pass" | "fail" | "error";
	durationMs: number;
	error?: string;
	telemetry: string[];
	telemetrySummary?: TelemetrySummary;
	/** Structured adapter telemetry (tokens, reported cost, identity). */
	adapterTelemetry?: AdapterTelemetry;
	cost?: RunCost;
}

export interface JudgeMatch {
	groundTruthId: string;
	violationIndex: number;
	confidence: "high" | "medium" | "low";
	reasoning: string;
}

export interface JudgeResult {
	matches: JudgeMatch[];
	missedIssues: string[];
	falsePositives: number[];
	reasoning: string;
	telemetrySummary?: TelemetrySummary;
	/** Judge cost, kept separate from the candidate's cost. */
	cost?: RunCost;
}

/**
 * A judge match whose violation location disagrees with the matched
 * ground-truth issue (see `evals/location-check.ts`). Diagnostic only.
 */
export interface LocationFlag {
	groundTruthId: string;
	violationIndex: number;
	violationFile: string | null;
	violationLine: number | null;
	expectedFile: string | null;
	expectedRange: [number, number] | null;
	confidence: JudgeMatch["confidence"];
	/** `file`: different file; `line`: outside range ± tolerance; `unresolved`: unknown issue id or violation index. */
	reason: "file" | "line" | "unresolved";
}

/** Per-run diagnostics on judge matches; they do not affect TP counts. */
export interface MatchDiagnostics {
	locationFlagCount: number;
	locationFlags: LocationFlag[];
	lowConfidenceMatches: number;
}

export interface RunScore extends Partial<MatchDiagnostics> {
	configLabel: string;
	adapter: EvalAdapterName;
	runIndex: number;
	durationMs: number;
	truePositives: number;
	falsePositives: number;
	missedIssues: string[];
	precision: number;
	recall: number;
	f1: number;
	adapterTokens?: TelemetrySummary;
	judgeTokens?: TelemetrySummary;
	cost?: RunCost;
	judgeCost?: RunCost;
}

export interface ConfigAggregate {
	configLabel: string;
	adapter: EvalAdapterName;
	allowToolUse: boolean;
	thinkingBudget: string;
	runs: RunScore[];
	meanPrecision: number;
	meanRecall: number;
	meanF1: number;
	meanDurationMs: number;
	consistency: Record<string, number>;
	totalTokens: TelemetrySummary;
	cost: CostSummary;
}

export interface AdapterVersionInfo {
	adapter: EvalAdapterName;
	cliVersion: string;
	model?: string;
}

export interface EvalResults {
	timestamp: string;
	fixture: string;
	groundTruthCount: number;
	versions: AdapterVersionInfo[];
	configs: ConfigAggregate[];
	rawRuns: AdapterRunResult[];
	judgeResults: JudgeResult[];
}

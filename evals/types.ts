export type EvalAdapterName = "claude" | "codex" | "gemini" | "github-copilot";

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
}

export interface RunScore {
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

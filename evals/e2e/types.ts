import type { EvalAdapterName, RunCost } from "../types.js";

/** Reviewer setup under test: the validator config the lead agent runs with. */
export interface E2EReviewerConfig {
	label: string;
	adapter: EvalAdapterName;
	model?: string;
	thinking_budget?: string;
	/** Built-in review names; each becomes one review gate. */
	reviews: string[];
}

export interface E2ELeadConfig {
	model: string;
	effort?: string;
	timeout_ms: number;
	/** Passed to `claude --max-budget-usd`, so a runaway session stops. */
	max_budget_usd?: number;
}

export interface E2EConfig {
	/** Fixture directory with `base/`, `diff.patch` and `ground-truth.yml`. */
	fixture: string;
	runs_per_config: number;
	lead: E2ELeadConfig;
	judge: { adapter: EvalAdapterName; model?: string; thinking_budget: string };
	configs: E2EReviewerConfig[];
}

/** What the lead agent's transcript shows it did. */
export interface LeadActivity {
	/** Skill named by a `/skill` prompt. */
	promptSkill: string | null;
	/** Whether the session loaded that skill, so the prompt expanded it. */
	promptSkillLoaded: boolean;
	/** Skills the lead invoked with the Skill tool. */
	skillCalls: string[];
	/** Bash commands that ran the validator CLI. */
	validatorCommands: string[];
}

export interface LeadResult {
	exitCode: number | null;
	timedOut: boolean;
	durationMs: number;
	costUsd: number | null;
	numTurns: number | null;
	isError: boolean;
	/** The lead agent's final message. */
	finalMessage: string;
	activity: LeadActivity;
	/** Raw `stream-json` output of the lead session. */
	transcriptPath?: string;
	error?: string;
}

/** A review violation as recorded in the validator's review JSON logs. */
export interface ReviewFinding {
	/** Review JSON file name, e.g. `review_._security_claude@1.2.json`. */
	source: string;
	file: string;
	line: number;
	issue: string;
	priority: string;
	status: string;
	result?: string;
}

/** What the validator logs say happened during the lead agent's session. */
export interface ValidatorEvidence {
	/** `run` invocations recorded in metrics snapshots. */
	validatorRuns: number;
	reviewerCostUsd: number | null;
	/** Attempts with a known provider-reported cost, out of `reviewerAttempts`. */
	reviewerCostedAttempts: number;
	reviewerAttempts: number;
	/** Every violation reported across all validator runs. */
	findings: ReviewFinding[];
	/** Last `Status:` line seen in a console log, if any. */
	finalStatus: string | null;
}

export type FixVerdict = "fixed" | "partially_fixed" | "not_fixed" | "removed";

export interface IssueVerdict {
	id: string;
	verdict: FixVerdict;
	reasoning: string;
}

export interface Regression {
	file: string;
	description: string;
	severity: "high" | "medium" | "low";
}

export interface SyntaxCheckResult {
	file: string;
	ok: boolean;
	output?: string;
}

export interface OracleResult {
	issues: IssueVerdict[];
	regressions: Regression[];
	syntax: SyntaxCheckResult[];
	reasoning: string;
	judgeCost?: RunCost;
	error?: string;
}

export interface E2ERunResult {
	configLabel: string;
	runIndex: number;
	workspace: string;
	lead: LeadResult;
	evidence: ValidatorEvidence;
	/** The lead agent's changes: initial feature state -> final state. */
	agentDiff: string;
	oracle: OracleResult;
	wallClockMs: number;
}

export interface E2ERunScore {
	configLabel: string;
	runIndex: number;
	fixed: number;
	partiallyFixed: number;
	notFixed: number;
	removed: number;
	totalIssues: number;
	regressions: number;
	highRegressions: number;
	syntaxErrors: number;
	findings: number;
	fixDecisions: number;
	skipDecisions: number;
	validatorRuns: number;
	finalStatus: string | null;
	leadCostUsd: number | null;
	reviewerCostUsd: number | null;
	totalCostUsd: number | null;
	wallClockMs: number;
	leadTurns: number | null;
}

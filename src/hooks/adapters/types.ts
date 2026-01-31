import type { GauntletStatus, RunResult } from "../../types/gauntlet-status.js";

/**
 * Protocol-agnostic context passed from adapter to handler.
 * Contains normalized fields from either Claude Code or Cursor input.
 */
export interface StopHookContext {
	/** Working directory for the project */
	cwd: string;
	/** True if this is a nested hook invocation (Claude: stop_hook_active, Cursor: high loop_count) */
	isNestedHook: boolean;
	/** Cursor-specific: current loop iteration count */
	loopCount?: number;
	/** Session/conversation identifier for logging */
	sessionId?: string;
	/** Original parsed JSON input for diagnostics */
	rawInput: Record<string, unknown>;
}

/**
 * Protocol-agnostic result from handler to adapter.
 * Contains all information needed to format protocol-specific output.
 */
export interface StopHookResult {
	/** Machine-readable status code */
	status: GauntletStatus;
	/** Whether the stop should be blocked */
	shouldBlock: boolean;
	/** Fix instructions when blocking due to failed gates */
	instructions?: string;
	/** PR push instructions when blocking due to pr_push_required */
	pushPRReason?: string;
	/** CI fix instructions when blocking due to ci_failed */
	ciFixReason?: string;
	/** CI pending instructions when blocking due to ci_pending */
	ciPendingReason?: string;
	/** Human-friendly status message */
	message: string;
	/** Interval minutes (when status is interval_not_elapsed) */
	intervalMinutes?: number;
	/** Individual gate results for detailed failure information */
	gateResults?: RunResult["gateResults"];
}

/**
 * Result from PR status check.
 */
export interface PRStatusResult {
	/** Whether a PR exists for the current branch */
	prExists: boolean;
	/** Whether the PR is up to date with local HEAD */
	upToDate: boolean;
	/** Error message if check failed (graceful degradation) */
	error?: string;
	/** PR number if it exists */
	prNumber?: number;
}

/**
 * Adapter interface for protocol-specific stop hook handling.
 * Each adapter handles input parsing, output formatting, and protocol-specific behavior.
 */
export interface StopHookAdapter {
	/** Human-readable name for logging */
	name: string;

	/**
	 * Detect if this adapter should handle the given input.
	 * @param raw Parsed JSON from stdin
	 * @returns true if this adapter should handle the input
	 */
	detect(raw: Record<string, unknown>): boolean;

	/**
	 * Parse protocol-specific input into normalized context.
	 * @param raw Parsed JSON from stdin
	 * @returns Normalized context for the handler
	 */
	parseInput(raw: Record<string, unknown>): StopHookContext;

	/**
	 * Format handler result into protocol-specific output.
	 * @param result Handler result
	 * @returns JSON string to output to stdout
	 */
	formatOutput(result: StopHookResult): string;

	/**
	 * Check if execution should be skipped based on protocol-specific conditions.
	 * @param ctx Parsed context
	 * @returns Result to output immediately, or null to continue execution
	 */
	shouldSkipExecution(ctx: StopHookContext): StopHookResult | null;
}

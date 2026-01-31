/**
 * All possible outcomes from gauntlet operations.
 * Used by both the run executor and stop-hook - NO MAPPING REQUIRED.
 */
export type GauntletStatus =
	// Run outcomes (from executor)
	| "passed" // All gates passed
	| "passed_with_warnings" // Some issues were skipped
	| "no_applicable_gates" // No gates matched current changes
	| "no_changes" // No changes detected
	| "failed" // Gates failed, retries remaining
	| "retry_limit_exceeded" // Max retries reached
	| "lock_conflict" // Another run in progress
	| "error" // Unexpected error (includes config errors)
	| "pr_push_required" // Gates passed but PR needs to be created/updated
	// CI workflow statuses (after PR is pushed)
	| "ci_pending" // CI checks still running
	| "ci_failed" // CI checks failed or review changes requested
	| "ci_passed" // CI checks passed, no blocking reviews
	| "ci_timeout" // CI wait attempts exhausted
	// Stop-hook pre-checks (before running executor)
	| "no_config" // No .gauntlet/config.yml found
	| "stop_hook_active" // Infinite loop prevention
	| "interval_not_elapsed" // Run interval hasn't passed
	| "invalid_input" // Failed to parse hook JSON input
	| "stop_hook_disabled"; // Stop hook disabled via configuration

export interface RunResult {
	status: GauntletStatus;
	/** Human-friendly message explaining the outcome */
	message: string;
	/** Number of gates that ran */
	gatesRun?: number;
	/** Number of gates that failed */
	gatesFailed?: number;
	/** Path to latest console log file */
	consoleLogPath?: string;
	/** Error message if status is "error" */
	errorMessage?: string;
	/** Interval minutes (when status is "interval_not_elapsed") */
	intervalMinutes?: number;
	/** Individual gate results (available when gates were executed) */
	gateResults?: Array<{
		jobId: string;
		status: "pass" | "fail" | "error";
		logPath?: string;
		logPaths?: string[];
		subResults?: Array<{
			nameSuffix: string;
			status: "pass" | "fail" | "error";
			logPath?: string;
		}>;
	}>;
}

/**
 * Determine if a status should block the stop hook.
 */
export function isBlockingStatus(status: GauntletStatus): boolean {
	return (
		status === "failed" ||
		status === "pr_push_required" ||
		status === "ci_pending" ||
		status === "ci_failed"
	);
}

/**
 * Determine if a status indicates successful completion (exit code 0).
 */
export function isSuccessStatus(status: GauntletStatus): boolean {
	return (
		status === "passed" ||
		status === "passed_with_warnings" ||
		status === "no_applicable_gates" ||
		status === "no_changes" ||
		status === "ci_passed"
	);
}

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
import { resolveStopHookConfig } from "../config/stop-hook-config.js";
import { executeRun } from "../core/run-executor.js";
import { getCategoryLogger } from "../output/app-logger.js";
import {
	type GauntletStatus,
	isBlockingStatus,
	type RunResult,
} from "../types/gauntlet-status.js";
import type { DebugLogger } from "../utils/debug-log.js";
import { writeExecutionState } from "../utils/execution-state.js";
import type {
	PRStatusResult,
	StopHookContext,
	StopHookResult,
} from "./adapters/types.js";

const execFileAsync = promisify(execFile);

interface MinimalConfig {
	log_dir?: string;
	debug_log?: {
		enabled?: boolean;
		max_size_mb?: number;
	};
	stop_hook?: {
		auto_push_pr?: boolean;
	};
}

/**
 * Default log directory when config doesn't specify one.
 */
const DEFAULT_LOG_DIR = "gauntlet_logs";

/**
 * Read and parse the project config file.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
async function readProjectConfig(
	projectCwd: string,
): Promise<MinimalConfig | undefined> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		return YAML.parse(content) as MinimalConfig;
	} catch {
		return undefined;
	}
}

interface FailedGateLog {
	/** Log file paths for failed check gates */
	checkLogs: string[];
	/** JSON file paths for failed review gates */
	reviewJsons: string[];
}

/**
 * Get a logger for stop-hook operations.
 */
function getStopHookLogger() {
	return getCategoryLogger("stop-hook");
}

/**
 * Extract failed gate log paths from gate results.
 */
function getFailedGateLogs(
	gateResults?: RunResult["gateResults"],
): FailedGateLog {
	const checkLogs: string[] = [];
	const reviewJsons: string[] = [];

	if (!gateResults) return { checkLogs, reviewJsons };

	for (const gate of gateResults) {
		if (gate.status === "pass") continue;

		const isReview = gate.jobId.startsWith("review:");

		if (gate.subResults) {
			for (const sub of gate.subResults) {
				if (sub.status === "pass" || !sub.logPath) continue;
				if (isReview) {
					reviewJsons.push(sub.logPath);
				} else {
					checkLogs.push(sub.logPath);
				}
			}
		} else if (isReview) {
			// Review gate without subResults — check logPaths then logPath
			const paths = gate.logPaths ?? (gate.logPath ? [gate.logPath] : []);
			for (const p of paths) {
				if (p.endsWith(".json")) {
					reviewJsons.push(p);
				} else {
					checkLogs.push(p);
				}
			}
		} else {
			// Check gate
			const logPath = gate.logPath ?? gate.logPaths?.[0];
			if (logPath) {
				checkLogs.push(logPath);
			}
		}
	}

	return { checkLogs, reviewJsons };
}

/**
 * Get the enhanced stop reason instructions for the agent.
 * Includes trust level guidance (when reviews fail), violation handling,
 * termination conditions, and paths to failed gate log files.
 */
export function getStopReasonInstructions(
	gateResults?: RunResult["gateResults"],
): string {
	const { checkLogs, reviewJsons } = getFailedGateLogs(gateResults);
	const hasReviewFailures = reviewJsons.length > 0;

	const trustLevelSection = hasReviewFailures
		? `\n**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed.\n`
		: "";

	let failedLogsSection = "";
	if (checkLogs.length > 0 || reviewJsons.length > 0) {
		failedLogsSection = "\n\n**Failed gate logs:**";
		for (const logPath of checkLogs) {
			failedLogsSection += `\n- Check: \`${logPath}\``;
		}
		for (const jsonPath of reviewJsons) {
			failedLogsSection += `\n- Review: \`${jsonPath}\``;
		}
	}

	const hasCheckFailures = checkLogs.length > 0;

	// Build failure instructions conditionally based on what types of failures exist
	const failureSteps: string[] = [];
	if (hasCheckFailures) {
		failureSteps.push(
			"For CHECK failures: Read the `.log` file path listed below.",
		);
	}
	if (hasReviewFailures) {
		failureSteps.push(
			"For REVIEW failures: Read the `.json` file path listed below.",
		);
		failureSteps.push(
			'For REVIEW violations: Update the `"status"` and `"result"` fields in the JSON file:\n   - Set `"status": "fixed"` with a brief description in `"result"` for issues you fix.\n   - Set `"status": "skipped"` with a brief reason in `"result"` for issues you skip.',
		);
	}

	const addressSection =
		failureSteps.length > 0
			? `\n**To address failures:**\n${failureSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`
			: "";

	return `**GAUNTLET FAILED — YOU MUST FIX ISSUES NOW**

You cannot stop until the gauntlet passes or a termination condition is met. The stop hook will automatically re-run to verify your fixes.
${trustLevelSection}${addressSection}
**Termination conditions:**
- "Status: Passed" — All gates passed
- "Status: Passed with warnings" — Remaining issues were skipped
- "Status: Retry limit exceeded" — Run \`agent-gauntlet clean\` to archive the session and stop. This is the only case requiring manual clean; it signals unresolvable issues that need human review.${failedLogsSection}`;
}

/**
 * Static status messages for statuses that don't need dynamic context.
 */
const STATUS_MESSAGES: Record<string, string> = {
	passed: "✓ Gauntlet passed — all gates completed successfully.",
	passed_with_warnings:
		"✓ Gauntlet completed — passed with warnings (some issues were skipped).",
	no_applicable_gates:
		"✓ Gauntlet passed — no applicable gates matched current changes.",
	no_changes: "✓ Gauntlet passed — no changes detected.",
	retry_limit_exceeded:
		"⚠ Gauntlet terminated — retry limit exceeded. Run `agent-gauntlet clean` to archive and continue.",
	lock_conflict:
		"⏭ Gauntlet skipped — another gauntlet run is already in progress.",
	failed: "✗ Gauntlet failed — issues must be fixed before stopping.",
	pr_push_required:
		"✓ Gauntlet passed — PR needs to be created or updated before stopping.",
	no_config: "○ Not a gauntlet project — no .gauntlet/config.yml found.",
	stop_hook_active:
		"↺ Stop hook cycle detected — allowing stop to prevent infinite loop.",
	stop_hook_disabled: "○ Stop hook is disabled via configuration.",
	invalid_input: "⚠ Invalid hook input — could not parse JSON, allowing stop.",
};

/**
 * Get a human-friendly message for each status code.
 * These messages explain why the stop was approved or blocked.
 */
export function getStatusMessage(
	status: GauntletStatus,
	context?: { intervalMinutes?: number; errorMessage?: string },
): string {
	// Handle statuses that need dynamic context
	if (status === "interval_not_elapsed") {
		return context?.intervalMinutes
			? `⏭ Gauntlet skipped — run interval (${context.intervalMinutes} min) not elapsed since last run.`
			: "⏭ Gauntlet skipped — run interval not elapsed since last run.";
	}

	if (status === "error") {
		return context?.errorMessage
			? `⚠ Stop hook error — ${context.errorMessage}`
			: "⚠ Stop hook error — unexpected error occurred.";
	}

	// Use static lookup for all other statuses
	return STATUS_MESSAGES[status] ?? `Unknown status: ${status}`;
}

/**
 * Generate push-PR instructions for the agent.
 */
export function getPushPRInstructions(options?: {
	hasWarnings?: boolean;
}): string {
	const warningGuidance = options?.hasWarnings
		? "\n\n**Note:** Some issues were skipped during the gauntlet. Include a summary of skipped issues in the PR description so reviewers are aware."
		: "";

	return `**GAUNTLET PASSED — CREATE OR UPDATE YOUR PULL REQUEST**

All local quality gates have passed. Before you can stop, you need to commit your changes, push to remote, and create or update a pull request for the current branch.

After the PR is created or updated, try to stop again. The stop hook will verify the PR exists and is up to date.${warningGuidance}`;
}

/**
 * Read the log_dir from project config without full validation.
 */
export async function getLogDir(projectCwd: string): Promise<string> {
	const config = await readProjectConfig(projectCwd);
	return config?.log_dir || DEFAULT_LOG_DIR;
}

/**
 * Read the debug_log config from project config without full validation.
 */
export async function getDebugLogConfig(
	projectCwd: string,
): Promise<MinimalConfig["debug_log"]> {
	const config = await readProjectConfig(projectCwd);
	return config?.debug_log;
}

/**
 * Check if we should verify PR status after gates pass.
 * Loads stop hook config with 3-tier precedence and checks auto_push_pr.
 */
async function shouldCheckPR(projectCwd: string): Promise<boolean> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const raw = YAML.parse(content) as { stop_hook?: Record<string, unknown> };
		const projectStopHookConfig = raw?.stop_hook as
			| { auto_push_pr?: boolean }
			| undefined;
		const globalConfig = await loadGlobalConfig();
		const resolved = resolveStopHookConfig(projectStopHookConfig, globalConfig);
		return resolved.auto_push_pr;
	} catch {
		return false;
	}
}

/**
 * Check PR existence and whether local commits have been pushed.
 *
 * Uses `gh pr view` to get PR info and compares head SHA with local HEAD.
 * Gracefully degrades if `gh` is not installed or any error occurs.
 */
async function checkPRStatus(cwd: string): Promise<PRStatusResult> {
	try {
		// Check if gh CLI is available
		try {
			await execFileAsync("gh", ["--version"], { cwd });
		} catch {
			return {
				prExists: false,
				upToDate: false,
				error: "gh CLI not installed",
			};
		}

		// Get PR info for current branch
		let prInfo: { number: number; state: string; headRefOid: string };
		try {
			const { stdout } = await execFileAsync(
				"gh",
				["pr", "view", "--json", "number,state,headRefOid"],
				{ cwd },
			);
			prInfo = JSON.parse(stdout.trim());
		} catch (e: unknown) {
			const errMsg = (e as { message?: string }).message ?? "unknown";
			// gh pr view exits with code 1 and specific message when no PR exists
			if (
				errMsg.includes("no pull requests found") ||
				errMsg.includes("Could not resolve")
			) {
				return { prExists: false, upToDate: false };
			}
			// Other failures (network, auth, etc.) — return error for graceful degradation
			return {
				prExists: false,
				upToDate: false,
				error: `gh pr view failed: ${errMsg}`,
			};
		}

		// Get local HEAD SHA
		const { stdout: localHead } = await execFileAsync(
			"git",
			["rev-parse", "HEAD"],
			{ cwd },
		);
		const localSha = localHead.trim();

		const upToDate = prInfo.headRefOid === localSha;
		return {
			prExists: true,
			upToDate,
			prNumber: prInfo.number,
		};
	} catch (error: unknown) {
		const errMsg = (error as { message?: string }).message ?? "unknown";
		return {
			prExists: false,
			upToDate: false,
			error: `PR status check failed: ${errMsg}`,
		};
	}
}

/**
 * Check if the gauntlet status indicates a passing state that should trigger PR check.
 */
function isPassingStatus(status: GauntletStatus): boolean {
	return status === "passed" || status === "passed_with_warnings";
}

/**
 * Refresh execution state (non-fatal on error).
 */
async function refreshExecutionState(logDir?: string): Promise<void> {
	if (!logDir) return;
	try {
		await writeExecutionState(logDir);
	} catch {
		// Non-fatal; stale state won't block the next run
	}
}

/**
 * Check PR status after gauntlet passes and determine if the stop should be blocked.
 * Returns the final status and optional push-PR reason.
 */
async function postGauntletPRCheck(
	projectCwd: string,
	gauntletStatus: GauntletStatus,
	options?: { logDir?: string },
): Promise<{ finalStatus: GauntletStatus; pushPRReason?: string }> {
	// Only check PR for passing statuses
	if (!isPassingStatus(gauntletStatus)) {
		return { finalStatus: gauntletStatus };
	}

	// Skip if auto_push_pr is disabled
	if (!(await shouldCheckPR(projectCwd))) {
		return { finalStatus: gauntletStatus };
	}

	const prStatus = await checkPRStatus(projectCwd);

	// Graceful degradation on PR check errors
	if (prStatus.error) {
		getStopHookLogger().warn(`PR status check failed: ${prStatus.error}`);
		return { finalStatus: gauntletStatus };
	}

	// PR exists and is up to date - allow stop
	if (prStatus.prExists && prStatus.upToDate) {
		return { finalStatus: gauntletStatus };
	}

	// PR missing or outdated - block and request push
	await refreshExecutionState(options?.logDir);
	return {
		finalStatus: "pr_push_required",
		pushPRReason: getPushPRInstructions({
			hasWarnings: gauntletStatus === "passed_with_warnings",
		}),
	};
}

/**
 * Core stop hook handler that executes the gauntlet and determines the result.
 * Protocol-agnostic: works with any adapter that provides a StopHookContext.
 */
export class StopHookHandler {
	private debugLogger?: DebugLogger;
	private logDir?: string;

	constructor(debugLogger?: DebugLogger) {
		this.debugLogger = debugLogger;
	}

	/**
	 * Set the debug logger (can be updated after construction).
	 */
	setDebugLogger(debugLogger: DebugLogger): void {
		this.debugLogger = debugLogger;
	}

	/**
	 * Set the log directory (needed for execution state refresh).
	 */
	setLogDir(logDir: string): void {
		this.logDir = logDir;
	}

	/**
	 * Execute the gauntlet and return a protocol-agnostic result.
	 */
	async execute(ctx: StopHookContext): Promise<StopHookResult> {
		const log = getStopHookLogger();

		log.info("Running gauntlet gates...");
		const result = await executeRun({
			cwd: ctx.cwd,
			checkInterval: true,
		});

		log.info(`Gauntlet completed with status: ${result.status}`);

		// Post-gauntlet PR check: when gates pass and auto_push_pr is enabled,
		// verify a PR exists and is up to date before allowing stop.
		const { finalStatus, pushPRReason } = await postGauntletPRCheck(
			ctx.cwd,
			result.status,
			{ logDir: this.logDir },
		);

		await this.debugLogger?.logStopHook(
			isBlockingStatus(finalStatus) ? "block" : "allow",
			finalStatus,
		);

		const shouldBlock = isBlockingStatus(finalStatus);
		const message = getStatusMessage(finalStatus, {
			intervalMinutes: result.intervalMinutes,
			errorMessage: result.errorMessage,
		});

		return {
			status: finalStatus,
			shouldBlock,
			instructions:
				finalStatus === "failed"
					? getStopReasonInstructions(result.gateResults)
					: undefined,
			pushPRReason,
			message,
			intervalMinutes: result.intervalMinutes,
			gateResults: result.gateResults,
		};
	}
}

// Re-export types and functions for backward compatibility
export type { PRStatusResult };
export { checkPRStatus, shouldCheckPR };

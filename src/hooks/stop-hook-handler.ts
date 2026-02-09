import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
import type { StopHookConfig } from "../config/stop-hook-config.js";
import { resolveStopHookConfig } from "../config/stop-hook-config.js";
import { getCategoryLogger } from "../output/app-logger.js";
import type { GauntletStatus } from "../types/gauntlet-status.js";
import type { DebugLogger } from "../utils/debug-log.js";
import type {
	PRStatusResult,
	StopHookContext,
	StopHookResult,
} from "./adapters/types.js";
import {
	checkRunInterval,
	getLastRunStatus,
	hasChangesSinceLastRun,
	hasChangesVsBaseBranch,
	hasFailedRunLogs,
} from "./stop-hook-state.js";

const execFileAsync = promisify(execFile);

interface MinimalConfig {
	log_dir?: string;
	debug_log?: {
		enabled?: boolean;
		max_size_mb?: number;
	};
	stop_hook?: {
		auto_push_pr?: boolean;
		auto_fix_pr?: boolean;
	};
	base_branch?: string;
}

/**
 * Default log directory when config doesn't specify one.
 */
const DEFAULT_LOG_DIR = "gauntlet_logs";

/**
 * Skill instructions returned as the `reason` field when blocking stop.
 * These are concise directives — the skills contain full workflow logic.
 */
const SKILL_INSTRUCTIONS = {
	validation_required:
		"Changes detected, you must use the `gauntlet-run` skill to validate them now.",
	pr_push_required:
		"Gauntlet passed. You must use the `gauntlet-push-pr` skill to create or update your pull request.",
	pr_push_required_with_warnings:
		"Gauntlet passed with warnings (some issues were skipped). You must use the `gauntlet-push-pr` skill to create or update your pull request. Include a summary of skipped issues in the PR description.",
	ci_pending:
		"PR is up to date. You must use the `gauntlet-fix-pr` skill to wait for CI and fix any failures.",
	ci_failed:
		"PR is up to date. You must use the `gauntlet-fix-pr` skill to wait for CI and fix any failures.",
} as const;

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

/**
 * Get a logger for stop-hook operations.
 */
function getStopHookLogger() {
	return getCategoryLogger("stop-hook");
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
	ci_pending: "⏳ CI checks still running — waiting for completion.",
	ci_failed: "✗ CI failed or review changes requested — fix issues and push.",
	ci_passed: "✓ CI passed — all checks completed and no blocking reviews.",
	validation_required:
		"✗ Validation required — changes detected that need validation before stopping.",
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
 * Get resolved stop hook config with 3-tier precedence.
 */
async function getResolvedStopHookConfig(
	projectCwd: string,
): Promise<StopHookConfig | null> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const raw = YAML.parse(content) as { stop_hook?: Record<string, unknown> };
		const projectStopHookConfig = raw?.stop_hook as
			| { auto_push_pr?: boolean; auto_fix_pr?: boolean }
			| undefined;
		const globalConfig = await loadGlobalConfig();
		return resolveStopHookConfig(projectStopHookConfig, globalConfig);
	} catch {
		return null;
	}
}

/**
 * Check if we should verify PR status after gates pass.
 * Loads stop hook config with 3-tier precedence and checks auto_push_pr.
 */
async function shouldCheckPR(projectCwd: string): Promise<boolean> {
	const config = await getResolvedStopHookConfig(projectCwd);
	return config?.auto_push_pr ?? false;
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

		// Only consider OPEN PRs - closed/merged PRs should not block stop
		if (prInfo.state !== "OPEN") {
			return { prExists: false, upToDate: false };
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
 * Check CI status for the current branch's PR via a single `gh pr checks` read.
 * No polling loop, no cross-invocation state. Returns status immediately.
 */
export async function checkCIStatus(cwd: string): Promise<{
	status: "passed" | "pending" | "failed" | "error";
	error?: string;
}> {
	try {
		const { stdout } = await execFileAsync(
			"gh",
			["pr", "checks", "--json", "name,state"],
			{ cwd },
		);

		const checks = JSON.parse(stdout.trim()) as Array<{
			name: string;
			state: string;
		}>;

		if (checks.length === 0) {
			// No checks configured — treat as passed
			return { status: "passed" };
		}

		const hasFailed = checks.some(
			(c) => c.state === "FAILURE" || c.state === "ERROR",
		);
		if (hasFailed) return { status: "failed" };

		const hasPending = checks.some(
			(c) => c.state === "PENDING" || c.state === "EXPECTED",
		);
		if (hasPending) return { status: "pending" };

		return { status: "passed" };
	} catch (e: unknown) {
		const errMsg = (e as { message?: string }).message ?? "unknown";
		return { status: "error", error: errMsg };
	}
}

/**
 * Core stop hook handler that reads state and determines whether to block stop.
 * Protocol-agnostic: works with any adapter that provides a StopHookContext.
 *
 * This handler is stateless — it only READS state (logs, execution state,
 * PR status, CI status) and returns skill instructions. It never executes
 * gates, polls CI, or tracks attempts.
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
	 * Set the log directory (needed for state reads).
	 */
	setLogDir(logDir: string): void {
		this.logDir = logDir;
	}

	/**
	 * Read state and determine whether to block the stop.
	 * Returns a skill instruction when blocking, or allows the stop.
	 */
	async execute(ctx: StopHookContext): Promise<StopHookResult> {
		const log = getStopHookLogger();
		const logDir = this.logDir;

		if (!logDir) {
			log.warn("No logDir set — allowing stop");
			return this.allow("passed");
		}

		// Load stop hook config
		const config = await getResolvedStopHookConfig(ctx.cwd);

		// Step 1: Check if stop hook is disabled
		if (config && !config.enabled) {
			return this.allow("stop_hook_disabled");
		}

		// Step 2: Check for failed run logs
		const hasLogs = await hasFailedRunLogs(logDir);
		if (hasLogs) {
			log.info("Failed run logs found — blocking with validation_required");
			return this.block(
				"validation_required",
				SKILL_INSTRUCTIONS.validation_required,
			);
		}

		// Step 3: Check run interval (only when no failed logs)
		if (config && config.run_interval_minutes > 0) {
			const intervalElapsed = await checkRunInterval(
				logDir,
				config.run_interval_minutes,
			);
			if (!intervalElapsed) {
				log.info(
					`Run interval (${config.run_interval_minutes} min) not elapsed — allowing stop`,
				);
				return this.allow("interval_not_elapsed", {
					intervalMinutes: config.run_interval_minutes,
				});
			}
		}

		// Step 4: Check for changes since last passing run
		const changesResult = await hasChangesSinceLastRun(logDir);
		if (changesResult === null) {
			// No execution state — check vs base branch
			const projectConfig = await readProjectConfig(ctx.cwd);
			const baseBranch = projectConfig?.base_branch ?? "origin/main";
			const hasChanges = await hasChangesVsBaseBranch(ctx.cwd, baseBranch);
			if (hasChanges) {
				log.info("Changes detected vs base branch (no prior state) — blocking");
				return this.block(
					"validation_required",
					SKILL_INSTRUCTIONS.validation_required,
				);
			}
			log.info("No changes vs base branch — allowing stop");
			return this.allow("passed");
		}

		if (changesResult) {
			log.info("Changes detected since last passing run — blocking");
			return this.block(
				"validation_required",
				SKILL_INSTRUCTIONS.validation_required,
			);
		}

		// Step 5: Check PR status (if auto_push_pr enabled)
		if (config?.auto_push_pr) {
			const prStatus = await checkPRStatus(ctx.cwd);
			if (prStatus.error) {
				log.warn(`PR status check failed: ${prStatus.error} — allowing stop`);
			} else if (!prStatus.prExists || !prStatus.upToDate) {
				log.info("PR missing or outdated — blocking with pr_push_required");
				const lastStatus = await getLastRunStatus(logDir);
				const instruction =
					lastStatus === "passed_with_warnings"
						? SKILL_INSTRUCTIONS.pr_push_required_with_warnings
						: SKILL_INSTRUCTIONS.pr_push_required;
				return this.block("pr_push_required", instruction);
			} else if (config.auto_fix_pr) {
				// Step 6: Check CI status (if auto_fix_pr enabled, single read)
				const ciResult = await checkCIStatus(ctx.cwd);
				if (ciResult.status === "error") {
					log.warn(`CI status check failed: ${ciResult.error} — allowing stop`);
				} else if (ciResult.status === "pending") {
					log.info("CI pending — blocking");
					return this.block("ci_pending", SKILL_INSTRUCTIONS.ci_pending);
				} else if (ciResult.status === "failed") {
					log.info("CI failed — blocking");
					return this.block("ci_failed", SKILL_INSTRUCTIONS.ci_failed);
				}
				// CI passed
				log.info("CI passed — allowing stop");
				return this.allow("ci_passed");
			}
		}

		// Step 7: Allow stop
		log.info("All checks passed — allowing stop");
		return this.allow("passed");
	}

	/** Create a blocking result */
	private block(status: GauntletStatus, reason: string): StopHookResult {
		this.debugLogger?.logStopHook("block", status);
		return {
			status,
			shouldBlock: true,
			reason,
			message: getStatusMessage(status),
		};
	}

	/** Create an allowing result */
	private allow(
		status: GauntletStatus,
		context?: { intervalMinutes?: number },
	): StopHookResult {
		this.debugLogger?.logStopHook("allow", status);
		return {
			status,
			shouldBlock: false,
			message: getStatusMessage(status, context),
			intervalMinutes: context?.intervalMinutes,
		};
	}
}

// Re-export types and functions for backward compatibility
export type { PRStatusResult };
export { checkPRStatus, shouldCheckPR };

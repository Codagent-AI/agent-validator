import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadGlobalConfig } from "../config/global.js";
import { executeRun } from "../core/run-executor.js";
import {
	getCategoryLogger,
	initLogger,
	resetLogger,
} from "../output/app-logger.js";
import {
	type GauntletStatus,
	isBlockingStatus,
	type RunResult,
} from "../types/gauntlet-status.js";
import { DebugLogger, mergeDebugLogConfig } from "../utils/debug-log.js";

interface StopHookInput {
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	permission_mode?: string;
	hook_event_name?: string;
	stop_hook_active?: boolean;
}

interface HookResponse {
	decision: "block" | "approve";
	reason?: string; // This becomes the prompt fed back to Claude (for blocking)
	stopReason: string; // Displayed to user when blocking - detailed instructions
	systemMessage?: string; // Always displayed to user - human-friendly status message
	status: GauntletStatus; // Machine-readable status code (unified type)
	message: string; // Human-friendly explanation (same as systemMessage, for internal use)
}

interface MinimalConfig {
	log_dir?: string;
	debug_log?: {
		enabled?: boolean;
		max_size_mb?: number;
	};
}

/**
 * Timeout for reading stdin (in milliseconds).
 * Claude Code sends JSON input immediately on hook invocation.
 * The 5-second timeout is a safety net for edge cases where stdin is delayed.
 */
const STDIN_TIMEOUT_MS = 5000;

/**
 * Environment variable to prevent stop-hook recursion in child Claude processes.
 *
 * **How it works:**
 * When the gauntlet runs review gates, it spawns child Claude processes to analyze code.
 * These child processes inherit environment variables. If a child Claude tries to stop,
 * its stop hook would normally run the gauntlet again, potentially creating infinite
 * recursion or redundant checks.
 *
 * **Where it's set:**
 * - In `src/cli-adapters/claude.ts` when spawning Claude for review execution
 * - Set to "1" in the spawn/exec environment: `{ [GAUNTLET_STOP_HOOK_ACTIVE_ENV]: "1" }`
 *
 * **Effect:**
 * When this env var is set, stop-hooks exit immediately with "approve" decision,
 * skipping all validation. This is safe because:
 * 1. The parent gauntlet process is already running validation
 * 2. Child processes are short-lived review executors, not user sessions
 * 3. Debug logging is skipped to avoid polluting logs with child process entries
 */
export const GAUNTLET_STOP_HOOK_ACTIVE_ENV = "GAUNTLET_STOP_HOOK_ACTIVE";

/**
 * Default log directory when config doesn't specify one.
 */
const DEFAULT_LOG_DIR = "gauntlet_logs";

/**
 * Marker file to detect nested stop-hook invocations.
 *
 * **Why this exists:**
 * When the gauntlet spawns child Claude processes for code reviews, those child
 * processes may trigger stop hooks when they exit. Claude Code does NOT pass
 * environment variables to hooks, so GAUNTLET_STOP_HOOK_ACTIVE_ENV doesn't work.
 *
 * **How it works:**
 * 1. Stop-hook creates this file (containing PID) before running the gauntlet
 * 2. If another stop-hook fires during execution, it sees this file and fast-exits
 * 3. Stop-hook removes this file when complete (success, failure, or error)
 *
 * This prevents nested stop-hooks from attempting to run concurrent gauntlets
 * (which would hit lock_conflict anyway, but this is faster and quieter).
 */
const STOP_HOOK_MARKER_FILE = ".stop-hook-active";

/**
 * Read hook input from stdin with a timeout.
 *
 * **Claude Code Hook Protocol:**
 * Claude Code invokes stop hooks as shell commands and passes context via stdin
 * as newline-terminated JSON. The input includes:
 * - `cwd`: The project working directory (where Claude Code is running)
 * - `stop_hook_active`: True if already inside a stop hook context (see below)
 * - `session_id`, `transcript_path`: Session context (not currently used)
 *
 * **The `stop_hook_active` field (stdin):**
 * This is set by Claude Code itself when invoking a stop hook while already inside
 * a stop hook context. This is a second layer of infinite loop prevention (in addition
 * to the GAUNTLET_STOP_HOOK_ACTIVE env var). If true, we allow stop immediately.
 *
 * **Timeout behavior:**
 * This function reads stdin with a 5-second timeout to handle cases where:
 * - Claude Code sends input quickly (normal case - resolves on newline)
 * - No input is sent (timeout returns empty string, allowing stop)
 * - stdin is already closed (returns immediately)
 *
 * The timeout ensures the stop hook doesn't hang indefinitely waiting for input.
 */
async function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		let resolved = false;

		const onEnd = () => cleanup(data.trim());
		const onError = () => cleanup("");

		const cleanup = (result: string) => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				process.stdin.removeListener("data", onData);
				process.stdin.removeListener("end", onEnd);
				process.stdin.removeListener("error", onError);
				resolve(result);
			}
		};

		const timeout = setTimeout(() => {
			cleanup(data.trim());
		}, STDIN_TIMEOUT_MS);

		const onData = (chunk: Buffer) => {
			data += chunk.toString();
			// Claude Code sends newline-terminated JSON
			if (data.includes("\n")) {
				cleanup(data.trim());
			}
		};

		process.stdin.on("data", onData);
		process.stdin.on("end", onEnd);
		process.stdin.on("error", onError);

		// Handle case where stdin is already closed or empty
		if (process.stdin.readableEnded) {
			cleanup(data.trim());
		}
	});
}

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the log_dir from project config without full validation.
 */
async function getLogDir(projectCwd: string): Promise<string> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const config = YAML.parse(content) as MinimalConfig;
		return config.log_dir || DEFAULT_LOG_DIR;
	} catch {
		return DEFAULT_LOG_DIR;
	}
}

/**
 * Read the debug_log config from project config without full validation.
 */
async function getDebugLogConfig(
	projectCwd: string,
): Promise<MinimalConfig["debug_log"]> {
	try {
		const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
		const content = await fs.readFile(configPath, "utf-8");
		const config = YAML.parse(content) as MinimalConfig;
		return config.debug_log;
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
function getStopReasonInstructions(
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
 * Get a human-friendly message for each status code.
 * These messages explain why the stop was approved or blocked.
 */
function getStatusMessage(
	status: GauntletStatus,
	context?: { intervalMinutes?: number; errorMessage?: string },
): string {
	switch (status) {
		case "passed":
			return "✓ Gauntlet passed — all gates completed successfully.";
		case "passed_with_warnings":
			return "✓ Gauntlet completed — passed with warnings (some issues were skipped).";
		case "no_applicable_gates":
			return "✓ Gauntlet passed — no applicable gates matched current changes.";
		case "no_changes":
			return "✓ Gauntlet passed — no changes detected.";
		case "retry_limit_exceeded":
			return "⚠ Gauntlet terminated — retry limit exceeded. Run `agent-gauntlet clean` to archive and continue.";
		case "interval_not_elapsed":
			return context?.intervalMinutes
				? `⏭ Gauntlet skipped — run interval (${context.intervalMinutes} min) not elapsed since last run.`
				: "⏭ Gauntlet skipped — run interval not elapsed since last run.";
		case "lock_conflict":
			return "⏭ Gauntlet skipped — another gauntlet run is already in progress.";
		case "failed":
			return "✗ Gauntlet failed — issues must be fixed before stopping.";
		case "no_config":
			return "○ Not a gauntlet project — no .gauntlet/config.yml found.";
		case "stop_hook_active":
			return "↺ Stop hook cycle detected — allowing stop to prevent infinite loop.";
		case "error":
			return context?.errorMessage
				? `⚠ Stop hook error — ${context.errorMessage}`
				: "⚠ Stop hook error — unexpected error occurred.";
		case "invalid_input":
			return "⚠ Invalid hook input — could not parse JSON, allowing stop.";
	}
}

/**
 * Output a hook response to stdout.
 * Uses the Claude Code hook protocol format:
 * - decision: "block" | "approve" - whether to block or allow the stop
 * - reason: string - when blocking, this becomes the prompt fed back to Claude automatically
 * - stopReason: string - always displayed to user regardless of decision
 * - status: machine-readable status code for transparency (unified GauntletStatus)
 * - message: human-friendly explanation of the outcome
 */
function outputHookResponse(
	status: GauntletStatus,
	options?: {
		reason?: string;
		intervalMinutes?: number;
		errorMessage?: string;
	},
): void {
	const block = isBlockingStatus(status);
	const message = getStatusMessage(status, {
		intervalMinutes: options?.intervalMinutes,
		errorMessage: options?.errorMessage,
	});

	// For blocking status with detailed instructions, use those as stopReason
	// For non-blocking statuses, use the human-friendly message as stopReason
	const stopReason = block && options?.reason ? options.reason : message;

	const response: HookResponse = {
		decision: block ? "block" : "approve",
		stopReason,
		systemMessage: message,
		status,
		message,
	};
	if (options?.reason) {
		response.reason = options.reason;
	}
	console.log(JSON.stringify(response));
}

/**
 * Get a logger for stop-hook operations.
 * In stop-hook mode, this only writes to file (no console output).
 */
function getStopHookLogger() {
	return getCategoryLogger("stop-hook");
}

// Export for testing
export { getStopReasonInstructions, outputHookResponse, getStatusMessage };
export type { GauntletStatus as StopHookStatus, HookResponse };

export function registerStopHookCommand(program: Command): void {
	program
		.command("stop-hook")
		.description("Claude Code stop hook - validates gauntlet completion")
		.action(async () => {
			let debugLogger: DebugLogger | null = null;
			let loggerInitialized = false;
			let markerFilePath: string | null = null; // Track marker file for cleanup
			const log = getStopHookLogger();

			// Capture diagnostic info early for later logging
			const diagnostics = {
				pid: process.pid,
				ppid: process.ppid,
				envVarSet: !!process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV],
				processCwd: process.cwd(),
				rawStdin: "",
				stdinSessionId: undefined as string | undefined,
				stdinStopHookActive: undefined as boolean | undefined,
				stdinCwd: undefined as string | undefined,
				stdinHookEventName: undefined as string | undefined,
			};

			try {
				// ============================================================
				// FAST EXIT CHECKS (no stdin read, no debug logging)
				// These checks allow quick exit without the 5-second stdin timeout
				// ============================================================

				// TODO: The env var is not working reliably so we added STOP_HOOK_MARKER_FILE; repurpose the env var check to allow users to disable the stop hook at env level.

				// 1. Check env var FIRST - fast exit for child Claude processes
				// When gauntlet spawns Claude for reviews, child processes have this set
				if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
					outputHookResponse("stop_hook_active");
					return;
				}

				// 2. Check if this is a gauntlet project BEFORE reading stdin
				// This avoids the 5-second stdin timeout for non-gauntlet projects
				// Use process.cwd() since that's where Claude Code runs the hook
				const quickConfigCheck = path.join(
					process.cwd(),
					".gauntlet",
					"config.yml",
				);
				if (!(await fileExists(quickConfigCheck))) {
					// Not a gauntlet project - allow stop without reading stdin
					outputHookResponse("no_config");
					return;
				}

				// 3. Check marker file - fast exit for nested stop-hooks
				// This catches child Claude processes whose stop hooks fire during gauntlet
				// (Claude Code doesn't pass env vars to hooks, so we use a file-based signal)
				const markerLogDir = await getLogDir(process.cwd());
				const markerPath = path.join(
					process.cwd(),
					markerLogDir,
					STOP_HOOK_MARKER_FILE,
				);
				if (await fileExists(markerPath)) {
					outputHookResponse("stop_hook_active");
					return;
				}

				// ============================================================
				// STDIN PARSING (only for gauntlet projects)
				// ============================================================

				// 3. Read stdin JSON - now we know it's a gauntlet project
				const input = await readStdin();
				diagnostics.rawStdin = input;

				let hookInput: StopHookInput = {};
				try {
					if (input.trim()) {
						hookInput = JSON.parse(input);
						// Capture parsed fields for diagnostics
						diagnostics.stdinSessionId = hookInput.session_id;
						diagnostics.stdinStopHookActive = hookInput.stop_hook_active;
						diagnostics.stdinCwd = hookInput.cwd;
						diagnostics.stdinHookEventName = hookInput.hook_event_name;
					}
				} catch {
					// Invalid JSON - allow stop to avoid blocking on parse errors
					log.info("Invalid hook input, allowing stop");
					outputHookResponse("invalid_input");
					return;
				}

				// 4. Check stop_hook_active from stdin (Claude Code's loop prevention)
				// No debug logging here - would pollute logs with hook cycle entries
				if (hookInput.stop_hook_active) {
					outputHookResponse("stop_hook_active");
					return;
				}

				// ============================================================
				// GAUNTLET EXECUTION (full validation with logging)
				// ============================================================

				log.info("Starting gauntlet validation...");

				// 5. Determine project directory (use hook-provided cwd if different)
				// Re-check config if cwd differs from process.cwd()
				const projectCwd = hookInput.cwd ?? process.cwd();
				if (hookInput.cwd && hookInput.cwd !== process.cwd()) {
					const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
					if (!(await fileExists(configPath))) {
						log.info("No gauntlet config found at hook cwd, allowing stop");
						outputHookResponse("no_config");
						return;
					}
				}

				// 6. Get log directory from project config (for debug logging)
				const logDir = path.join(projectCwd, await getLogDir(projectCwd));

				// Initialize app logger in stop-hook mode (file-only, no console output)
				await initLogger({
					mode: "stop-hook",
					logDir,
				});
				loggerInitialized = true;

				// Initialize debug logger for stop-hook
				const globalConfig = await loadGlobalConfig();
				const projectDebugLogConfig = await getDebugLogConfig(projectCwd);
				const debugLogConfig = mergeDebugLogConfig(
					projectDebugLogConfig,
					globalConfig.debug_log,
				);
				debugLogger = new DebugLogger(logDir, debugLogConfig);

				// Log diagnostic info to help debug duplicate stop-hook triggers
				await debugLogger.logStopHookDiagnostics(diagnostics);

				await debugLogger.logCommand("stop-hook", []);

				// 7. Create marker file to signal nested stop-hooks to fast-exit
				markerFilePath = path.join(logDir, STOP_HOOK_MARKER_FILE);
				try {
					await fs.writeFile(markerFilePath, `${process.pid}`, "utf-8");
				} catch {
					// Ignore - marker is best-effort
					markerFilePath = null;
				}

				// 8. Run gauntlet (executor handles lock, interval, config loading)
				log.info("Running gauntlet gates...");
				let result: RunResult;
				try {
					result = await executeRun({
						cwd: projectCwd,
						checkInterval: true,
					});
				} finally {
					// Clean up marker file regardless of success/failure
					if (markerFilePath) {
						try {
							await fs.rm(markerFilePath, { force: true });
						} catch {
							// Ignore
						}
						markerFilePath = null;
					}
				}

				// 9. Handle results using unified GauntletStatus directly
				log.info(`Gauntlet completed with status: ${result.status}`);
				await debugLogger.logStopHook(
					isBlockingStatus(result.status) ? "block" : "allow",
					result.status,
				);

				// Use gate results from executor for detailed failure instructions
				outputHookResponse(result.status, {
					reason:
						result.status === "failed"
							? getStopReasonInstructions(result.gateResults)
							: undefined,
					errorMessage: result.errorMessage,
					intervalMinutes: result.intervalMinutes,
				});

				// Clean up logger (do not let cleanup errors break protocol)
				if (loggerInitialized) {
					try {
						await resetLogger();
					} catch {
						// Ignore cleanup errors
					}
				}
			} catch (error: unknown) {
				// On any unexpected error, allow stop to avoid blocking indefinitely
				const err = error as { message?: string };
				const errorMessage = err.message || "unknown error";
				log.error(`Stop hook error: ${errorMessage}`);
				await debugLogger?.logStopHook("allow", `error: ${errorMessage}`);
				outputHookResponse("error", { errorMessage });

				// Clean up marker file if it was created
				if (markerFilePath) {
					try {
						await fs.rm(markerFilePath, { force: true });
					} catch {
						// Ignore
					}
				}

				// Clean up logger (do not let cleanup errors break protocol)
				if (loggerInitialized) {
					try {
						await resetLogger();
					} catch {
						// Ignore cleanup errors
					}
				}
			}
		});
}

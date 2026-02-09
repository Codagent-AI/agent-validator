import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { loadGlobalConfig } from "../config/global.js";
import { ClaudeStopHookAdapter } from "../hooks/adapters/claude-stop-hook.js";
import { CursorStopHookAdapter } from "../hooks/adapters/cursor-stop-hook.js";
import type {
	StopHookAdapter,
	StopHookResult,
} from "../hooks/adapters/types.js";
import {
	getDebugLogConfig,
	getLogDir,
	getPushPRInstructions,
	getStatusMessage,
	getStopReasonInstructions,
	StopHookHandler,
} from "../hooks/stop-hook-handler.js";
import {
	getCategoryLogger,
	initLogger,
	resetLogger,
} from "../output/app-logger.js";
import {
	type GauntletStatus,
	isBlockingStatus,
} from "../types/gauntlet-status.js";
import { DebugLogger, mergeDebugLogConfig } from "../utils/debug-log.js";

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
 * Hard ceiling for the stop hook process.
 * If the process runs longer than this, it outputs an allow response and exits.
 * This prevents zombie processes when Claude Code times out reading stdout
 * but the process keeps running.
 */
const STOP_HOOK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Available adapters in detection order.
 * Cursor adapter is checked first because it has a positive detection (cursor_version present).
 * Claude adapter is the fallback (detected by absence of cursor_version).
 */
const adapters: StopHookAdapter[] = [
	new CursorStopHookAdapter(),
	new ClaudeStopHookAdapter(),
];

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
 * Get a logger for stop-hook operations.
 */
function getStopHookLogger() {
	return getCategoryLogger("stop-hook");
}

/**
 * Output a result using the given adapter's format.
 */
function outputResult(adapter: StopHookAdapter, result: StopHookResult): void {
	console.log(adapter.formatOutput(result));
}

/**
 * Create a simple result for early exit conditions.
 */
function createEarlyExitResult(
	status: GauntletStatus,
	options?: { intervalMinutes?: number; errorMessage?: string },
): StopHookResult {
	return {
		status,
		shouldBlock: false,
		message: getStatusMessage(status, options),
		intervalMinutes: options?.intervalMinutes,
	};
}

/**
 * Output a hook response to stdout using Claude protocol format.
 * This is the legacy API for backward compatibility.
 * Uses the Claude Code hook protocol format:
 * - decision: "block" | "approve" - whether to block or allow the stop
 * - reason: string - when blocking, this becomes the prompt fed back to Claude automatically
 * - stopReason: string - always displayed to user regardless of decision
 * - status: machine-readable status code for transparency (unified GauntletStatus)
 * - message: human-friendly explanation of the outcome
 */
export function outputHookResponse(
	status: GauntletStatus,
	options?: {
		reason?: string;
		intervalMinutes?: number;
		errorMessage?: string;
	},
): void {
	const claudeAdapter = new ClaudeStopHookAdapter();
	const shouldBlock = isBlockingStatus(status);
	const message = getStatusMessage(status, {
		intervalMinutes: options?.intervalMinutes,
		errorMessage: options?.errorMessage,
	});

	const result: StopHookResult = {
		status,
		shouldBlock,
		message,
		instructions: options?.reason,
		pushPRReason: status === "pr_push_required" ? options?.reason : undefined,
		intervalMinutes: options?.intervalMinutes,
	};

	console.log(claudeAdapter.formatOutput(result));
}

// Export for testing
export { getStopReasonInstructions, getStatusMessage, getPushPRInstructions };
export type {
	GauntletStatus as StopHookStatus,
	StopHookResult as HookResponse,
};

// Re-export PRStatusResult from handler for backward compatibility
export type { PRStatusResult } from "../hooks/stop-hook-handler.js";

// Re-export checkPRStatus for testing
export { checkPRStatus } from "../hooks/stop-hook-handler.js";

export function registerStopHookCommand(program: Command): void {
	program
		.command("stop-hook")
		.description("Claude Code stop hook - validates gauntlet completion")
		.action(async () => {
			// Default to Claude adapter for error handling before detection
			let adapter: StopHookAdapter = adapters[1] as StopHookAdapter;
			let debugLogger: DebugLogger | null = null;
			let loggerInitialized = false;
			let markerFilePath: string | null = null;
			const log = getStopHookLogger();

			// Self-timeout: kill this process if it runs too long.
			// Claude Code may timeout reading stdout, but the process keeps running
			// as a zombie holding the lock and marker file.
			const selfTimeout = setTimeout(() => {
				// Clean up marker file synchronously before exiting
				if (markerFilePath) {
					try {
						fsSync.rmSync(markerFilePath, { force: true });
					} catch {
						// Best-effort cleanup
					}
				}
				outputResult(
					adapter,
					createEarlyExitResult("error", {
						errorMessage: "stop hook timed out",
					}),
				);
				process.exit(0);
			}, STOP_HOOK_TIMEOUT_MS);
			selfTimeout.unref();

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
				// FAST EXIT CHECKS (no stdin read, minimal logging)
				// These checks allow quick exit without the 5-second stdin timeout
				// ============================================================

				// 1. Check env var FIRST - fast exit for child Claude processes
				if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
					outputResult(adapter, createEarlyExitResult("stop_hook_active"));
					return;
				}

				// 2. Check if this is a gauntlet project BEFORE reading stdin
				const quickConfigCheck = path.join(
					process.cwd(),
					".gauntlet",
					"config.yml",
				);
				if (!(await fileExists(quickConfigCheck))) {
					outputResult(adapter, createEarlyExitResult("no_config"));
					return;
				}

				// ============================================================
				// EARLY DEBUG LOGGER INIT (before marker/stdin checks)
				// ============================================================
				const earlyLogDir = path.join(
					process.cwd(),
					await getLogDir(process.cwd()),
				);
				try {
					const globalConfig = await loadGlobalConfig();
					const projectDebugLogConfig = await getDebugLogConfig(process.cwd());
					const debugLogConfig = mergeDebugLogConfig(
						projectDebugLogConfig,
						globalConfig.debug_log,
					);
					debugLogger = new DebugLogger(earlyLogDir, debugLogConfig);
				} catch (initErr: unknown) {
					log.warn(
						`Debug logger init failed: ${(initErr as { message?: string }).message ?? "unknown"}`,
					);
				}

				await debugLogger?.logCommand("stop-hook", []);

				// 3. Check marker file - fast exit for nested stop-hooks
				const markerLogDir = await getLogDir(process.cwd());
				const markerPath = path.join(
					process.cwd(),
					markerLogDir,
					STOP_HOOK_MARKER_FILE,
				);
				if (await fileExists(markerPath)) {
					const STALE_MARKER_MS = 10 * 60 * 1000;
					try {
						const stat = await fs.stat(markerPath);
						const ageMs = Date.now() - stat.mtimeMs;
						if (ageMs > STALE_MARKER_MS) {
							await debugLogger?.logStopHookEarlyExit(
								"marker_stale",
								"proceeding",
								`age=${Math.round(ageMs / 1000)}s threshold=${Math.round(STALE_MARKER_MS / 1000)}s`,
							);
							await fs.rm(markerPath, { force: true });
						} else {
							await debugLogger?.logStopHookEarlyExit(
								"marker_fresh",
								"stop_hook_active",
								`age=${Math.round(ageMs / 1000)}s`,
							);
							outputResult(adapter, createEarlyExitResult("stop_hook_active"));
							return;
						}
					} catch (markerErr: unknown) {
						const errMsg =
							(markerErr as { message?: string }).message ?? "unknown";
						await debugLogger?.logStopHookEarlyExit(
							"marker_stat_error",
							"stop_hook_active",
							`error=${errMsg}`,
						);
						outputResult(adapter, createEarlyExitResult("stop_hook_active"));
						return;
					}
				}

				// ============================================================
				// STDIN PARSING AND ADAPTER DETECTION
				// ============================================================

				const input = await readStdin();
				diagnostics.rawStdin = input;

				let parsed: Record<string, unknown> = {};
				try {
					if (input.trim()) {
						parsed = JSON.parse(input);
						// Capture parsed fields for diagnostics
						diagnostics.stdinSessionId = parsed.session_id as
							| string
							| undefined;
						diagnostics.stdinStopHookActive = parsed.stop_hook_active as
							| boolean
							| undefined;
						diagnostics.stdinCwd = parsed.cwd as string | undefined;
						diagnostics.stdinHookEventName = parsed.hook_event_name as
							| string
							| undefined;
					}
				} catch (parseErr: unknown) {
					const errMsg =
						(parseErr as { message?: string }).message ?? "unknown";
					log.info(`Invalid hook input (${errMsg}), allowing stop`);
					await debugLogger?.logStopHookEarlyExit(
						"stdin_parse_error",
						"invalid_input",
						`error=${errMsg}`,
					);
					outputResult(adapter, createEarlyExitResult("invalid_input"));
					return;
				}

				// Detect protocol and select adapter
				// biome-ignore lint/style/noNonNullAssertion: adapters array always has index 1
				adapter = adapters.find((a) => a.detect(parsed)) ?? adapters[1]!;

				// Parse input using selected adapter
				const ctx = adapter.parseInput(parsed);

				// Check for adapter-specific early exit (e.g., Cursor loop_count)
				const skipResult = adapter.shouldSkipExecution(ctx);
				if (skipResult) {
					await debugLogger?.logStopHookEarlyExit(
						"adapter_skip",
						skipResult.status,
						`adapter=${adapter.name}`,
					);
					outputResult(adapter, skipResult);
					return;
				}

				// ============================================================
				// GAUNTLET EXECUTION
				// ============================================================

				log.info("Starting gauntlet validation...");

				// Re-check config if cwd differs from process.cwd()
				const projectCwd = ctx.cwd;
				if (ctx.cwd !== process.cwd()) {
					const configPath = path.join(projectCwd, ".gauntlet", "config.yml");
					if (!(await fileExists(configPath))) {
						log.info("No gauntlet config found at hook cwd, allowing stop");
						await debugLogger?.logStopHookEarlyExit(
							"no_config_at_cwd",
							"no_config",
							`cwd=${projectCwd}`,
						);
						outputResult(adapter, createEarlyExitResult("no_config"));
						return;
					}
				}

				// Get log directory from project config
				const logDir = path.join(projectCwd, await getLogDir(projectCwd));

				// Initialize app logger in stop-hook mode
				await initLogger({
					mode: "stop-hook",
					logDir,
				});
				loggerInitialized = true;

				// Re-init debug logger with the final logDir if cwd differed
				if (logDir !== earlyLogDir) {
					try {
						const globalCfg = await loadGlobalConfig();
						const projDbgCfg = await getDebugLogConfig(projectCwd);
						const dbgCfg = mergeDebugLogConfig(projDbgCfg, globalCfg.debug_log);
						debugLogger = new DebugLogger(logDir, dbgCfg);
					} catch (reinitErr: unknown) {
						log.warn(
							`Debug logger re-init failed: ${(reinitErr as { message?: string }).message ?? "unknown"}`,
						);
					}
				}

				// Log diagnostic info
				await debugLogger?.logStopHookDiagnostics(diagnostics);

				// Create marker file to signal nested stop-hooks to fast-exit
				markerFilePath = path.join(logDir, STOP_HOOK_MARKER_FILE);
				try {
					await fs.writeFile(markerFilePath, `${process.pid}`, "utf-8");
				} catch (mkErr: unknown) {
					const errMsg = (mkErr as { message?: string }).message ?? "unknown";
					log.warn(`Failed to create marker file: ${errMsg}`);
					markerFilePath = null;
				}

				// Execute handler (includes gauntlet run + post-gauntlet PR check)
				log.info("Running gauntlet gates...");
				const handler = new StopHookHandler(debugLogger ?? undefined);
				handler.setLogDir(logDir); // Pass logDir for execution state refresh
				let result: StopHookResult;
				try {
					result = await handler.execute(ctx);
				} finally {
					// Clean up marker file regardless of success/failure
					if (markerFilePath) {
						try {
							await fs.rm(markerFilePath, { force: true });
						} catch (rmErr: unknown) {
							const errMsg =
								(rmErr as { message?: string }).message ?? "unknown";
							log.warn(`Failed to remove marker file: ${errMsg}`);
						}
						markerFilePath = null;
					}
				}

				// Output result using adapter format
				outputResult(adapter, result);

				// Clean up logger
				if (loggerInitialized) {
					try {
						await resetLogger();
					} catch (resetErr: unknown) {
						const resetMsg =
							(resetErr as { message?: string }).message ?? "unknown";
						log.warn(`Logger reset failed: ${resetMsg}`);
					}
				}
			} catch (error: unknown) {
				// On any unexpected error, allow stop to avoid blocking indefinitely
				const err = error as { message?: string };
				const errorMessage = err.message || "unknown error";
				log.error(`Stop hook error: ${errorMessage}`);
				await debugLogger?.logStopHook("allow", `error: ${errorMessage}`);
				outputResult(adapter, createEarlyExitResult("error", { errorMessage }));

				// Clean up marker file if it was created
				if (markerFilePath) {
					try {
						await fs.rm(markerFilePath, { force: true });
					} catch (rmErr: unknown) {
						const rmMsg = (rmErr as { message?: string }).message ?? "unknown";
						log.warn(`Failed to remove marker file in error handler: ${rmMsg}`);
					}
				}

				// Clean up logger
				if (loggerInitialized) {
					try {
						await resetLogger();
					} catch (resetErr: unknown) {
						const resetMsg =
							(resetErr as { message?: string }).message ?? "unknown";
						process.stderr.write(
							`stop-hook: logger reset failed: ${resetMsg}\n`,
						);
					}
				}
			} finally {
				clearTimeout(selfTimeout);
			}
		});
}

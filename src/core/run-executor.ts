import fs from "node:fs/promises";
import path from "node:path";
import {
	cleanLogs,
	hasExistingLogs,
	performAutoClean,
	releaseLock,
	shouldAutoClean,
} from "../commands/shared.js";
import { loadGlobalConfig } from "../config/global.js";
import { loadConfig } from "../config/loader.js";
import { resolveStopHookConfig } from "../config/stop-hook-config.js";
import {
	getCategoryLogger,
	initLogger,
	isLoggerConfigured,
	resetLogger,
} from "../output/app-logger.js";
import { ConsoleReporter } from "../output/console.js";
import {
	type ConsoleLogHandle,
	startConsoleLog,
} from "../output/console-log.js";
import { Logger } from "../output/logger.js";
import type { GauntletStatus, RunResult } from "../types/gauntlet-status.js";
import {
	getDebugLogger,
	initDebugLogger,
	mergeDebugLogConfig,
} from "../utils/debug-log.js";
import {
	readExecutionState,
	resolveFixBase,
	writeExecutionState,
} from "../utils/execution-state.js";
import {
	findPreviousFailures,
	hasSkippedViolationsInLogs,
	type PassedSlot,
	type PreviousViolation,
} from "../utils/log-parser.js";
import { ChangeDetector } from "./change-detector.js";
import { computeDiffStats } from "./diff-stats.js";
import { EntryPointExpander } from "./entry-point.js";
import { JobGenerator } from "./job.js";
import { Runner } from "./runner.js";

const LOCK_FILENAME = ".gauntlet-run.lock";

export interface ExecuteRunOptions {
	baseBranch?: string;
	gate?: string;
	commit?: string;
	uncommitted?: boolean;
	/** Working directory for config loading (defaults to process.cwd()) */
	cwd?: string;
	/**
	 * When true, check if run interval has elapsed before proceeding.
	 * Only stop-hook uses this; CLI commands (run, check, review) always run immediately.
	 * If interval hasn't elapsed, returns { status: "interval_not_elapsed", ... }.
	 */
	checkInterval?: boolean;
}

/**
 * Maximum age for a lock file before it's considered stale (10 minutes).
 * Matches the stale marker threshold in stop-hook.ts.
 */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Check if a process with the given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0); // Signal 0 = check existence without killing
		return true;
	} catch (err: unknown) {
		// EPERM means the process exists but we lack permission to signal it
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EPERM"
		) {
			return true;
		}
		// ESRCH or other errors mean the process doesn't exist
		return false;
	}
}

/**
 * Acquire the lock file. Returns true if successful, false if lock exists.
 * Unlike acquireLock() in shared.ts, this doesn't call process.exit().
 *
 * If the lock file already exists, checks for staleness:
 * - If the PID in the lock file is no longer alive, removes the lock and retries.
 * - If the lock file is older than STALE_LOCK_MS, removes the lock and retries.
 * This prevents zombie processes from holding locks indefinitely.
 */
async function tryAcquireLock(logDir: string): Promise<boolean> {
	await fs.mkdir(logDir, { recursive: true });
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EEXIST"
		) {
			// Lock exists — check if the holding process is still alive
			try {
				const lockContent = await fs.readFile(lockPath, "utf-8");
				const lockPid = parseInt(lockContent.trim(), 10);
				const lockStat = await fs.stat(lockPath);
				const lockAgeMs = Date.now() - lockStat.mtimeMs;

				const pidValid = !Number.isNaN(lockPid);
				const pidDead = pidValid && !isProcessAlive(lockPid);
				// Only use time-based staleness when we can't determine the PID
				// (e.g. lock file is empty or contains non-numeric content).
				// If the PID is valid and alive, never steal the lock regardless of age.
				const lockStale = !pidValid && lockAgeMs > STALE_LOCK_MS;

				if (pidDead || lockStale) {
					// Stale lock — remove and retry once
					await fs.rm(lockPath, { force: true });
					try {
						await fs.writeFile(lockPath, String(process.pid), {
							flag: "wx",
						});
						return true;
					} catch {
						// Another process beat us to it
						return false;
					}
				}
			} catch {
				// Can't read/stat lock file — treat as active lock
			}
			return false;
		}
		throw err;
	}
}

/**
 * Find the latest console.N.log file in the log directory.
 */
async function findLatestConsoleLog(logDir: string): Promise<string | null> {
	try {
		const files = await fs.readdir(logDir);
		let maxNum = -1;
		let latestFile: string | null = null;

		for (const file of files) {
			if (!file.startsWith("console.") || !file.endsWith(".log")) {
				continue;
			}
			const middle = file.slice("console.".length, file.length - ".log".length);
			if (/^\d+$/.test(middle)) {
				const n = parseInt(middle, 10);
				if (n > maxNum) {
					maxNum = n;
					latestFile = file;
				}
			}
		}

		return latestFile ? path.join(logDir, latestFile) : null;
	} catch {
		return null;
	}
}

/**
 * Check if the run interval has elapsed since the last gauntlet run.
 * Returns true if gauntlet should run, false if interval hasn't elapsed.
 */
async function shouldRunBasedOnInterval(
	logDir: string,
	intervalMinutes: number,
): Promise<boolean> {
	const state = await readExecutionState(logDir);
	if (!state) {
		// No execution state = always run
		return true;
	}

	const lastRun = new Date(state.last_run_completed_at);
	// Handle invalid date (corrupted state) - treat as needing to run
	if (Number.isNaN(lastRun.getTime())) {
		return true;
	}

	const now = new Date();
	const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60);

	return elapsedMinutes >= intervalMinutes;
}

/**
 * Get status message for a given status.
 */
const statusMessages: Record<GauntletStatus, string> = {
	passed: "All gates passed.",
	passed_with_warnings: "Passed with warnings — some issues were skipped.",
	no_applicable_gates: "No applicable gates for these changes.",
	no_changes: "No changes detected.",
	failed: "Gates failed — issues must be fixed.",
	retry_limit_exceeded:
		"Retry limit exceeded — logs have been automatically archived.",
	lock_conflict: "Another gauntlet run is already in progress.",
	error: "Unexpected error occurred.",
	no_config: "No .gauntlet/config.yml found.",
	stop_hook_active: "Stop hook already active.",
	loop_detected: "Loop detected — rapid blocks overridden.",
	interval_not_elapsed: "Run interval not elapsed.",
	invalid_input: "Invalid input.",
	stop_hook_disabled: "",
	pr_push_required: "Gates passed — PR needs to be created/updated.",
	ci_pending: "CI checks still running.",
	ci_failed: "CI checks failed or review changes requested.",
	ci_passed: "CI checks passed, no blocking reviews.",
	validation_required:
		"Changes need validation or previous run has unresolved failures.",
};

function getStatusMessage(status: GauntletStatus): string {
	return statusMessages[status] || "Unknown status";
}

/**
 * Get the run executor logger.
 */
function getRunLogger() {
	return getCategoryLogger("run");
}

/**
 * Execute the gauntlet run logic. Returns a structured RunResult.
 * This function never calls process.exit() - the caller is responsible for that.
 */
export async function executeRun(
	options: ExecuteRunOptions = {},
): Promise<RunResult> {
	const { cwd } = options;
	let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
	let lockAcquired = false;
	let consoleLogHandle: ConsoleLogHandle | undefined;
	let loggerInitializedHere = false;
	const log = getRunLogger();

	try {
		config = await loadConfig(cwd);

		// Initialize app logger if not already configured (e.g., by stop-hook)
		if (!isLoggerConfigured()) {
			await initLogger({
				mode: "interactive",
				logDir: config.project.log_dir,
			});
			loggerInitializedHere = true;
		}

		// Initialize debug logger
		const globalConfig = await loadGlobalConfig();
		const debugLogConfig = mergeDebugLogConfig(
			config.project.debug_log,
			globalConfig.debug_log,
		);
		initDebugLogger(config.project.log_dir, debugLogConfig);

		// Log the command invocation
		const debugLogger = getDebugLogger();
		const args = [
			options.baseBranch ? `-b ${options.baseBranch}` : "",
			options.gate ? `-g ${options.gate}` : "",
			options.commit ? `-c ${options.commit}` : "",
			options.uncommitted ? "-u" : "",
			options.checkInterval ? "--check-interval" : "",
		].filter(Boolean);
		await debugLogger?.logCommand("run", args);

		// Interval check: only stop-hook passes checkInterval: true
		// CLI commands (run, check, review) always run immediately
		if (options.checkInterval) {
			// Resolve stop hook config from env > project > global
			const stopHookConfig = resolveStopHookConfig(
				config.project.stop_hook,
				globalConfig,
			);

			// Check if stop hook is disabled
			if (!stopHookConfig.enabled) {
				log.debug("Stop hook is disabled via configuration, skipping");
				// Clean up logger if we initialized it
				if (loggerInitializedHere) {
					await resetLogger();
				}
				return {
					status: "stop_hook_disabled",
					message: getStatusMessage("stop_hook_disabled"),
				};
			}

			const logsExist = await hasExistingLogs(config.project.log_dir);
			// Only check interval if there are no existing logs (not in rerun mode)
			// and interval > 0 (interval 0 means always run)
			if (!logsExist && stopHookConfig.run_interval_minutes > 0) {
				const intervalMinutes = stopHookConfig.run_interval_minutes;
				const shouldRun = await shouldRunBasedOnInterval(
					config.project.log_dir,
					intervalMinutes,
				);
				if (!shouldRun) {
					log.debug(
						`Run interval (${intervalMinutes} min) not elapsed, skipping`,
					);
					// Clean up logger if we initialized it
					if (loggerInitializedHere) {
						await resetLogger();
					}
					return {
						status: "interval_not_elapsed",
						message: `Run interval (${intervalMinutes} min) not elapsed.`,
						intervalMinutes,
					};
				}
			}
		}

		// Determine effective base branch first (needed for auto-clean)
		const effectiveBaseBranch =
			options.baseBranch ||
			(process.env.GITHUB_BASE_REF &&
			(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
				? process.env.GITHUB_BASE_REF
				: null) ||
			config.project.base_branch;

		// Auto-clean on context change (branch changed, commit merged)
		const autoCleanResult = await shouldAutoClean(
			config.project.log_dir,
			effectiveBaseBranch,
		);
		if (autoCleanResult.clean) {
			log.debug(`Auto-cleaning logs (${autoCleanResult.reason})...`);
			await debugLogger?.logClean("auto", autoCleanResult.reason || "unknown");
			await performAutoClean(
				config.project.log_dir,
				autoCleanResult,
				config.project.max_previous_logs,
			);
		}

		// Detect rerun mode after auto-clean (clean may have removed logs)
		const logsExist = await hasExistingLogs(config.project.log_dir);
		const isRerun = logsExist && !options.commit;

		// Try to acquire lock (non-exiting version)
		lockAcquired = await tryAcquireLock(config.project.log_dir);
		if (!lockAcquired) {
			// Clean up logger if we initialized it
			if (loggerInitializedHere) {
				await resetLogger();
			}
			return {
				status: "lock_conflict",
				message: getStatusMessage("lock_conflict"),
			};
		}

		// Lock acquired — wrap in try/finally to guarantee release on all paths
		try {
			// Initialize Logger early to get unified run number for console log
			const logger = new Logger(config.project.log_dir);
			await logger.init();
			const runNumber = logger.getRunNumber();

			consoleLogHandle = await startConsoleLog(
				config.project.log_dir,
				runNumber,
			);

			let failuresMap:
				| Map<string, Map<string, PreviousViolation[]>>
				| undefined;
			let changeOptions:
				| { commit?: string; uncommitted?: boolean; fixBase?: string }
				| undefined;

			let passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;

			if (isRerun) {
				log.debug("Existing logs detected — running in verification mode...");
				const { failures: previousFailures, passedSlots } =
					await findPreviousFailures(
						config.project.log_dir,
						options.gate,
						true,
					);

				failuresMap = new Map();
				for (const gateFailure of previousFailures) {
					const adapterMap = new Map<string, PreviousViolation[]>();
					for (const af of gateFailure.adapterFailures) {
						const key = af.reviewIndex
							? String(af.reviewIndex)
							: af.adapterName;
						adapterMap.set(key, af.violations);
					}
					failuresMap.set(gateFailure.jobId, adapterMap);
				}

				passedSlotsMap = passedSlots;

				if (previousFailures.length > 0) {
					const totalViolations = previousFailures.reduce(
						(sum, gf) =>
							sum +
							gf.adapterFailures.reduce((s, af) => s + af.violations.length, 0),
						0,
					);
					log.warn(
						`Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
					);
				}

				changeOptions = { uncommitted: true };
				const executionState = await readExecutionState(config.project.log_dir);
				if (executionState?.working_tree_ref) {
					changeOptions.fixBase = executionState.working_tree_ref;
				}
			} else if (!logsExist) {
				const executionState = await readExecutionState(config.project.log_dir);
				if (executionState) {
					const resolved = await resolveFixBase(
						executionState,
						effectiveBaseBranch,
					);
					if (resolved.warning) {
						log.warn(`Warning: ${resolved.warning}`);
					}
					if (resolved.fixBase) {
						changeOptions = { fixBase: resolved.fixBase };
					}
				}
			}

			// Allow explicit commit or uncommitted options to override fixBase
			if (options.commit || options.uncommitted) {
				changeOptions = {
					commit: options.commit,
					uncommitted: options.uncommitted,
					fixBase: changeOptions?.fixBase,
				};
			}

			const changeDetector = new ChangeDetector(
				effectiveBaseBranch,
				changeOptions || {
					commit: options.commit,
					uncommitted: options.uncommitted,
				},
			);
			const expander = new EntryPointExpander();
			const jobGen = new JobGenerator(config);

			log.debug("Detecting changes...");
			const changes = await changeDetector.getChangedFiles();

			if (changes.length === 0) {
				// In rerun mode, all previous failures may have been resolved
				// (violations skipped/fixed) without code changes. Detect this
				// and report the correct terminal status instead of "no_changes".
				if (isRerun && failuresMap && failuresMap.size === 0) {
					const hasSkipped = await hasSkippedViolationsInLogs({
						logDir: config.project.log_dir,
					});
					const status: GauntletStatus = hasSkipped
						? "passed_with_warnings"
						: "passed";

					if (status === "passed") {
						await debugLogger?.logClean("auto", "all_passed");
						await cleanLogs(
							config.project.log_dir,
							config.project.max_previous_logs,
						);
					}

					log.info(getStatusMessage(status));
					consoleLogHandle?.restore();
					if (loggerInitializedHere) {
						await resetLogger();
					}
					return {
						status,
						message: getStatusMessage(status),
						gatesRun: 0,
					};
				}

				log.info("No changes detected.");
				// Do not write execution state - no gates ran
				consoleLogHandle?.restore();
				if (loggerInitializedHere) {
					await resetLogger();
				}
				return {
					status: "no_changes",
					message: getStatusMessage("no_changes"),
					gatesRun: 0,
				};
			}

			log.debug(`Found ${changes.length} changed files.`);

			const entryPoints = await expander.expand(
				config.project.entry_points,
				changes,
			);
			let jobs = jobGen.generateJobs(entryPoints);

			if (options.gate) {
				jobs = jobs.filter((j) => j.name === options.gate);
			}

			if (jobs.length === 0) {
				log.warn("No applicable gates for these changes.");
				// Do not write execution state - no gates ran
				consoleLogHandle?.restore();
				if (loggerInitializedHere) {
					await resetLogger();
				}
				return {
					status: "no_applicable_gates",
					message: getStatusMessage("no_applicable_gates"),
					gatesRun: 0,
				};
			}

			log.debug(`Running ${jobs.length} gates...`);

			// Compute diff stats and log run start
			const runMode = isRerun ? "verification" : "full";
			const diffStats = await computeDiffStats(
				effectiveBaseBranch,
				changeOptions || {
					commit: options.commit,
					uncommitted: options.uncommitted,
				},
			);
			await debugLogger?.logRunStartWithDiff(runMode, diffStats, jobs.length);

			const reporter = new ConsoleReporter();
			const runner = new Runner(
				config,
				logger,
				reporter,
				failuresMap,
				changeOptions,
				effectiveBaseBranch,
				passedSlotsMap,
				debugLogger ?? undefined,
				isRerun,
			);

			const outcome = await runner.run(jobs);

			// Log run end with actual statistics from runner
			await debugLogger?.logRunEnd(
				outcome.allPassed ? "pass" : "fail",
				outcome.stats.fixed,
				outcome.stats.skipped,
				outcome.stats.failed,
				logger.getRunNumber(),
			);

			// Write execution state before releasing lock
			await writeExecutionState(config.project.log_dir);

			const consoleLogPath = await findLatestConsoleLog(config.project.log_dir);

			// Determine the correct status based on runner outcome
			let status: GauntletStatus;
			if (outcome.retryLimitExceeded) {
				status = "retry_limit_exceeded";
			} else if (outcome.allPassed && outcome.anySkipped) {
				status = "passed_with_warnings";
			} else if (outcome.allPassed) {
				status = "passed";
			} else {
				status = "failed";
			}

			// Clean logs on success or retry limit exceeded
			if (status === "passed") {
				await debugLogger?.logClean("auto", "all_passed");
				await cleanLogs(
					config.project.log_dir,
					config.project.max_previous_logs,
				);
			} else if (status === "retry_limit_exceeded") {
				await debugLogger?.logClean("auto", "retry_limit_exceeded");
				await cleanLogs(
					config.project.log_dir,
					config.project.max_previous_logs,
				);
			}

			consoleLogHandle?.restore();

			// Clean up logger if we initialized it
			if (loggerInitializedHere) {
				await resetLogger();
			}

			return {
				status,
				message: getStatusMessage(status),
				gatesRun: jobs.length,
				gatesFailed: outcome.allPassed ? 0 : jobs.length,
				consoleLogPath: consoleLogPath ?? undefined,
				gateResults: outcome.gateResults,
			};
		} finally {
			// Guarantee lock release regardless of how we exit the post-lock section
			await releaseLock(config.project.log_dir);
		}
	} catch (error: unknown) {
		// Do not write execution state on error - no gates completed successfully
		// Lock release is handled by the inner finally block if lock was acquired.
		// If error occurred before lock acquisition, no release needed.
		consoleLogHandle?.restore();

		// Clean up logger if we initialized it
		if (loggerInitializedHere) {
			await resetLogger();
		}

		const err = error as { message?: string };
		const errorMessage = err.message || "unknown error";
		return {
			status: "error",
			message: getStatusMessage("error"),
			errorMessage,
		};
	}
}

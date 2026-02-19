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
import {
	findLatestConsoleLog,
	getStatusMessage,
	shouldRunBasedOnInterval,
	tryAcquireLock,
} from "./run-executor-helpers.js";
import { Runner } from "./runner.js";

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

/** Shared context threaded through executeRun sub-functions. */
interface RunContext {
	options: ExecuteRunOptions;
	config: Awaited<ReturnType<typeof loadConfig>>;
	loggerInitializedHere: boolean;
	effectiveBaseBranch: string;
}

/**
 * Get the run executor logger.
 */
function getRunLogger() {
	return getCategoryLogger("run");
}

/**
 * Clean up logger if it was initialized in this run, then return a result.
 */
async function finalizeAndReturn(
	loggerInitializedHere: boolean,
	result: RunResult,
	consoleLogHandle?: ConsoleLogHandle,
): Promise<RunResult> {
	consoleLogHandle?.restore();
	if (loggerInitializedHere) {
		await resetLogger();
	}
	return result;
}

/**
 * Check if the run interval has elapsed. Returns a RunResult to short-circuit
 * when the stop hook is disabled or the interval hasn't elapsed, or null to continue.
 */
async function checkRunInterval(ctx: RunContext): Promise<RunResult | null> {
	if (!ctx.options.checkInterval) {
		return null;
	}

	const globalConfig = await loadGlobalConfig();
	const stopHookConfig = resolveStopHookConfig(
		ctx.config.project.stop_hook,
		globalConfig,
	);

	const log = getRunLogger();

	if (!stopHookConfig.enabled) {
		log.debug("Stop hook is disabled via configuration, skipping");
		return {
			status: "stop_hook_disabled",
			message: getStatusMessage("stop_hook_disabled"),
		};
	}

	const logsExist = await hasExistingLogs(ctx.config.project.log_dir);
	// Only check interval if there are no existing logs (not in rerun mode)
	// and interval > 0 (interval 0 means always run)
	if (!logsExist && stopHookConfig.run_interval_minutes > 0) {
		const intervalMinutes = stopHookConfig.run_interval_minutes;
		const shouldRun = await shouldRunBasedOnInterval(
			ctx.config.project.log_dir,
			intervalMinutes,
			readExecutionState,
		);
		if (!shouldRun) {
			log.debug(
				`Run interval (${intervalMinutes} min) not elapsed, skipping`,
			);
			return {
				status: "interval_not_elapsed",
				message: `Run interval (${intervalMinutes} min) not elapsed.`,
				intervalMinutes,
			};
		}
	}

	return null;
}

/**
 * Build the failures map and change options from previous logs (rerun mode),
 * or resolve fixBase from execution state (fresh run mode).
 */
async function processRerunMode(
	ctx: RunContext,
	isRerun: boolean,
	logsExist: boolean,
): Promise<{
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
	passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
	changeOptions:
		| { commit?: string; uncommitted?: boolean; fixBase?: string }
		| undefined;
}> {
	const log = getRunLogger();
	let failuresMap:
		| Map<string, Map<string, PreviousViolation[]>>
		| undefined;
	let passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
	let changeOptions:
		| { commit?: string; uncommitted?: boolean; fixBase?: string }
		| undefined;

	if (isRerun) {
		log.debug("Existing logs detected -- running in verification mode...");
		const { failures: previousFailures, passedSlots } =
			await findPreviousFailures(
				ctx.config.project.log_dir,
				ctx.options.gate,
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
					gf.adapterFailures.reduce(
						(s, af) => s + af.violations.length,
						0,
					),
				0,
			);
			log.warn(
				`Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
			);
		}

		changeOptions = { uncommitted: true };
		const executionState = await readExecutionState(
			ctx.config.project.log_dir,
		);
		if (executionState?.working_tree_ref) {
			changeOptions.fixBase = executionState.working_tree_ref;
		}
	} else if (!logsExist) {
		const executionState = await readExecutionState(
			ctx.config.project.log_dir,
		);
		if (executionState) {
			const resolved = await resolveFixBase(
				executionState,
				ctx.effectiveBaseBranch,
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
	if (ctx.options.commit || ctx.options.uncommitted) {
		changeOptions = {
			commit: ctx.options.commit,
			uncommitted: ctx.options.uncommitted,
			fixBase: changeOptions?.fixBase,
		};
	}

	return { failuresMap, passedSlotsMap, changeOptions };
}

/**
 * Detect changes, expand entry points, and generate jobs.
 * Returns null if there are no changes or no applicable gates (with the
 * appropriate RunResult), or the detected artifacts to proceed with.
 */
async function detectAndPrepareChanges(
	ctx: RunContext,
	isRerun: boolean,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
	changeOptions:
		| { commit?: string; uncommitted?: boolean; fixBase?: string }
		| undefined,
): Promise<
	| { earlyResult: RunResult }
	| {
			jobs: ReturnType<JobGenerator["generateJobs"]>;
			changes: Awaited<ReturnType<ChangeDetector["getChangedFiles"]>>;
			changeOpts: NonNullable<typeof changeOptions>;
	  }
> {
	const log = getRunLogger();
	const debugLogger = getDebugLogger();

	const effectiveChangeOptions = changeOptions || {
		commit: ctx.options.commit,
		uncommitted: ctx.options.uncommitted,
	};

	const changeDetector = new ChangeDetector(
		ctx.effectiveBaseBranch,
		effectiveChangeOptions,
	);
	const expander = new EntryPointExpander();
	const jobGen = new JobGenerator(ctx.config);

	log.debug("Detecting changes...");
	const changes = await changeDetector.getChangedFiles();

	if (changes.length === 0) {
		return handleNoChanges(ctx, isRerun, failuresMap, debugLogger);
	}

	log.debug(`Found ${changes.length} changed files.`);

	const entryPoints = await expander.expand(
		ctx.config.project.entry_points,
		changes,
	);
	let jobs = jobGen.generateJobs(entryPoints);

	if (ctx.options.gate) {
		jobs = jobs.filter((j) => j.name === ctx.options.gate);
	}

	if (jobs.length === 0) {
		log.warn("No applicable gates for these changes.");
		return {
			earlyResult: {
				status: "no_applicable_gates",
				message: getStatusMessage("no_applicable_gates"),
				gatesRun: 0,
			},
		};
	}

	return { jobs, changes, changeOpts: effectiveChangeOptions };
}

/**
 * Handle the case where no changes are detected.
 * In rerun mode with no remaining failures, this may be a terminal success.
 */
async function handleNoChanges(
	ctx: RunContext,
	isRerun: boolean,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
	debugLogger: ReturnType<typeof getDebugLogger>,
): Promise<{ earlyResult: RunResult }> {
	const log = getRunLogger();

	// In rerun mode, all previous failures may have been resolved
	// (violations skipped/fixed) without code changes. Detect this
	// and report the correct terminal status instead of "no_changes".
	if (isRerun && failuresMap && failuresMap.size === 0) {
		const hasSkipped = await hasSkippedViolationsInLogs({
			logDir: ctx.config.project.log_dir,
		});
		const status: GauntletStatus = hasSkipped
			? "passed_with_warnings"
			: "passed";

		if (status === "passed") {
			await debugLogger?.logClean("auto", "all_passed");
			await cleanLogs(
				ctx.config.project.log_dir,
				ctx.config.project.max_previous_logs,
			);
		}

		log.info(getStatusMessage(status));
		return {
			earlyResult: {
				status,
				message: getStatusMessage(status),
				gatesRun: 0,
			},
		};
	}

	log.info("No changes detected.");
	return {
		earlyResult: {
			status: "no_changes",
			message: getStatusMessage("no_changes"),
			gatesRun: 0,
		},
	};
}

/**
 * Execute the runner and build the final RunResult.
 */
async function executeAndReport(
	ctx: RunContext,
	logger: Logger,
	isRerun: boolean,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
	passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined,
	changeOptions:
		| { commit?: string; uncommitted?: boolean; fixBase?: string }
		| undefined,
	jobs: ReturnType<JobGenerator["generateJobs"]>,
): Promise<RunResult> {
	const log = getRunLogger();
	const debugLogger = getDebugLogger();

	// Compute diff stats and log run start
	const runMode = isRerun ? "verification" : "full";
	const effectiveChangeOptions = changeOptions || {
		commit: ctx.options.commit,
		uncommitted: ctx.options.uncommitted,
	};
	const diffStats = await computeDiffStats(
		ctx.effectiveBaseBranch,
		effectiveChangeOptions,
	);
	await debugLogger?.logRunStartWithDiff(runMode, diffStats, jobs.length);

	log.debug(`Running ${jobs.length} gates...`);

	const reporter = new ConsoleReporter();
	const runner = new Runner(
		ctx.config,
		logger,
		reporter,
		failuresMap,
		changeOptions,
		ctx.effectiveBaseBranch,
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
	await writeExecutionState(ctx.config.project.log_dir);

	const consoleLogPath = await findLatestConsoleLog(
		ctx.config.project.log_dir,
	);

	const status = determineStatus(outcome);

	// Clean logs on success or retry limit exceeded
	if (status === "passed" || status === "retry_limit_exceeded") {
		const reason =
			status === "passed" ? "all_passed" : "retry_limit_exceeded";
		await debugLogger?.logClean("auto", reason);
		await cleanLogs(
			ctx.config.project.log_dir,
			ctx.config.project.max_previous_logs,
		);
	}

	return {
		status,
		message: getStatusMessage(status),
		gatesRun: jobs.length,
		gatesFailed: outcome.allPassed ? 0 : jobs.length,
		consoleLogPath: consoleLogPath ?? undefined,
		gateResults: outcome.gateResults,
	};
}

/**
 * Map runner outcome to GauntletStatus.
 */
function determineStatus(outcome: {
	allPassed: boolean;
	anySkipped: boolean;
	retryLimitExceeded: boolean;
}): GauntletStatus {
	if (outcome.retryLimitExceeded) {
		return "retry_limit_exceeded";
	}
	if (outcome.allPassed && outcome.anySkipped) {
		return "passed_with_warnings";
	}
	if (outcome.allPassed) {
		return "passed";
	}
	return "failed";
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

		// Determine effective base branch (needed for auto-clean)
		const effectiveBaseBranch =
			options.baseBranch ||
			(process.env.GITHUB_BASE_REF &&
			(process.env.CI === "true" ||
				process.env.GITHUB_ACTIONS === "true")
				? process.env.GITHUB_BASE_REF
				: null) ||
			config.project.base_branch;

		const ctx: RunContext = {
			options,
			config,
			loggerInitializedHere,
			effectiveBaseBranch,
		};

		// Interval check: only stop-hook passes checkInterval: true
		const intervalResult = await checkRunInterval(ctx);
		if (intervalResult) {
			return finalizeAndReturn(loggerInitializedHere, intervalResult);
		}

		// Auto-clean on context change (branch changed, commit merged)
		const autoCleanResult = await shouldAutoClean(
			config.project.log_dir,
			effectiveBaseBranch,
		);
		if (autoCleanResult.clean) {
			getRunLogger().debug(
				`Auto-cleaning logs (${autoCleanResult.reason})...`,
			);
			await debugLogger?.logClean(
				"auto",
				autoCleanResult.reason || "unknown",
			);
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
			return finalizeAndReturn(loggerInitializedHere, {
				status: "lock_conflict",
				message: getStatusMessage("lock_conflict"),
			});
		}

		// Lock acquired -- wrap in try/finally to guarantee release
		try {
			const logger = new Logger(config.project.log_dir);
			await logger.init();
			const runNumber = logger.getRunNumber();

			consoleLogHandle = await startConsoleLog(
				config.project.log_dir,
				runNumber,
			);

			const { failuresMap, passedSlotsMap, changeOptions } =
				await processRerunMode(ctx, isRerun, logsExist);

			const prepared = await detectAndPrepareChanges(
				ctx,
				isRerun,
				failuresMap,
				changeOptions,
			);

			if ("earlyResult" in prepared) {
				return finalizeAndReturn(
					loggerInitializedHere,
					prepared.earlyResult,
					consoleLogHandle,
				);
			}

			const result = await executeAndReport(
				ctx,
				logger,
				isRerun,
				failuresMap,
				passedSlotsMap,
				changeOptions,
				prepared.jobs,
			);

			consoleLogHandle?.restore();
			if (loggerInitializedHere) {
				await resetLogger();
			}
			return result;
		} finally {
			// Guarantee lock release regardless of how we exit
			await releaseLock(config.project.log_dir);
		}
	} catch (error: unknown) {
		// Lock release is handled by the inner finally block if acquired.
		consoleLogHandle?.restore();
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

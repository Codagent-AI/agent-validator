import fs from "node:fs/promises";
import path from "node:path";
import {
	cleanLogs,
	hasExistingLogs,
} from "../commands/shared.js";
import { loadGlobalConfig } from "../config/global.js";
import type { loadConfig } from "../config/loader.js";
import { resolveStopHookConfig } from "../config/stop-hook-config.js";
import { getCategoryLogger, resetLogger } from "../output/app-logger.js";
import { ConsoleReporter } from "../output/console.js";
import type { ConsoleLogHandle } from "../output/console-log.js";
import { Logger } from "../output/logger.js";
import type { GauntletStatus, RunResult } from "../types/gauntlet-status.js";
import { getDebugLogger } from "../utils/debug-log.js";
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

// ---- Types shared between executor and helpers ----

export type ChangeOptions = {
	commit?: string;
	uncommitted?: boolean;
	fixBase?: string;
};

export type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>;

export interface RunContext {
	options: {
		baseBranch?: string;
		gate?: string;
		commit?: string;
		uncommitted?: boolean;
		cwd?: string;
		checkInterval?: boolean;
	};
	config: LoadedConfig;
	loggerInitializedHere: boolean;
	effectiveBaseBranch: string;
}

// ---- Lock helpers ----

const LOCK_FILENAME = ".gauntlet-run.lock";
const STALE_LOCK_MS = 10 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EPERM"
		) {
			return true;
		}
		return false;
	}
}

async function isLockStale(lockPath: string): Promise<boolean> {
	try {
		const lockContent = await fs.readFile(lockPath, "utf-8");
		const lockPid = Number.parseInt(lockContent.trim(), 10);
		const lockStat = await fs.stat(lockPath);
		const lockAgeMs = Date.now() - lockStat.mtimeMs;

		const pidValid = !Number.isNaN(lockPid);
		if (pidValid && !isProcessAlive(lockPid)) {
			return true;
		}
		if (!pidValid && lockAgeMs > STALE_LOCK_MS) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Acquire the lock file. Returns true if successful, false if lock exists.
 */
export async function tryAcquireLock(logDir: string): Promise<boolean> {
	await fs.mkdir(logDir, { recursive: true });
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch (err: unknown) {
		const isExist =
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EEXIST";

		if (!isExist) {
			throw err;
		}

		const stale = await isLockStale(lockPath);
		if (!stale) {
			return false;
		}

		await fs.rm(lockPath, { force: true });
		try {
			await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
			return true;
		} catch {
			return false;
		}
	}
}

// ---- Console log finder ----

export async function findLatestConsoleLog(
	logDir: string,
): Promise<string | null> {
	try {
		const files = await fs.readdir(logDir);
		let maxNum = -1;
		let latestFile: string | null = null;

		for (const file of files) {
			if (!(file.startsWith("console.") && file.endsWith(".log"))) {
				continue;
			}
			const middle = file.slice(
				"console.".length,
				file.length - ".log".length,
			);
			if (/^\d+$/.test(middle)) {
				const n = Number.parseInt(middle, 10);
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

// ---- Interval check ----

async function shouldRunBasedOnInterval(
	logDir: string,
	intervalMinutes: number,
): Promise<boolean> {
	const state = await readExecutionState(logDir);
	if (!state) {
		return true;
	}

	const lastRun = new Date(state.last_run_completed_at);
	if (Number.isNaN(lastRun.getTime())) {
		return true;
	}

	const now = new Date();
	const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60);
	return elapsedMinutes >= intervalMinutes;
}

// ---- Status messages ----

const statusMessages: Record<GauntletStatus, string> = {
	passed: "All gates passed.",
	passed_with_warnings: "Passed with warnings -- some issues were skipped.",
	no_applicable_gates: "No applicable gates for these changes.",
	no_changes: "No changes detected.",
	failed: "Gates failed -- issues must be fixed.",
	retry_limit_exceeded:
		"Retry limit exceeded -- logs have been automatically archived.",
	lock_conflict: "Another gauntlet run is already in progress.",
	error: "Unexpected error occurred.",
	no_config: "No .gauntlet/config.yml found.",
	stop_hook_active: "Stop hook already active.",
	loop_detected: "Loop detected -- rapid blocks overridden.",
	interval_not_elapsed: "Run interval not elapsed.",
	invalid_input: "Invalid input.",
	stop_hook_disabled: "",
	pr_push_required: "Gates passed -- PR needs to be created/updated.",
	ci_pending: "CI checks still running.",
	ci_failed: "CI checks failed or review changes requested.",
	ci_passed: "CI checks passed, no blocking reviews.",
	validation_required:
		"Changes need validation or previous run has unresolved failures.",
};

export function getStatusMessage(status: GauntletStatus): string {
	return statusMessages[status] || "Unknown status";
}

function getRunLogger() {
	return getCategoryLogger("run");
}

// ---- Finalize helper ----

export async function finalizeAndReturn(
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

// ---- Step: check interval ----

export async function checkRunInterval(
	ctx: RunContext,
): Promise<RunResult | null> {
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
	if (!logsExist && stopHookConfig.run_interval_minutes > 0) {
		const intervalMinutes = stopHookConfig.run_interval_minutes;
		const shouldRun = await shouldRunBasedOnInterval(
			ctx.config.project.log_dir,
			intervalMinutes,
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

// ---- Step: process rerun mode ----

/**
 * Build the failures map from previous log data.
 */
function buildFailuresMap(
	previousFailures: Awaited<
		ReturnType<typeof findPreviousFailures>
	>["failures"],
): Map<string, Map<string, PreviousViolation[]>> {
	const failuresMap = new Map<string, Map<string, PreviousViolation[]>>();
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
	return failuresMap;
}

/**
 * Handle rerun mode: parse previous failures and build change options.
 */
async function handleRerunMode(
	ctx: RunContext,
): Promise<{
	failuresMap: Map<string, Map<string, PreviousViolation[]>>;
	passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
	changeOptions: ChangeOptions;
}> {
	const log = getRunLogger();
	log.debug("Existing logs detected -- running in verification mode...");

	const { failures: previousFailures, passedSlots } =
		await findPreviousFailures(
			ctx.config.project.log_dir,
			ctx.options.gate,
			true,
		);

	const failuresMap = buildFailuresMap(previousFailures);

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

	const changeOptions: ChangeOptions = { uncommitted: true };
	const executionState = await readExecutionState(
		ctx.config.project.log_dir,
	);
	if (executionState?.working_tree_ref) {
		changeOptions.fixBase = executionState.working_tree_ref;
	}

	return { failuresMap, passedSlotsMap: passedSlots, changeOptions };
}

/**
 * Handle fresh run mode: resolve fixBase from execution state.
 */
async function handleFreshRunMode(
	ctx: RunContext,
): Promise<ChangeOptions | undefined> {
	const log = getRunLogger();
	const executionState = await readExecutionState(ctx.config.project.log_dir);
	if (!executionState) {
		return undefined;
	}

	const resolved = await resolveFixBase(
		executionState,
		ctx.effectiveBaseBranch,
	);
	if (resolved.warning) {
		log.warn(`Warning: ${resolved.warning}`);
	}
	if (resolved.fixBase) {
		return { fixBase: resolved.fixBase };
	}
	return undefined;
}

export async function processRerunMode(
	ctx: RunContext,
	isRerun: boolean,
	logsExist: boolean,
): Promise<{
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined;
	passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
	changeOptions: ChangeOptions | undefined;
}> {
	let failuresMap:
		| Map<string, Map<string, PreviousViolation[]>>
		| undefined;
	let passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined;
	let changeOptions: ChangeOptions | undefined;

	if (isRerun) {
		const rerunResult = await handleRerunMode(ctx);
		failuresMap = rerunResult.failuresMap;
		passedSlotsMap = rerunResult.passedSlotsMap;
		changeOptions = rerunResult.changeOptions;
	} else if (!logsExist) {
		changeOptions = await handleFreshRunMode(ctx);
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

// ---- Step: detect and prepare changes ----

async function handleNoChanges(
	ctx: RunContext,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
): Promise<RunResult> {
	const log = getRunLogger();
	const debugLogger = getDebugLogger();

	if (failuresMap && failuresMap.size === 0) {
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
		return { status, message: getStatusMessage(status), gatesRun: 0 };
	}

	log.info("No changes detected.");
	return {
		status: "no_changes",
		message: getStatusMessage("no_changes"),
		gatesRun: 0,
	};
}

export async function detectAndPrepareChanges(
	ctx: RunContext,
	isRerun: boolean,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
	changeOptions: ChangeOptions | undefined,
): Promise<
	| { earlyResult: RunResult }
	| {
			jobs: ReturnType<JobGenerator["generateJobs"]>;
			changeOpts: ChangeOptions;
	  }
> {
	const log = getRunLogger();
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

	if (changes.length === 0 && isRerun) {
		return { earlyResult: await handleNoChanges(ctx, failuresMap) };
	}
	if (changes.length === 0) {
		return { earlyResult: await handleNoChanges(ctx, undefined) };
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

	return { jobs, changeOpts: effectiveChangeOptions };
}

// ---- Step: execute and report ----

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

export async function executeAndReport(
	ctx: RunContext,
	logger: Logger,
	isRerun: boolean,
	failuresMap: Map<string, Map<string, PreviousViolation[]>> | undefined,
	passedSlotsMap: Map<string, Map<number, PassedSlot>> | undefined,
	changeOptions: ChangeOptions | undefined,
	jobs: ReturnType<JobGenerator["generateJobs"]>,
): Promise<RunResult> {
	const debugLogger = getDebugLogger();

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

	getRunLogger().debug(`Running ${jobs.length} gates...`);

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

	await debugLogger?.logRunEnd(
		outcome.allPassed ? "pass" : "fail",
		outcome.stats.fixed,
		outcome.stats.skipped,
		outcome.stats.failed,
		logger.getRunNumber(),
	);

	await writeExecutionState(ctx.config.project.log_dir);

	const consoleLogPath = await findLatestConsoleLog(
		ctx.config.project.log_dir,
	);

	const status = determineStatus(outcome);

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

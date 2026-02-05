import type {
	LoadedCheckGateConfig,
	LoadedConfig,
	LoadedReviewGateConfig,
} from "../config/types.js";
import { CheckGateExecutor } from "../gates/check.js";
import type { GateResult } from "../gates/result.js";
import { ReviewGateExecutor } from "../gates/review.js";
import type { ConsoleReporter } from "../output/console.js";
import type { Logger } from "../output/logger.js";
import type { DebugLogger } from "../utils/debug-log.js";
import type { PreviousViolation } from "../utils/log-parser.js";
import { sanitizeJobId } from "../utils/sanitizer.js";
import type { Job } from "./job.js";

/**
 * Iteration statistics for RUN_END logging.
 */
export interface IterationStats {
	/** Number of violations marked as fixed */
	fixed: number;
	/** Number of violations marked as skipped */
	skipped: number;
	/** Number of remaining active violations (failures) */
	failed: number;
}

/**
 * Structured result from Runner.run() for proper status mapping.
 */
export interface RunnerOutcome {
	/** Whether all gates passed */
	allPassed: boolean;
	/** Whether any violations were skipped (for passed_with_warnings) */
	anySkipped: boolean;
	/** Whether retry limit was exceeded */
	retryLimitExceeded: boolean;
	/** Whether any gates had errors */
	anyErrors: boolean;
	/** Iteration statistics for debug logging */
	stats: IterationStats;
	/** Individual gate results */
	gateResults: GateResult[];
}

/**
 * Calculate iteration statistics from gate results.
 * Aggregates fixed, skipped, and failed counts from all results and subResults.
 * For CHECK gates that don't set errorCount, count failed/error status as 1 failure.
 */
function calculateStats(results: GateResult[]): IterationStats {
	let fixed = 0;
	let skipped = 0;
	let failed = 0;

	for (const result of results) {
		// Count from top-level result
		if (result.fixedCount) fixed += result.fixedCount;
		if (result.skipped) skipped += result.skipped.length;

		// For failed gates, use errorCount if set, otherwise count as 1 failure
		// This handles CHECK gates which only set status but not errorCount
		if (result.errorCount) {
			failed += result.errorCount;
		} else if (result.status === "fail" || result.status === "error") {
			failed += 1;
		}

		// Count from subResults (review gates)
		if (result.subResults) {
			for (const sub of result.subResults) {
				if (sub.fixedCount) fixed += sub.fixedCount;
				if (sub.skipped) skipped += sub.skipped.length;

				if (sub.errorCount) {
					failed += sub.errorCount;
				} else if (sub.status === "fail" || sub.status === "error") {
					failed += 1;
				}
			}
		}
	}

	return { fixed, skipped, failed };
}

export class Runner {
	private checkExecutor = new CheckGateExecutor();
	private reviewExecutor = new ReviewGateExecutor();
	private results: GateResult[] = [];
	private shouldStop = false;

	constructor(
		private config: LoadedConfig,
		private logger: Logger,
		private reporter: ConsoleReporter,
		private previousFailuresMap?: Map<string, Map<string, PreviousViolation[]>>,
		private changeOptions?: { commit?: string; uncommitted?: boolean },
		private baseBranchOverride?: string,
		private passedSlotsMap?: Map<
			string,
			Map<number, { adapter: string; passIteration: number }>
		>,
		private debugLogger?: DebugLogger,
		private isRerun?: boolean,
	) {}

	async run(jobs: Job[]): Promise<RunnerOutcome> {
		// Note: logger.init() is called by the caller (run-executor, check, review)
		// before startConsoleLog to ensure unified numbering

		// Enforce retry limit before executing gates
		const maxRetries = this.config.project.max_retries ?? 3;
		const currentRunNumber = this.logger.getRunNumber();
		const maxAllowedRuns = maxRetries + 1;

		if (currentRunNumber > maxAllowedRuns) {
			console.error(
				`Retry limit exceeded: run ${currentRunNumber} exceeds max allowed ${maxAllowedRuns} (max_retries: ${maxRetries}). Human input required on what to do next.`,
			);
			process.exitCode = 1;
			return {
				allPassed: false,
				anySkipped: false,
				retryLimitExceeded: true,
				anyErrors: false,
				stats: { fixed: 0, skipped: 0, failed: 0 },
				gateResults: [],
			};
		}

		const parallelEnabled = this.config.project.allow_parallel;
		const parallelJobs = parallelEnabled
			? jobs.filter((j) => j.gateConfig.parallel)
			: [];
		const sequentialJobs = parallelEnabled
			? jobs.filter((j) => !j.gateConfig.parallel)
			: jobs;

		// Start parallel jobs
		const parallelPromises = parallelJobs.map((job) => this.executeJob(job));

		// Start sequential jobs
		const sequentialPromise = (async () => {
			for (const job of sequentialJobs) {
				if (this.shouldStop) break;
				await this.executeJob(job);
			}
		})();

		await Promise.all([...parallelPromises, sequentialPromise]);

		const allPassed = this.results.every((r) => r.status === "pass");
		const anySkipped = this.results.some(
			(r) => r.skipped && r.skipped.length > 0,
		);
		const anyErrors = this.results.some((r) => r.status === "error");
		const retryLimitExceeded =
			!allPassed && currentRunNumber === maxAllowedRuns;

		// Calculate statistics from results
		const stats = calculateStats(this.results);

		// If on the final allowed run and gates failed, report "Retry limit exceeded"
		if (retryLimitExceeded) {
			await this.reporter.printSummary(
				this.results,
				this.config.project.log_dir,
				"Retry limit exceeded",
			);
			return {
				allPassed: false,
				anySkipped,
				retryLimitExceeded: true,
				anyErrors,
				stats,
				gateResults: this.results,
			};
		}

		await this.reporter.printSummary(this.results, this.config.project.log_dir);

		return {
			allPassed,
			anySkipped,
			retryLimitExceeded: false,
			anyErrors,
			stats,
			gateResults: this.results,
		};
	}

	private async executeJob(job: Job): Promise<void> {
		if (this.shouldStop) return;

		this.reporter.onJobStart(job);

		let result: GateResult;

		try {
			if (job.type === "check") {
				const logPath = await this.logger.getLogPath(job.id);
				const jobLogger = await this.logger.createJobLogger(job.id);
				const effectiveBaseBranch =
					this.baseBranchOverride || this.config.project.base_branch;
				result = await this.checkExecutor.execute(
					job.id,
					job.gateConfig as LoadedCheckGateConfig,
					job.workingDirectory,
					jobLogger,
					{ baseBranch: effectiveBaseBranch, isRerun: this.isRerun },
				);
				result.logPath = logPath;
			} else {
				// Use sanitized Job ID for lookup because that's what log-parser uses (based on filenames)
				const safeJobId = sanitizeJobId(job.id);
				const previousFailures = this.previousFailuresMap?.get(safeJobId);
				const passedSlots = this.passedSlotsMap?.get(safeJobId);
				const loggerFactory = this.logger.createLoggerFactory(job.id);
				const effectiveBaseBranch =
					this.baseBranchOverride || this.config.project.base_branch;
				result = await this.reviewExecutor.execute(
					job.id,
					job.gateConfig as LoadedReviewGateConfig,
					job.entryPoint,
					loggerFactory,
					effectiveBaseBranch,
					previousFailures,
					this.changeOptions,
					this.config.project.rerun_new_issue_threshold,
					passedSlots,
					this.config.project.log_dir,
				);
			}
		} catch (err) {
			console.error("[ERROR] Execution failed for", job.id, ":", err);
			result = {
				jobId: job.id,
				status: "error",
				duration: 0,
				message: err instanceof Error ? err.message : String(err),
			};
		}

		this.results.push(result);
		this.reporter.onJobComplete(job, result);
		await this.logGateResults(job.id, result);

		// Handle Fail Fast (only for checks, and only when parallel is false)
		if (
			result.status !== "pass" &&
			job.type === "check" &&
			job.gateConfig.fail_fast
		) {
			this.shouldStop = true;
		}
	}

	/**
	 * Log gate results to the debug log.
	 * For review gates with subResults, logs one entry per reviewer.
	 * For check gates, logs a single entry.
	 */
	private async logGateResults(
		jobId: string,
		result: GateResult,
	): Promise<void> {
		if (!this.debugLogger) return;

		if (result.subResults && result.subResults.length > 0) {
			for (const sub of result.subResults) {
				const cli = sub.nameSuffix.match(/\((.+?)@\d+\)/)?.[1];
				await this.debugLogger.logGateResult(
					jobId,
					sub.status,
					sub.duration ?? result.duration,
					{ violations: sub.errorCount, cli },
				);
			}
		} else {
			await this.debugLogger.logGateResult(
				jobId,
				result.status,
				result.duration,
				{ violations: result.errorCount },
			);
		}
	}
}

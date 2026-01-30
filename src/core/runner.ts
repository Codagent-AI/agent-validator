import { exec } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter } from "../cli-adapters/index.js";
import type {
	LoadedCheckGateConfig,
	LoadedConfig,
	LoadedReviewGateConfig,
} from "../config/types.js";
import { CheckGateExecutor } from "../gates/check.js";
import type { GateResult } from "../gates/result.js";
import { ReviewGateExecutor } from "../gates/review.js";
import { getCategoryLogger } from "../output/app-logger.js";
import type { ConsoleReporter } from "../output/console.js";
import type { Logger } from "../output/logger.js";
import type { DebugLogger } from "../utils/debug-log.js";
import type { PreviousViolation } from "../utils/log-parser.js";
import { sanitizeJobId } from "../utils/sanitizer.js";
import type { Job } from "./job.js";

const log = getCategoryLogger("runner");

const execAsync = promisify(exec);

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

		const { runnableJobs, preflightResults } = await this.preflight(jobs);
		this.results.push(...preflightResults);

		const parallelEnabled = this.config.project.allow_parallel;
		const parallelJobs = parallelEnabled
			? runnableJobs.filter((j) => j.gateConfig.parallel)
			: [];
		const sequentialJobs = parallelEnabled
			? runnableJobs.filter((j) => !j.gateConfig.parallel)
			: runnableJobs;

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
					effectiveBaseBranch,
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
					this.config.project.cli.check_usage_limit,
					this.config.project.rerun_new_issue_threshold,
					passedSlots,
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

		// Log gate result
		await this.debugLogger?.logGateResult(
			job.id,
			result.status,
			result.duration,
			result.errorCount,
		);

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
	 * Timeout for the entire preflight phase (60 seconds).
	 * If any individual check hangs, the timeout fires and marks remaining
	 * jobs as preflight failures.
	 */
	private static readonly PREFLIGHT_TIMEOUT_MS = 60 * 1000;

	private async preflight(
		jobs: Job[],
	): Promise<{ runnableJobs: Job[]; preflightResults: GateResult[] }> {
		const startMs = Date.now();
		await this.debugLogger?.logPreflightStart(jobs.length);

		// Shared arrays so both the check loop and timeout handler
		// can see partial progress
		const runnableJobs: Job[] = [];
		const preflightResults: GateResult[] = [];
		let timedOut = false;

		const doPreflightChecks = async () => {
			const cliCache = new Map<string, boolean>();

			for (const job of jobs) {
				if (this.shouldStop || timedOut) break;
				if (job.type === "check") {
					const commandName = this.getCommandName(
						(job.gateConfig as LoadedCheckGateConfig).command,
					);
					if (!commandName) {
						const msg = "Unable to parse command";
						console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
						preflightResults.push(await this.recordPreflightFailure(job, msg));
						await this.debugLogger?.logPreflightResult(job.id, "fail", msg);
						if (this.shouldFailFast(job)) this.shouldStop = true;
						continue;
					}

					const available = await this.commandExists(
						commandName,
						job.workingDirectory,
					);
					if (!available) {
						const msg = `Missing command: ${commandName}`;
						console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
						preflightResults.push(await this.recordPreflightFailure(job, msg));
						await this.debugLogger?.logPreflightResult(job.id, "fail", msg);
						if (this.shouldFailFast(job)) this.shouldStop = true;
						continue;
					}

					await this.debugLogger?.logPreflightResult(
						job.id,
						"pass",
						`command found: ${commandName}`,
					);
				} else {
					const reviewConfig = job.gateConfig as LoadedReviewGateConfig;

					// Only need at least 1 healthy adapter (round-robin handles the rest)
					let hasHealthy = false;
					for (const toolName of reviewConfig.cli_preference || []) {
						const cached = cliCache.get(toolName);
						const isAvailable = cached ?? (await this.checkAdapter(toolName));
						cliCache.set(toolName, isAvailable);
						if (isAvailable) {
							hasHealthy = true;
							break;
						}
					}

					if (!hasHealthy) {
						const msg = "Preflight failed: no healthy adapters available";
						console.error(`[PREFLIGHT] ${job.id}: ${msg}`);
						preflightResults.push(await this.recordPreflightFailure(job, msg));
						await this.debugLogger?.logPreflightResult(job.id, "fail", msg);
						if (this.shouldFailFast(job)) this.shouldStop = true;
						continue;
					}

					await this.debugLogger?.logPreflightResult(
						job.id,
						"pass",
						"adapter healthy",
					);
				}

				// Re-check timedOut before pushing to avoid a race where the timeout
				// fires between the loop guard (line 303) and this push, which would
				// cause the job to be both executed and marked as a timeout failure.
				if (!timedOut) {
					runnableJobs.push(job);
				}
			}

			return { runnableJobs, preflightResults };
		};

		// Race the preflight checks against a timeout
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<{
			runnableJobs: Job[];
			preflightResults: GateResult[];
		}>((resolve) => {
			timeoutId = setTimeout(() => {
				timedOut = true;
				this.shouldStop = true;
				console.error("[PREFLIGHT] Preflight timed out");
				// Resolve with current partial results
				resolve({ runnableJobs, preflightResults });
			}, Runner.PREFLIGHT_TIMEOUT_MS);
		});

		const result = await Promise.race([doPreflightChecks(), timeoutPromise]);

		// Always clear the timeout to prevent it firing during gate execution
		if (timeoutId) clearTimeout(timeoutId);

		// If timed out, mark remaining unchecked jobs as preflight failures
		if (timedOut) {
			const checkedJobIds = new Set([
				...result.runnableJobs.map((j) => j.id),
				...result.preflightResults.map((r) => r.jobId),
			]);
			for (const job of jobs) {
				if (!checkedJobIds.has(job.id)) {
					const msg = "Preflight timed out";
					preflightResults.push(await this.recordPreflightFailure(job, msg));
					await this.debugLogger?.logPreflightResult(job.id, "fail", msg);
				}
			}
			// Reset shouldStop so gate execution can proceed for jobs that passed preflight
			this.shouldStop = false;
		}

		const durationMs = Date.now() - startMs;
		await this.debugLogger?.logPreflightEnd(
			result.runnableJobs.length,
			result.preflightResults.length,
			durationMs,
		);

		return result;
	}

	private async recordPreflightFailure(
		job: Job,
		message: string,
	): Promise<GateResult> {
		if (job.type === "check") {
			const logPath = await this.logger.getLogPath(job.id);
			const jobLogger = await this.logger.createJobLogger(job.id);
			await jobLogger(
				`[${new Date().toISOString()}] Health check failed\n${message}\n`,
			);
			return {
				jobId: job.id,
				status: "error",
				duration: 0,
				message,
				logPath,
			};
		}

		return {
			jobId: job.id,
			status: "error",
			duration: 0,
			message,
		};
	}

	private async checkAdapter(name: string): Promise<boolean> {
		const adapter = getAdapter(name);
		if (!adapter) return false;
		const health = await adapter.checkHealth({
			checkUsageLimit: this.config.project.cli.check_usage_limit,
		});
		if (health.status !== "healthy") {
			log.debug(
				`Adapter ${name} check failed: ${health.status} - ${health.message}`,
			);
		}
		return health.status === "healthy";
	}

	private getCommandName(command: string): string | null {
		const tokens = this.tokenize(command);
		for (const token of tokens) {
			if (token === "env") continue;
			if (this.isEnvAssignment(token)) continue;
			return token;
		}
		return null;
	}

	private tokenize(command: string): string[] {
		const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
		if (!matches) return [];
		return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
	}

	private isEnvAssignment(token: string): boolean {
		return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
	}

	private async commandExists(command: string, cwd: string): Promise<boolean> {
		if (command.includes("/") || command.startsWith(".")) {
			const resolved = path.isAbsolute(command)
				? command
				: path.join(cwd, command);
			try {
				await fs.access(resolved, fsConstants.X_OK);
				return true;
			} catch {
				return false;
			}
		}

		try {
			await execAsync(`command -v ${command}`);
			return true;
		} catch {
			return false;
		}
	}

	private shouldFailFast(job: Job): boolean {
		return Boolean(job.type === "check" && job.gateConfig.fail_fast);
	}
}

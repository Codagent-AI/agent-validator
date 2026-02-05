import chalk from "chalk";
import type { Command } from "commander";
import { loadGlobalConfig } from "../config/global.js";
import { loadConfig } from "../config/loader.js";
import { ChangeDetector } from "../core/change-detector.js";
import { EntryPointExpander } from "../core/entry-point.js";
import { JobGenerator } from "../core/job.js";
import { Runner } from "../core/runner.js";
import { ConsoleReporter } from "../output/console.js";
import {
	type ConsoleLogHandle,
	startConsoleLog,
} from "../output/console-log.js";
import { Logger } from "../output/logger.js";
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
	type PassedSlot,
	type PreviousViolation,
} from "../utils/log-parser.js";
import {
	acquireLock,
	cleanLogs,
	hasExistingLogs,
	performAutoClean,
	releaseLock,
	shouldAutoClean,
} from "./shared.js";

export function registerReviewCommand(program: Command): void {
	program
		.command("review")
		.description("Run only applicable reviews for detected changes")
		.option(
			"-b, --base-branch <branch>",
			"Override base branch for change detection",
		)
		.option("-g, --gate <name>", "Run specific review gate only")
		.option("-c, --commit <sha>", "Use diff for a specific commit")
		.option(
			"-u, --uncommitted",
			"Use diff for current uncommitted changes (staged and unstaged)",
		)
		.action(async (options) => {
			let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
			let lockAcquired = false;
			let restoreConsole: ConsoleLogHandle | undefined;
			try {
				config = await loadConfig();

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
				].filter(Boolean);
				await debugLogger?.logCommand("review", args);

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
					console.log(
						chalk.dim(`Auto-cleaning logs (${autoCleanResult.reason})...`),
					);
					await debugLogger?.logClean(
						"auto",
						autoCleanResult.reason || "unknown",
					);
					await performAutoClean(config.project.log_dir, autoCleanResult);
				}

				// Detect rerun mode after auto-clean (clean may have removed logs)
				const logsExist = await hasExistingLogs(config.project.log_dir);
				const isRerun = logsExist && !options.commit;

				// Acquire lock BEFORE starting console log (prevents orphaned log files)
				await acquireLock(config.project.log_dir);
				lockAcquired = true;

				// Initialize Logger early to get unified run number for console log
				const logger = new Logger(config.project.log_dir);
				await logger.init();
				const runNumber = logger.getRunNumber();

				restoreConsole = await startConsoleLog(
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
					console.log(
						chalk.dim(
							"Existing logs detected — running in verification mode...",
						),
					);
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
								gf.adapterFailures.reduce(
									(s, af) => s + af.violations.length,
									0,
								),
							0,
						);
						console.log(
							chalk.yellow(
								`Found ${previousFailures.length} gate(s) with ${totalViolations} previous violation(s)`,
							),
						);
					}

					changeOptions = { uncommitted: true };
					// Use working_tree_ref from execution state for rerun diff scoping
					const executionState = await readExecutionState(
						config.project.log_dir,
					);
					if (executionState?.working_tree_ref) {
						changeOptions.fixBase = executionState.working_tree_ref;
					}
				} else if (!logsExist) {
					// Post-clean run: check if execution state has a working_tree_ref to use as fixBase
					const executionState = await readExecutionState(
						config.project.log_dir,
					);
					if (executionState) {
						const resolved = await resolveFixBase(
							executionState,
							effectiveBaseBranch,
						);
						if (resolved.warning) {
							console.log(chalk.yellow(`Warning: ${resolved.warning}`));
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

				console.log(chalk.dim("Detecting changes..."));
				const changes = await changeDetector.getChangedFiles();

				if (changes.length === 0) {
					console.log(chalk.green("No changes detected."));
					await writeExecutionState(config.project.log_dir);
					await releaseLock(config.project.log_dir);
					restoreConsole?.restore();
					process.exit(0);
				}

				console.log(chalk.dim(`Found ${changes.length} changed files.`));

				const entryPoints = await expander.expand(
					config.project.entry_points,
					changes,
				);
				let jobs = jobGen.generateJobs(entryPoints);

				// Filter to only reviews
				jobs = jobs.filter((j) => j.type === "review");

				if (options.gate) {
					jobs = jobs.filter((j) => j.name === options.gate);
				}

				if (jobs.length === 0) {
					console.log(chalk.yellow("No applicable reviews for these changes."));
					await writeExecutionState(config.project.log_dir);
					await releaseLock(config.project.log_dir);
					restoreConsole?.restore();
					process.exit(0);
				}

				console.log(chalk.dim(`Running ${jobs.length} review(s)...`));

				// Log run start
				const runMode = isRerun ? "verification" : "full";
				await debugLogger?.logRunStart(runMode, changes.length, jobs.length);

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

				const success = await runner.run(jobs);

				// Log run end
				await debugLogger?.logRunEnd(
					success ? "pass" : "fail",
					0,
					0,
					0,
					logger.getRunNumber(),
				);

				// Write execution state before releasing lock (for interval checks)
				// This now captures working_tree_ref which is used for rerun diff scoping
				await writeExecutionState(config.project.log_dir);

				if (success) {
					await debugLogger?.logClean("auto", "all_passed");
					await cleanLogs(config.project.log_dir);
				}
				await releaseLock(config.project.log_dir);
				restoreConsole?.restore();
				process.exit(success ? 0 : 1);
			} catch (error: unknown) {
				// Write execution state even on error (if lock was acquired)
				if (config && lockAcquired) {
					try {
						await writeExecutionState(config.project.log_dir);
					} catch {
						// Ignore errors writing state during error handling
					}
					await releaseLock(config.project.log_dir);
				}
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				restoreConsole?.restore();
				process.exit(1);
			}
		});
}

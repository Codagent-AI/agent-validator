import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { ChangeDetector } from "../core/change-detector.js";
import { EntryPointExpander } from "../core/entry-point.js";
import { type Job, JobGenerator } from "../core/job.js";
import {
	readExecutionState,
	resolveFixBase,
} from "../utils/execution-state.js";
import {
	hasExistingLogs,
	performAutoClean,
	shouldAutoClean,
} from "./shared.js";

interface ChangeOptions {
	commit?: string;
	uncommitted?: boolean;
	fixBase?: string;
}

async function autoCleanIfNeeded(
	logDir: string,
	baseBranch: string,
): Promise<void> {
	const result = await shouldAutoClean(logDir, baseBranch);
	if (result.clean) {
		await performAutoClean(logDir, result);
	}
}

async function resolveFreshFixBase(
	logDir: string,
	baseBranch: string,
): Promise<string | undefined> {
	const state = await readExecutionState(logDir);
	if (!state) return undefined;
	return (await resolveFixBase(state, baseBranch)).fixBase;
}

/**
 * Resolve change detection options using the same logic as run-executor.
 * Handles rerun mode (existing logs → uncommitted-only diff) and fixBase resolution.
 */
async function resolveChangeOptions(
	logDir: string,
	baseBranch: string,
	cliOptions: { commit?: string; uncommitted?: boolean },
): Promise<ChangeOptions> {
	await autoCleanIfNeeded(logDir, baseBranch);

	const logsExist = await hasExistingLogs(logDir);
	const isRerun = logsExist && !cliOptions.commit;

	const opts: ChangeOptions = {};
	if (isRerun) {
		const state = await readExecutionState(logDir);
		opts.uncommitted = true;
		opts.fixBase = state?.working_tree_ref;
	} else if (!logsExist) {
		const fixBase = await resolveFreshFixBase(logDir, baseBranch);
		if (fixBase) opts.fixBase = fixBase;
	}

	if (cliOptions.commit || cliOptions.uncommitted) {
		return {
			commit: cliOptions.commit,
			uncommitted: cliOptions.uncommitted,
			fixBase: opts.fixBase,
		};
	}
	return opts;
}

export function registerDetectCommand(program: Command): void {
	program
		.command("detect")
		.description(
			"Show what gates would run for detected changes (without executing them)",
		)
		.option(
			"-b, --base-branch <branch>",
			"Override base branch for change detection",
		)
		.option("-c, --commit <sha>", "Use diff for a specific commit")
		.option(
			"-u, --uncommitted",
			"Use diff for current uncommitted changes (staged and unstaged)",
		)
		.action(async (options) => {
			try {
				const config = await loadConfig();

				// Priority: CLI override > CI env var > config
				const effectiveBaseBranch =
					options.baseBranch ||
					(process.env.GITHUB_BASE_REF &&
					(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
						? process.env.GITHUB_BASE_REF
						: null) ||
					config.project.base_branch;

				const changeOptions = await resolveChangeOptions(
					config.project.log_dir,
					effectiveBaseBranch,
					{ commit: options.commit, uncommitted: options.uncommitted },
				);

				const changeDetector = new ChangeDetector(
					effectiveBaseBranch,
					changeOptions,
				);
				const expander = new EntryPointExpander();
				const jobGen = new JobGenerator(config);

				console.log(chalk.dim("Detecting changes..."));
				const changes = await changeDetector.getChangedFiles();

				if (changes.length === 0) {
					console.log(chalk.green("No changes detected."));
					return;
				}

				console.log(chalk.dim(`Found ${changes.length} changed files:`));
				for (const file of changes) {
					console.log(chalk.dim(`  - ${file}`));
				}
				console.log();

				const entryPoints = await expander.expand(
					config.project.entry_points,
					changes,
				);
				const jobs = jobGen.generateJobs(entryPoints);

				if (jobs.length === 0) {
					console.log(chalk.yellow("No applicable gates for these changes."));
					return;
				}

				console.log(chalk.bold(`Would run ${jobs.length} gate(s):\n`));
				printJobsByWorkDir(jobs);
			} catch (error: unknown) {
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}

function groupByWorkDir(jobs: Job[]): Map<string, Job[]> {
	const map = new Map<string, Job[]>();
	for (const job of jobs) {
		if (!map.has(job.workingDirectory)) {
			map.set(job.workingDirectory, []);
		}
		map.get(job.workingDirectory)?.push(job);
	}
	return map;
}

function printJobsByWorkDir(jobs: Job[]): void {
	for (const [workDir, wdJobs] of groupByWorkDir(jobs).entries()) {
		console.log(chalk.cyan(`Working directory: ${workDir}`));
		for (const job of wdJobs) {
			const typeLabel =
				job.type === "check" ? chalk.yellow("check") : chalk.blue("review");
			console.log(`  ${typeLabel} ${chalk.bold(job.name)}`);
		}
		console.log();
	}
}

import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { ChangeDetector } from "../core/change-detector.js";
import { EntryPointExpander } from "../core/entry-point.js";
import { type Job, JobGenerator } from "../core/job.js";

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

				// Determine effective base branch
				// Priority: CLI override > CI env var > config
				const effectiveBaseBranch =
					options.baseBranch ||
					(process.env.GITHUB_BASE_REF &&
					(process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")
						? process.env.GITHUB_BASE_REF
						: null) ||
					config.project.base_branch;

				const changeDetector = new ChangeDetector(effectiveBaseBranch, {
					commit: options.commit,
					uncommitted: options.uncommitted,
				});
				const expander = new EntryPointExpander();
				const jobGen = new JobGenerator(config);

				console.log(chalk.dim("Detecting changes..."));
				const changes = await changeDetector.getChangedFiles();

				if (changes.length === 0) {
					console.log(chalk.green("No changes detected."));
					return;
				}

				console.log(chalk.dim(`Found ${changes.length} changed files:`));
				changes.forEach((file) => {
					console.log(chalk.dim(`  - ${file}`));
				});
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

				// Group jobs by working directory for better display
				const jobsByWorkDir = new Map<string, Job[]>();
				for (const job of jobs) {
					const key = job.workingDirectory;
					if (!jobsByWorkDir.has(key)) {
						jobsByWorkDir.set(key, []);
					}
					jobsByWorkDir.get(key)?.push(job);
				}

				for (const [workDir, wdJobs] of jobsByWorkDir.entries()) {
					console.log(chalk.cyan(`Working directory: ${workDir}`));
					for (const job of wdJobs) {
						const typeLabel =
							job.type === "check"
								? chalk.yellow("check")
								: chalk.blue("review");
						console.log(`  ${typeLabel} ${chalk.bold(job.name)}`);
					}
					console.log();
				}
			} catch (error: unknown) {
				const err = error as { message?: string };
				console.error(chalk.red("Error:"), err.message);
				process.exit(1);
			}
		});
}

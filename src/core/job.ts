import type {
	CheckGateConfig,
	LoadedConfig,
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../config/types.js";
import type { ExpandedEntryPoint } from "./entry-point.js";

export type JobType = "check" | "review";

export interface Job {
	id: string; // unique id for logging/tracking
	type: JobType;
	name: string;
	entryPoint: string;
	gateConfig: CheckGateConfig | (ReviewGateConfig & ReviewPromptFrontmatter);
	workingDirectory: string;
}

export class JobGenerator {
	constructor(private config: LoadedConfig) {}

	generateJobs(expandedEntryPoints: ExpandedEntryPoint[]): Job[] {
		const jobs: Job[] = [];
		const seenJobs = new Set<string>();
		const isCI =
			process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

		for (const ep of expandedEntryPoints) {
			// 1. Process Checks
			if (ep.config.checks) {
				for (const checkName of ep.config.checks) {
					const checkConfig = this.config.checks[checkName];
					if (!checkConfig) {
						console.warn(
							`Warning: Check gate '${checkName}' configured in entry point '${ep.path}' but not found in checks definitions.`,
						);
						continue;
					}

					// Filter based on environment
					if (isCI && !checkConfig.run_in_ci) continue;
					if (!isCI && !checkConfig.run_locally) continue;

					const workingDirectory =
						checkConfig.working_directory === "entrypoint"
							? ep.path
							: checkConfig.working_directory || ep.path;
					const jobKey = `check:${checkName}:${workingDirectory}`;

					// Skip if we've already created a job for this check/working-directory combination
					if (seenJobs.has(jobKey)) {
						continue;
					}
					seenJobs.add(jobKey);

					jobs.push({
						id: `check:${workingDirectory}:${checkName}`,
						type: "check",
						name: checkName,
						entryPoint: ep.path,
						gateConfig: checkConfig,
						workingDirectory: workingDirectory,
					});
				}
			}

			// 2. Process Reviews
			if (ep.config.reviews) {
				for (const reviewName of ep.config.reviews) {
					const reviewConfig = this.config.reviews[reviewName];
					if (!reviewConfig) {
						console.warn(
							`Warning: Review gate '${reviewName}' configured in entry point '${ep.path}' but not found in reviews definitions.`,
						);
						continue;
					}

					// Filter based on environment
					if (isCI && !reviewConfig.run_in_ci) continue;
					if (!isCI && !reviewConfig.run_locally) continue;

					jobs.push({
						id: `review:${ep.path}:${reviewName}`,
						type: "review",
						name: reviewName,
						entryPoint: ep.path,
						gateConfig: reviewConfig,
						workingDirectory: ep.path, // Reviews always run in context of entry point
					});
				}
			}
		}

		return jobs;
	}
}

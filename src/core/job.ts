import type {
	CheckGateConfig,
	LoadedConfig,
	LoadedReviewGateConfig,
} from "../config/types.js";
import type { ExpandedEntryPoint } from "./entry-point.js";

export type JobType = "check" | "review";

export interface Job {
	id: string; // unique id for logging/tracking
	type: JobType;
	name: string;
	entryPoint: string;
	gateConfig: CheckGateConfig | LoadedReviewGateConfig;
	workingDirectory: string;
}

/** Check if a gate should run in the current environment. */
function shouldRunGate(
	gateConfig: { run_in_ci?: boolean; run_locally?: boolean },
	isCI: boolean,
): boolean {
	if (isCI && !gateConfig.run_in_ci) return false;
	if (!(isCI || gateConfig.run_locally)) return false;
	return true;
}

export class JobGenerator {
	constructor(private config: LoadedConfig) {}

	generateJobs(expandedEntryPoints: ExpandedEntryPoint[]): Job[] {
		const jobs: Job[] = [];
		const seenJobs = new Set<string>();
		const isCI =
			process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

		for (const ep of expandedEntryPoints) {
			this.collectCheckJobs(ep, isCI, seenJobs, jobs);
			this.collectReviewJobs(ep, isCI, jobs);
		}

		return jobs;
	}

	private collectCheckJobs(
		ep: ExpandedEntryPoint,
		isCI: boolean,
		seenJobs: Set<string>,
		jobs: Job[],
	): void {
		if (!ep.config.checks) return;

		for (const checkName of ep.config.checks) {
			const checkConfig = this.config.checks[checkName];
			if (!checkConfig) {
				console.warn(
					`Warning: Check gate '${checkName}' configured in entry point '${ep.path}' but not found in checks definitions.`,
				);
				continue;
			}

			if (!shouldRunGate(checkConfig, isCI)) continue;

			const workingDirectory =
				checkConfig.working_directory === "entrypoint"
					? ep.path
					: checkConfig.working_directory || ep.path;
			const jobKey = `check:${checkName}:${workingDirectory}`;

			if (seenJobs.has(jobKey)) continue;
			seenJobs.add(jobKey);

			jobs.push({
				id: `check:${workingDirectory}:${checkName}`,
				type: "check",
				name: checkName,
				entryPoint: ep.path,
				gateConfig: checkConfig,
				workingDirectory,
			});
		}
	}

	private collectReviewJobs(
		ep: ExpandedEntryPoint,
		isCI: boolean,
		jobs: Job[],
	): void {
		if (!ep.config.reviews) return;

		for (const reviewName of ep.config.reviews) {
			const reviewConfig = this.config.reviews[reviewName];
			if (!reviewConfig) {
				console.warn(
					`Warning: Review gate '${reviewName}' configured in entry point '${ep.path}' but not found in reviews definitions.`,
				);
				continue;
			}

			if (!shouldRunGate(reviewConfig, isCI)) continue;

			jobs.push({
				id: `review:${ep.path}:${reviewName}`,
				type: "review",
				name: reviewName,
				entryPoint: ep.path,
				gateConfig: reviewConfig,
				workingDirectory: ep.path,
			});
		}
	}
}

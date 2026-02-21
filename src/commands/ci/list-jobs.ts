import { loadCIConfig } from "../../config/ci-loader.js";
import { loadConfig } from "../../config/loader.js";
import type {
	CICheckConfig,
	CISetupStep,
	CheckGateConfig,
	LoadedConfig,
} from "../../config/types.js";
import {
	type ExpandedEntryPoint,
	EntryPointExpander,
} from "../../core/entry-point.js";

interface MatrixJob {
	id: string;
	name: string;
	entry_point: string;
	working_directory: string;
	command: string;
	runtimes: string[];
	services: string[];
	setup: string;
	global_setup: string;
}

/** Build a matrix job from an entry point and check, if valid and not a duplicate. */
function buildMatrixJob(
	ep: ExpandedEntryPoint,
	check: CICheckConfig,
	checkDef: CheckGateConfig,
	seenJobs: Set<string>,
	globalSetup: string,
): MatrixJob | null {
	const workingDirectory = checkDef.working_directory || ep.path;
	const jobKey = `${check.name}:${workingDirectory}`;
	if (seenJobs.has(jobKey)) return null;
	seenJobs.add(jobKey);

	return {
		id: `${check.name}-${ep.path.replace(/\//g, "-")}`,
		name: check.name,
		entry_point: ep.path,
		working_directory: workingDirectory,
		command: checkDef.command,
		runtimes: check.requires_runtimes || [],
		services: check.requires_services || [],
		setup: formatSetup(check.setup || undefined),
		global_setup: globalSetup,
	};
}

/** Collect matrix jobs for a single entry point across all CI checks. */
function collectJobsForEntryPoint(
	ep: ExpandedEntryPoint,
	ciChecks: CICheckConfig[],
	config: LoadedConfig,
	seenJobs: Set<string>,
	globalSetup: string,
): MatrixJob[] {
	const jobs: MatrixJob[] = [];
	const allowedChecks = new Set(ep.config.checks || []);

	for (const check of ciChecks) {
		if (!allowedChecks.has(check.name)) continue;

		const checkDef = config.checks[check.name];
		if (!checkDef) {
			console.warn(
				`Warning: Check '${check.name}' found in CI config but not defined in checks/*.yml`,
			);
			continue;
		}

		const job = buildMatrixJob(ep, check, checkDef, seenJobs, globalSetup);
		if (job) jobs.push(job);
	}
	return jobs;
}

export async function listJobs(): Promise<void> {
	try {
		const config = await loadConfig();
		const ciConfig = await loadCIConfig();
		const expander = new EntryPointExpander();
		const expandedEntryPoints = await expander.expandAll(
			config.project.entry_points,
		);

		const matrixJobs: MatrixJob[] = [];
		const seenJobs = new Set<string>();
		const globalSetup = formatSetup(ciConfig.setup || undefined);

		if (ciConfig.checks) {
			for (const ep of expandedEntryPoints) {
				const jobs = collectJobsForEntryPoint(
					ep, ciConfig.checks, config, seenJobs, globalSetup,
				);
				matrixJobs.push(...jobs);
			}
		}

		const output = {
			matrix: matrixJobs,
			services: ciConfig.services || {},
			runtimes: ciConfig.runtimes || {},
		};

		console.log(JSON.stringify(output));
	} catch (e) {
		console.error("Error generating CI jobs:", e);
		process.exit(1);
	}
}

const formatSetup = (steps: CISetupStep[] | null | undefined): string => {
	if (!steps || steps.length === 0) return "";
	return steps
		.map((s) => {
			const cmd = s.working_directory
				? `(cd "${s.working_directory}" && ${s.run})`
				: s.run;
			return `echo "::group::${s.name}"
${cmd}
echo "::endgroup::"`;
		})
		.join("\n");
};

import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewFullJsonOutput } from "../gates/result.js";
import type { PreviousViolation } from "../gates/result.js";
import { getCategoryLogger } from "../output/app-logger.js";
import type {
	AdapterFailure,
	GateFailures,
	ParseFileFn,
	PassedSlot,
} from "./log-parser-helpers.js";
import { parseReviewFilename } from "./log-parser-helpers.js";

const log = getCategoryLogger("log-parser");

// ---- findPreviousFailures helpers ----

interface ReviewSlotInfo {
	filename: string;
	runNumber: number;
	ext: string;
}

/**
 * Categorizes files into review slots (with @index pattern) and check prefix maps.
 */
export function categorizeFiles(
	files: string[],
	gateFilter?: string,
): {
	reviewSlotMap: Map<string, ReviewSlotInfo>;
	checkPrefixMap: Map<string, Map<number, Set<string>>>;
} {
	const reviewSlotMap = new Map<string, ReviewSlotInfo>();
	const checkPrefixMap = new Map<string, Map<number, Set<string>>>();

	for (const file of files) {
		const isLog = file.endsWith(".log");
		const isJson = file.endsWith(".json");
		if (!(isLog || isJson)) continue;
		if (gateFilter && !file.includes(gateFilter)) continue;

		const parsed = parseReviewFilename(file);
		if (parsed) {
			updateReviewSlot(reviewSlotMap, file, parsed);
		} else {
			addCheckFile(checkPrefixMap, file);
		}
	}

	return { reviewSlotMap, checkPrefixMap };
}

function updateReviewSlot(
	reviewSlotMap: Map<string, ReviewSlotInfo>,
	file: string,
	parsed: { jobId: string; reviewIndex: number; runNumber: number; ext: string },
): void {
	const slotKey = `${parsed.jobId}:${parsed.reviewIndex}`;
	const existing = reviewSlotMap.get(slotKey);
	const shouldUpdate =
		!existing ||
		parsed.runNumber > existing.runNumber ||
		(parsed.runNumber === existing.runNumber &&
			parsed.ext === "json" &&
			existing.ext === "log");
	if (shouldUpdate) {
		reviewSlotMap.set(slotKey, {
			filename: file,
			runNumber: parsed.runNumber,
			ext: parsed.ext,
		});
	}
}

function addCheckFile(
	checkPrefixMap: Map<string, Map<number, Set<string>>>,
	file: string,
): void {
	const m = file.match(/^(.+)\.(\d+)\.(log|json)$/);
	if (!(m?.[1] && m[2] && m[3])) return;

	const prefix = m[1];
	const runNum = parseInt(m[2], 10);
	const ext = m[3];

	let runMap = checkPrefixMap.get(prefix);
	if (!runMap) {
		runMap = new Map();
		checkPrefixMap.set(prefix, runMap);
	}

	let exts = runMap.get(runNum);
	if (!exts) {
		exts = new Set();
		runMap.set(runNum, exts);
	}
	exts.add(ext);
}

/**
 * Checks if a JSON review file has status "pass" or "skipped_prior_pass".
 */
export async function isJsonReviewPassing(jsonPath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(jsonPath, "utf-8");
		const data: ReviewFullJsonOutput = JSON.parse(content);
		return data.status === "pass" || data.status === "skipped_prior_pass";
	} catch {
		return false;
	}
}

/**
 * Checks if a log file represents a passing review.
 */
export async function isLogReviewPassing(logPath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(logPath, "utf-8");
		if (content.includes("Status: skipped_prior_pass")) return true;
		if (content.includes("--- Review Output")) {
			return content.includes("Status: PASS");
		}
		return content.includes("Result: pass");
	} catch {
		return false;
	}
}

/**
 * Filters violations by status, removing skipped and warning on unexpected statuses.
 */
export function filterViolationsByStatus(
	violations: PreviousViolation[],
	jobId: string,
): PreviousViolation[] {
	const filtered: PreviousViolation[] = [];
	for (const v of violations) {
		const status = v.status || "new";
		if (status === "skipped") continue;
		if (status !== "new" && status !== "fixed" && status !== "skipped") {
			log.warn(
				`Unexpected status "${status}" for violation in ${jobId}. Treating as "new".`,
			);
			v.status = "new";
		}
		filtered.push(v);
	}
	return filtered;
}

function recordPassedSlot(
	passedSlots: Map<string, Map<number, PassedSlot>>,
	jobId: string,
	reviewIndex: number,
	runNumber: number,
	adapter: string,
): void {
	let jobSlots = passedSlots.get(jobId);
	if (!jobSlots) {
		jobSlots = new Map();
		passedSlots.set(jobId, jobSlots);
	}
	jobSlots.set(reviewIndex, { reviewIndex, passIteration: runNumber, adapter });
}

function accumulateReviewFailures(
	jobReviewFailures: Map<string, AdapterFailure[]>,
	failure: GateFailures,
	reviewIndex: number,
	jobId: string,
): void {
	for (const af of failure.adapterFailures) {
		af.reviewIndex = reviewIndex;
		af.violations = filterViolationsByStatus(af.violations, jobId);

		if (af.violations.length > 0) {
			let failures = jobReviewFailures.get(jobId);
			if (!failures) {
				failures = [];
				jobReviewFailures.set(jobId, failures);
			}
			failures.push(af);
		}
	}
}

/**
 * Processes review slots and returns adapter failures grouped by jobId, plus passed slots.
 */
export async function processReviewSlots(
	logDir: string,
	reviewSlotMap: Map<string, ReviewSlotInfo>,
	includePassedSlots: boolean | undefined,
	parseJsonFn: ParseFileFn,
	parseLogFn: ParseFileFn,
): Promise<{
	jobReviewFailures: Map<string, AdapterFailure[]>;
	passedSlots: Map<string, Map<number, PassedSlot>>;
}> {
	const jobReviewFailures = new Map<string, AdapterFailure[]>();
	const passedSlots = new Map<string, Map<number, PassedSlot>>();

	for (const [slotKey, fileInfo] of reviewSlotMap.entries()) {
		const sepIdx = slotKey.lastIndexOf(":");
		const jobId = slotKey.substring(0, sepIdx);
		const reviewIndex = parseInt(slotKey.substring(sepIdx + 1), 10);

		const parsed = parseReviewFilename(fileInfo.filename);
		const adapter = parsed?.adapter || "unknown";

		const filePath = path.join(logDir, fileInfo.filename);
		const isPassing = fileInfo.ext === "json"
			? await isJsonReviewPassing(filePath)
			: await isLogReviewPassing(filePath);

		if (isPassing && includePassedSlots) {
			recordPassedSlot(passedSlots, jobId, reviewIndex, fileInfo.runNumber, adapter);
			continue;
		}

		const failure = fileInfo.ext === "json"
			? await parseJsonFn(filePath)
			: await parseLogFn(filePath);

		if (failure) {
			accumulateReviewFailures(jobReviewFailures, failure, reviewIndex, jobId);
		}
	}

	return { jobReviewFailures, passedSlots };
}

/**
 * Processes check (non-review) files and returns failures.
 */
export async function processCheckFiles(
	logDir: string,
	checkPrefixMap: Map<string, Map<number, Set<string>>>,
	parseJsonFn: ParseFileFn,
	parseLogFn: ParseFileFn,
): Promise<GateFailures[]> {
	const failures: GateFailures[] = [];

	for (const [prefix, runMap] of checkPrefixMap.entries()) {
		const latestRun = Math.max(...runMap.keys());
		const exts = runMap.get(latestRun);
		if (!exts) continue;

		let failure: GateFailures | null = null;
		if (exts.has("json")) {
			failure = await parseJsonFn(
				path.join(logDir, `${prefix}.${latestRun}.json`),
			);
		} else if (exts.has("log")) {
			failure = await parseLogFn(
				path.join(logDir, `${prefix}.${latestRun}.log`),
			);
		}

		if (!failure) continue;

		for (const af of failure.adapterFailures) {
			af.violations = filterViolationsByStatus(af.violations, failure.jobId);
		}

		const totalViolations = failure.adapterFailures.reduce(
			(sum, af) => sum + af.violations.length,
			0,
		);
		if (totalViolations > 0) {
			failures.push(failure);
		}
	}

	return failures;
}

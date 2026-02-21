import { getCategoryLogger } from "../output/app-logger.js";
import {
	type DiffFileRange,
	isValidViolationLocation,
	parseDiff,
} from "../utils/diff-parser.js";
import { markAdapterUnhealthy } from "../utils/execution-state.js";
import type { PreviousViolation } from "./result.js";
import { writeJsonResult } from "./review-agg.js";
import type {
	EvaluationResult,
	ReviewConfig,
	ReviewJsonOutput,
} from "./review-types.js";
import { CHARS_PER_TOKEN, JSON_SYSTEM_INSTRUCTION } from "./review-types.js";

const log = getCategoryLogger("gate", "review");

// ── Stats Logging ───────────────────────────────────────────────────

export function logDiffStats(
	diff: string,
	mainLogger: (msg: string) => Promise<void>,
): void {
	const diffLines = diff.split("\n").length;
	const diffChars = diff.length;
	const diffEstTokens = Math.ceil(diffChars / CHARS_PER_TOKEN);
	const diffFileRanges = parseDiff(diff);
	const diffFiles = diffFileRanges.size;
	const msg = `[diff-stats] files=${diffFiles} lines=${diffLines} chars=${diffChars} est_tokens=${diffEstTokens}`;
	log.debug(msg);
	mainLogger(`${msg}\n`);
}

export function logInputStats(
	prompt: string,
	diff: string,
	adapterLogger: (msg: string) => Promise<void>,
): void {
	const promptChars = prompt.length;
	const diffChars = diff.length;
	const totalInputChars = promptChars + diffChars;
	const promptEstTokens = Math.ceil(promptChars / CHARS_PER_TOKEN);
	const diffEstTokens = Math.ceil(diffChars / CHARS_PER_TOKEN);
	const totalEstTokens = promptEstTokens + diffEstTokens;
	const msg = `[input-stats] prompt_chars=${promptChars} diff_chars=${diffChars} total_chars=${totalInputChars} prompt_est_tokens=${promptEstTokens} diff_est_tokens=${diffEstTokens} total_est_tokens=${totalEstTokens}`;
	adapterLogger(`${msg}\n`);
}

// ── Prompt Building ─────────────────────────────────────────────────

export function buildReviewPrompt(
	config: ReviewConfig,
	previousViolations: PreviousViolation[] = [],
): string {
	const baseContent = config.promptContent || "";

	if (previousViolations.length > 0) {
		return (
			baseContent +
			"\n\n" +
			buildPreviousFailuresSection(previousViolations) +
			"\n" +
			JSON_SYSTEM_INSTRUCTION
		);
	}

	return `${baseContent}\n${JSON_SYSTEM_INSTRUCTION}`;
}

export function buildPreviousFailuresSection(
	violations: PreviousViolation[],
): string {
	const toVerify = violations.filter((v) => v.status === "fixed");
	const unaddressed = violations.filter(
		(v) => v.status === "new" || !v.status,
	);
	const affectedFiles = [...new Set(violations.map((v) => v.file))];
	const lines: string[] = [];

	lines.push(buildRerunHeader());

	if (toVerify.length === 0) {
		lines.push("(No violations were marked as FIXED for verification)\n");
	} else {
		for (const [i, v] of toVerify.entries()) {
			lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
			if (v.fix) lines.push(`   Suggested fix: ${v.fix}`);
			if (v.result) lines.push(`   Agent result: ${v.result}`);
			lines.push("");
		}
	}

	if (unaddressed.length > 0) {
		lines.push(buildUnaddressedHeader());
		for (const [i, v] of unaddressed.entries()) {
			lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
		}
		lines.push("");
	}

	lines.push(buildRerunInstructions(affectedFiles));
	return lines.join("\n");
}

function buildRerunHeader(): string {
	return `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
RERUN MODE: VERIFY PREVIOUS FIXES ONLY
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

This is a RERUN review. The agent attempted to fix some of the violations listed below.
Your task is STRICTLY LIMITED to verifying the fixes for violations marked as FIXED.

PREVIOUS VIOLATIONS TO VERIFY:
`;
}

function buildUnaddressedHeader(): string {
	return `UNADDRESSED VIOLATIONS (STILL FAILING):
The following violations were NOT marked as fixed or skipped and are still active failures:
`;
}

function buildRerunInstructions(affectedFiles: string[]): string {
	return `STRICT INSTRUCTIONS FOR RERUN MODE:

1. VERIFY FIXES: Check if each violation marked as FIXED above has been addressed
   - For violations that are fixed, confirm they no longer appear
   - For violations that remain unfixed, include them in your violations array (status: "new")

2. UNADDRESSED VIOLATIONS: You MUST include all UNADDRESSED violations listed above in your output array if they still exist.

3. CHECK FOR REGRESSIONS ONLY: You may ONLY report NEW violations if they:
   - Are in FILES that were modified to fix the above violations: ${affectedFiles.join(", ")}
   - Are DIRECTLY caused by the fix changes (e.g., a fix introduced a new bug)
   - Are in the same function/region that was modified to address a previous violation

4. Return status "pass" ONLY if ALL previous violations (including unaddressed ones) are now fixed AND no regressions were introduced.
   Otherwise, return status "fail" and list all remaining violations.

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;
}

// ── Output Evaluation ───────────────────────────────────────────────

export function evaluateOutput(
	output: string,
	diff?: string,
): EvaluationResult {
	const diffRanges = diff ? parseDiff(diff) : undefined;

	try {
		const fromBlock = tryParseJsonBlock(output);
		if (fromBlock) return validateAndReturn(fromBlock, diffRanges);

		const fromLast = tryParseLastJson(output);
		if (fromLast) return validateAndReturn(fromLast, diffRanges);

		const fromFirst = tryParseFirstJson(output);
		if (fromFirst) return validateAndReturn(fromFirst, diffRanges);

		return {
			status: "error",
			message: "No valid JSON object found in output",
		};
	} catch (error: unknown) {
		const err = error as { message?: string };
		return {
			status: "error",
			message: `Failed to parse JSON output: ${err.message}`,
		};
	}
}

function tryParseJsonBlock(output: string): ReviewJsonOutput | null {
	const match = output.match(/```json\s*([\s\S]*?)\s*```/);
	if (!match?.[1]) return null;
	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

function tryParseLastJson(output: string): ReviewJsonOutput | null {
	const end = output.lastIndexOf("}");
	if (end === -1) return null;

	let start = output.lastIndexOf("{", end);
	while (start !== -1) {
		try {
			const json = JSON.parse(output.substring(start, end + 1));
			if (json.status) return json;
		} catch {
			// Not valid JSON, keep searching
		}
		start = output.lastIndexOf("{", start - 1);
	}
	return null;
}

function tryParseFirstJson(output: string): ReviewJsonOutput | null {
	const firstStart = output.indexOf("{");
	const end = output.lastIndexOf("}");
	if (firstStart === -1 || end === -1 || end <= firstStart) return null;

	try {
		return JSON.parse(output.substring(firstStart, end + 1));
	} catch {
		return null;
	}
}

export function validateAndReturn(
	json: ReviewJsonOutput,
	diffRanges?: Map<string, DiffFileRange>,
): EvaluationResult {
	if (!json.status || (json.status !== "pass" && json.status !== "fail")) {
		return {
			status: "error",
			message: 'Invalid JSON: missing or invalid "status" field',
			json,
		};
	}

	if (json.status === "pass") {
		return { status: "pass", message: json.message || "Passed", json };
	}

	const filterResult = filterViolationsByDiff(json, diffRanges);
	if (filterResult) return filterResult;

	const violationCount = Array.isArray(json.violations)
		? json.violations.length
		: "some";
	return {
		status: "fail",
		message: `Found ${violationCount} violations`,
		json,
		filteredCount: 0,
	};
}

function filterViolationsByDiff(
	json: ReviewJsonOutput,
	diffRanges?: Map<string, DiffFileRange>,
): EvaluationResult | null {
	if (!(Array.isArray(json.violations) && diffRanges && diffRanges.size > 0)) {
		return null;
	}

	const originalCount = json.violations.length;

	json.violations = json.violations.filter(
		(v: { file: string; line: number | string }) => {
			const lineNum = coerceLineNumber(v.line);
			return isValidViolationLocation(v.file, lineNum, diffRanges);
		},
	);

	const filteredCount = originalCount - json.violations.length;

	if (json.violations.length === 0) {
		return {
			status: "pass",
			message: `Passed (${filteredCount} out-of-scope violations filtered)`,
			json: { status: "pass" },
			filteredCount,
		};
	}

	const violationCount = json.violations.length;
	return {
		status: "fail",
		message: `Found ${violationCount} violations`,
		json,
		filteredCount,
	};
}

function coerceLineNumber(line: number | string): number | undefined {
	if (typeof line === "number") return line;
	const trimmed = typeof line === "string" ? line.trim() : undefined;
	if (trimmed && /^\d+$/.test(trimmed)) return Number(trimmed);
	return undefined;
}

// ── Rerun Filtering ─────────────────────────────────────────────────

export async function applyRerunFiltering(
	evaluation: EvaluationResult,
	adapterPreviousViolations: PreviousViolation[],
	rerunThreshold: "critical" | "high" | "medium" | "low",
	adapterLogger: (msg: string) => Promise<void>,
): Promise<void> {
	if (
		!(
			adapterPreviousViolations.length > 0 &&
			evaluation.json?.violations &&
			evaluation.status === "fail"
		)
	) {
		return;
	}

	const priorities = ["critical", "high", "medium", "low"];
	const thresholdIndex = priorities.indexOf(rerunThreshold);
	const originalCount = evaluation.json.violations.length;

	evaluation.json.violations = evaluation.json.violations.filter((v) => {
		const priority = v.priority || "low";
		const priorityIndex = priorities.indexOf(priority);
		if (priorityIndex === -1) return true;
		return priorityIndex <= thresholdIndex;
	});

	const filteredByThreshold =
		originalCount - evaluation.json.violations.length;

	if (filteredByThreshold > 0) {
		await adapterLogger(
			`Note: ${filteredByThreshold} new violations filtered due to rerun threshold (${rerunThreshold})\n`,
		);
		evaluation.filteredCount =
			(evaluation.filteredCount || 0) + filteredByThreshold;

		if (evaluation.json.violations.length === 0) {
			evaluation.status = "pass";
			evaluation.message = `Passed (${filteredByThreshold} below-threshold violations filtered)`;
			evaluation.json.status = "pass";
		}
	}
}

// ── Review Output Handling ──────────────────────────────────────────

export async function handleReviewOutput(
	evaluation: EvaluationResult,
	adapter: { name: string },
	reviewIndex: number,
	output: string,
	logPath: string,
	adapterLogger: (msg: string) => Promise<void>,
	mainLogger: (msg: string) => Promise<void>,
	_logDir: string | undefined,
): Promise<Array<{
	file: string;
	line: number | string;
	issue: string;
	result?: string | null;
}>> {
	await logErrorAndFilterInfo(evaluation, adapter, adapterLogger, mainLogger);

	let skipped: Array<{
		file: string;
		line: number | string;
		issue: string;
		result?: string | null;
	}> = [];

	if (evaluation.json) {
		skipped = await logParsedResult(
			evaluation, adapter, output, logPath, adapterLogger,
		);
	}

	const resultMsg = `Review result (${adapter.name}@${reviewIndex}): ${evaluation.status} - ${evaluation.message}`;
	await adapterLogger(`${resultMsg}\n`);

	return skipped;
}

async function logErrorAndFilterInfo(
	evaluation: EvaluationResult,
	adapter: { name: string },
	adapterLogger: (msg: string) => Promise<void>,
	mainLogger: (msg: string) => Promise<void>,
): Promise<void> {
	if (evaluation.status === "error") {
		await adapterLogger(`Error: ${evaluation.message}\n`);
		await mainLogger(
			`Error parsing review from ${adapter.name}: ${evaluation.message}\n`,
		);
	}

	if (evaluation.filteredCount && evaluation.filteredCount > 0) {
		await adapterLogger(
			`Note: ${evaluation.filteredCount} out-of-scope violations filtered\n`,
		);
	}
}

async function logParsedResult(
	evaluation: EvaluationResult,
	adapter: { name: string },
	output: string,
	logPath: string,
	adapterLogger: (msg: string) => Promise<void>,
): Promise<Array<{
	file: string;
	line: number | string;
	issue: string;
	result?: string | null;
}>> {
	if (!evaluation.json) return [];

	await logViolationWarnings(evaluation.json, adapterLogger);

	const jsonPath = await writeJsonResult(
		logPath, adapter.name, evaluation.status, output, evaluation.json,
	);

	const skipped = (evaluation.json.violations || [])
		.filter((v) => v.status === "skipped")
		.map((v) => ({
			file: v.file,
			line: v.line,
			issue: v.issue,
			result: v.result,
		}));

	await adapterLogger(`\n--- Parsed Result (${adapter.name}) ---\n`);
	await logStatusDetails(evaluation, jsonPath, adapterLogger);
	await adapterLogger(`---------------------\n`);

	return skipped;
}

async function logViolationWarnings(
	json: ReviewJsonOutput,
	adapterLogger: (msg: string) => Promise<void>,
): Promise<void> {
	if (json.status !== "fail") return;
	if (!Array.isArray(json.violations)) {
		await adapterLogger(
			"Warning: Missing 'violations' array in failure response\n",
		);
		return;
	}
	for (const v of json.violations) {
		if (
			!v.file ||
			v.line === undefined ||
			v.line === null ||
			!v.issue ||
			!v.priority ||
			!v.status
		) {
			await adapterLogger(
				`Warning: Violation missing required fields: ${JSON.stringify(v)}\n`,
			);
		}
	}
}

async function logStatusDetails(
	evaluation: EvaluationResult,
	jsonPath: string,
	adapterLogger: (msg: string) => Promise<void>,
): Promise<void> {
	if (!evaluation.json) return;

	if (
		evaluation.json.status === "fail" &&
		Array.isArray(evaluation.json.violations)
	) {
		await adapterLogger(`Status: FAIL\n`);
		await adapterLogger(`Review: ${jsonPath}\n`);
		await adapterLogger(`Violations:\n`);
		for (const [i, v] of evaluation.json.violations.entries()) {
			await adapterLogger(
				`${i + 1}. ${v.file}:${v.line || "?"} - ${v.issue}\n`,
			);
			if (v.fix) await adapterLogger(`   Fix: ${v.fix}\n`);
		}
	} else if (evaluation.json.status === "pass") {
		await adapterLogger(`Status: PASS\n`);
		if (evaluation.json.message) {
			await adapterLogger(`Message: ${evaluation.json.message}\n`);
		}
	} else {
		await adapterLogger(`Status: ${evaluation.json.status}\n`);
		await adapterLogger(
			`Raw: ${JSON.stringify(evaluation.json, null, 2)}\n`,
		);
	}
}

// ── Usage Limit Handling ────────────────────────────────────────────

export async function handleUsageLimit(
	adapter: { name: string },
	logDir: string | undefined,
	mainLogger: (msg: string) => Promise<void>,
): Promise<void> {
	const reason = "Usage limit exceeded";
	if (logDir) {
		await markAdapterUnhealthy(logDir, adapter.name, reason);
		log.debug(
			`Adapter ${adapter.name} marked unhealthy for 1 hour: ${reason}`,
		);
		await mainLogger(
			`${adapter.name} marked unhealthy for 1 hour: ${reason}\n`,
		);
	}
}

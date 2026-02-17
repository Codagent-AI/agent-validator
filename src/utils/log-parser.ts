import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewFullJsonOutput } from "../gates/result.js";
import { getCategoryLogger } from "../output/app-logger.js";

export type { PreviousViolation } from "../gates/result.js";

import type { PreviousViolation } from "../gates/result.js";

const log = getCategoryLogger("log-parser");

export interface AdapterFailure {
	adapterName: string; // e.g., 'claude', 'gemini'
	reviewIndex?: number; // 1-based review index from @N in filename
	violations: PreviousViolation[];
}

export interface PassedSlot {
	reviewIndex: number; // 1-based review index
	passIteration: number; // Iteration number when this slot passed
	adapter: string; // Adapter name that passed the review
}

/**
 * Result from findPreviousFailures that includes both failures and passed slots.
 * passedSlots maps jobId -> reviewIndex -> { adapter, passIteration }
 */
export interface PreviousFailuresResult {
	failures: GateFailures[];
	passedSlots: Map<string, Map<number, PassedSlot>>;
}

export interface GateFailures {
	jobId: string; // This will be the sanitized Job ID (filename without extension)
	gateName: string; // Parsed or empty
	entryPoint: string; // Parsed or empty
	adapterFailures: AdapterFailure[]; // Failures grouped by adapter
	logPath: string;
}

/**
 * Parse a review filename to extract the job ID, adapter, review index, and run number.
 * Pattern: <jobId>_<adapter>@<reviewIndex>.<runNumber>.(log|json)
 * Returns null if the filename doesn't match the review pattern.
 */
export function parseReviewFilename(filename: string): {
	jobId: string;
	adapter: string;
	reviewIndex: number;
	runNumber: number;
	ext: string;
} | null {
	// Match: <prefix>_<adapter>@<index>.<runNum>.(log|json)
	const m = filename.match(/^(.+)_([^@]+)@(\d+)\.(\d+)\.(log|json)$/);
	if (!m) return null;
	const [, jobId, adapter, indexStr, runStr, ext] = m;
	if (!jobId || !adapter || !indexStr || !runStr || !ext) return null;
	return {
		jobId,
		adapter,
		reviewIndex: parseInt(indexStr, 10),
		runNumber: parseInt(runStr, 10),
		ext,
	};
}

/**
 * Parses a JSON review file.
 */
export async function parseJsonReviewFile(
	jsonPath: string,
): Promise<GateFailures | null> {
	try {
		const content = await fs.readFile(jsonPath, "utf-8");
		const data: ReviewFullJsonOutput = JSON.parse(content);
		const filename = path.basename(jsonPath);

		// Extract jobId: strip the _adapter@index.runNum.json suffix
		const parsed = parseReviewFilename(filename);
		const jobId = parsed ? parsed.jobId : filename.replace(/\.\d+\.json$/, "");

		if (data.status === "pass" || data.status === "skipped_prior_pass") {
			return null;
		}

		const violations = (data.violations || []).map((v) => ({
			...v,
			status: v.status || "new",
		}));

		if (violations.length === 0 && data.status === "fail") {
			violations.push({
				file: "unknown",
				line: "?",
				issue: "Previous run failed but no violations found in JSON",
				status: "new",
			});
		}

		if (violations.length === 0) return null;

		return {
			jobId,
			gateName: "",
			entryPoint: "",
			adapterFailures: [
				{
					adapterName: data.adapter,
					reviewIndex: parsed?.reviewIndex,
					violations,
				},
			],
			logPath: jsonPath.replace(/\.json$/, ".log"),
		};
	} catch (error) {
		log.warn(`Failed to parse JSON review file: ${jsonPath} - ${error}`);
		return null;
	}
}

/**
 * Extract the log prefix (job ID) from a numbered log filename.
 * Handles both patterns:
 *   - Check: `check_src_test.2.log` -> `check_src_test`
 *   - Review (new): `review_src_claude@1.2.log` -> `review_src_claude@1`
 */
export function extractPrefix(filename: string): string {
	// Pattern: <prefix>.<number>.(log|json)
	const m = filename.match(/^(.+)\.\d+\.(log|json)$/);
	if (m?.[1]) return m[1];
	// Fallback for non-numbered files
	return filename.replace(/\.(log|json)$/, "");
}

/**
 * Parses a single log file to extract failures per adapter.
 * Processes both review and check gates.
 */
export async function parseLogFile(
	logPath: string,
): Promise<GateFailures | null> {
	try {
		const content = await fs.readFile(logPath, "utf-8");
		const filename = path.basename(logPath);

		// Try to parse as review filename with @index pattern
		const parsed = parseReviewFilename(filename);
		const jobId = parsed ? parsed.jobId : extractPrefix(filename);

		// Check if it's a review log
		if (content.includes("--- Review Output")) {
			const adapterFailures: AdapterFailure[] = [];
			const sectionRegex = /--- Review Output \(([^)]+)\) ---/g;

			let match: RegExpExecArray | null;
			const sections: { adapter: string; startIndex: number }[] = [];

			for (;;) {
				match = sectionRegex.exec(content);
				if (!match || !match[1]) break;
				sections.push({
					adapter: match[1],
					startIndex: match.index,
				});
			}

			if (sections.length === 0) return null;

			for (let i = 0; i < sections.length; i++) {
				const currentSection = sections[i];
				if (!currentSection) continue;
				const nextSection = sections[i + 1];
				const endIndex = nextSection ? nextSection.startIndex : content.length;
				const sectionContent = content.substring(
					currentSection.startIndex,
					endIndex,
				);

				const violations: PreviousViolation[] = [];
				const parsedResultMatch = sectionContent.match(
					/---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---([\s\S]*?)(?:$|---)/,
				);

				if (parsedResultMatch?.[2]) {
					const parsedContent = parsedResultMatch[2];
					if (parsedContent.includes("Status: PASS")) continue;
					const violationRegex = /^\d+\.\s+(.+?):(\d+|NaN|\?)\s+-\s+(.+)$/gm;
					let vMatch: RegExpExecArray | null;
					for (;;) {
						vMatch = violationRegex.exec(parsedContent);
						if (!vMatch || !vMatch[1] || !vMatch[2] || !vMatch[3]) break;
						const file = vMatch[1].trim();
						let line: number | string = vMatch[2];
						if (line !== "NaN" && line !== "?")
							line = parseInt(line as string, 10);
						const issue = vMatch[3].trim();
						let fix: string | undefined;
						const remainder = parsedContent.substring(
							vMatch.index + vMatch[0].length,
						);
						const fixMatch = remainder.match(/^\s+Fix:\s+(.+)$/m);
						const nextViolationIndex = remainder.search(/^\d+\./m);
						if (
							fixMatch?.index !== undefined &&
							fixMatch[1] &&
							(nextViolationIndex === -1 || fixMatch.index < nextViolationIndex)
						) {
							fix = fixMatch[1].trim();
						}
						violations.push({ file, line, issue, fix });
					}
				} else {
					// Fallback JSON
					const firstBrace = sectionContent.indexOf("{");
					const lastBrace = sectionContent.lastIndexOf("}");
					if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
						try {
							const jsonStr = sectionContent.substring(
								firstBrace,
								lastBrace + 1,
							);
							const json = JSON.parse(jsonStr);
							if (json.violations && Array.isArray(json.violations)) {
								for (const v of json.violations) {
									if (v.file && v.issue) {
										violations.push({
											file: v.file,
											line: v.line || 0,
											issue: v.issue,
											fix: v.fix,
											status: v.status,
											result: v.result,
										});
									}
								}
							}
						} catch (_e) {}
					}
				}

				if (violations.length > 0) {
					adapterFailures.push({
						adapterName: currentSection.adapter,
						reviewIndex: parsed?.reviewIndex,
						violations,
					});
				} else if (parsedResultMatch?.[2]?.includes("Status: FAIL")) {
					adapterFailures.push({
						adapterName: currentSection.adapter,
						reviewIndex: parsed?.reviewIndex,
						violations: [
							{
								file: "unknown",
								line: "?",
								issue:
									"Previous run failed but specific violations could not be parsed",
							},
						],
					});
				}
			}

			if (adapterFailures.length === 0) return null;
			return { jobId, gateName: "", entryPoint: "", adapterFailures, logPath };
		} else {
			// Check log
			if (content.includes("Result: pass")) return null;

			const hasFailure =
				content.includes("Result: fail") ||
				content.includes("Result: error") ||
				content.includes("Command failed:");

			if (!hasFailure) return null;

			return {
				jobId,
				gateName: "",
				entryPoint: "",
				adapterFailures: [
					{
						adapterName: "check",
						violations: [{ file: "check", line: 0, issue: "Check failed" }],
					},
				],
				logPath,
			};
		}
	} catch (_error) {
		return null;
	}
}

export interface RunIteration {
	iteration: number;
	fixed: Array<{
		jobId: string;
		adapter?: string;
		details: string;
	}>;
	skipped: Array<{
		jobId: string;
		adapter?: string;
		file: string;
		line: number | string;
		issue: string;
		result?: string | null;
	}>;
}

/**
 * Reconstructs the history of fixes and skips after all iterations.
 */
export async function reconstructHistory(
	logDir: string,
): Promise<RunIteration[]> {
	try {
		const files = await fs.readdir(logDir);
		const runNumbers = new Set<number>();
		for (const file of files) {
			const m = file.match(/\.(\d+)\.(log|json)$/);
			if (m?.[1]) runNumbers.add(parseInt(m[1], 10));
		}

		const sortedRuns = Array.from(runNumbers).sort((a, b) => a - b);
		const iterations: RunIteration[] = [];

		let previousFailuresByJob = new Map<string, PreviousViolation[]>();

		for (const runNum of sortedRuns) {
			const currentFailuresByJob = new Map<string, PreviousViolation[]>();
			const iteration: RunIteration = {
				iteration: runNum,
				fixed: [],
				skipped: [],
			};

			const runFiles = files.filter((f) => f.includes(`.${runNum}.`));
			const prefixes = new Set(runFiles.map((f) => extractPrefix(f)));

			for (const prefix of prefixes) {
				const jsonFile = runFiles.find(
					(f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith(".json"),
				);
				const logFile = runFiles.find(
					(f) => f.startsWith(`${prefix}.${runNum}.`) && f.endsWith(".log"),
				);

				let failure: GateFailures | null = null;
				if (jsonFile) {
					failure = await parseJsonReviewFile(path.join(logDir, jsonFile));
				} else if (logFile) {
					failure = await parseLogFile(path.join(logDir, logFile));
				}

				if (failure) {
					for (const af of failure.adapterFailures) {
						const key = af.reviewIndex
							? `${failure.jobId}:${af.reviewIndex}`
							: `${failure.jobId}:${af.adapterName}`;
						currentFailuresByJob.set(key, af.violations);

						for (const v of af.violations) {
							if (v.status === "skipped") {
								iteration.skipped.push({
									jobId: failure.jobId,
									adapter: af.adapterName,
									file: v.file,
									line: v.line,
									issue: v.issue,
									result: v.result,
								});
							}
						}
					}
				}
			}

			for (const [key, prevViolations] of previousFailuresByJob.entries()) {
				const current = currentFailuresByJob.get(key);
				const sep = key.lastIndexOf(":");
				const jobId = key.substring(0, sep);
				const adapter = key.substring(sep + 1);

				const trulyFixed = prevViolations.filter((pv) => {
					if (pv.status === "skipped") return false;
					return !current?.some(
						(cv) =>
							cv.file === pv.file &&
							cv.line === pv.line &&
							cv.issue === pv.issue,
					);
				});

				if (trulyFixed.length > 0) {
					if (jobId.startsWith("check_")) {
						iteration.fixed.push({
							jobId,
							details: `${trulyFixed.length} violations resolved`,
						});
					} else {
						for (const f of trulyFixed) {
							iteration.fixed.push({
								jobId,
								adapter,
								details: `${f.file}:${f.line} ${f.issue}`,
							});
						}
					}
				}
			}

			iterations.push(iteration);
			previousFailuresByJob = currentFailuresByJob;
		}

		return iterations;
	} catch (_e) {
		return [];
	}
}

/**
 * Checks if a JSON review file has status "pass" or "skipped_prior_pass".
 * Skipped slots are treated as passing since they represent a previously-passed review.
 */
async function isJsonReviewPassing(jsonPath: string): Promise<boolean> {
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
 * Treats both "Status: PASS" and "Status: skipped_prior_pass" as passing.
 */
async function isLogReviewPassing(logPath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(logPath, "utf-8");
		// Check for skipped review log (skipped slots are treated as passing)
		if (content.includes("Status: skipped_prior_pass")) {
			return true;
		}
		// Check for review log passing
		if (content.includes("--- Review Output")) {
			return content.includes("Status: PASS");
		}
		// Check for check log passing
		return content.includes("Result: pass");
	} catch {
		return false;
	}
}

/**
 * Finds all previous failures and passed slots from the log directory.
 * For review gates with the @<index> pattern, groups by (jobId, reviewIndex)
 * and returns the highest-numbered run for each index.
 * The resulting Map keys are the review index (as string) for lookup by the review gate.
 *
 * Also returns passedSlots: a map of jobId -> reviewIndex -> passIteration
 * for slots that passed in their most recent run.
 */
export async function findPreviousFailures(
	logDir: string,
	gateFilter?: string,
): Promise<GateFailures[]>;
export async function findPreviousFailures(
	logDir: string,
	gateFilter: string | undefined,
	includePassedSlots: true,
): Promise<PreviousFailuresResult>;
export async function findPreviousFailures(
	logDir: string,
	gateFilter?: string,
	includePassedSlots?: boolean,
): Promise<GateFailures[] | PreviousFailuresResult> {
	try {
		const files = await fs.readdir(logDir);
		const gateFailures: GateFailures[] = [];
		// Map: jobId -> reviewIndex -> { adapter, passIteration }
		const passedSlots = new Map<string, Map<number, PassedSlot>>();

		// Separate review files (with @index) from check files
		// Group review files by (jobId, reviewIndex) -> highest run number
		const reviewSlotMap = new Map<
			string,
			{ filename: string; runNumber: number; ext: string }
		>();
		const checkPrefixMap = new Map<string, Map<number, Set<string>>>();

		for (const file of files) {
			const isLog = file.endsWith(".log");
			const isJson = file.endsWith(".json");
			if (!isLog && !isJson) continue;
			if (gateFilter && !file.includes(gateFilter)) continue;

			const parsed = parseReviewFilename(file);
			if (parsed) {
				// Review file with @index pattern
				const slotKey = `${parsed.jobId}:${parsed.reviewIndex}`;
				const existing = reviewSlotMap.get(slotKey);
				// Update if: no existing entry, higher run number, or same run number but .json (prefer .json over .log)
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
			} else {
				// Check file or legacy review file
				const m = file.match(/^(.+)\.(\d+)\.(log|json)$/);
				if (!m || !m[1] || !m[2] || !m[3]) continue;

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
		}

		// Process review files grouped by slot (jobId + reviewIndex)
		// Group by jobId to produce a single GateFailures per job
		const jobReviewFailures = new Map<string, AdapterFailure[]>();

		for (const [slotKey, fileInfo] of reviewSlotMap.entries()) {
			const sepIdx = slotKey.lastIndexOf(":");
			const jobId = slotKey.substring(0, sepIdx);
			const reviewIndex = parseInt(slotKey.substring(sepIdx + 1), 10);

			// Extract adapter from filename
			const parsed = parseReviewFilename(fileInfo.filename);
			const adapter = parsed?.adapter || "unknown";

			// Check if this slot passed
			const filePath = path.join(logDir, fileInfo.filename);
			let isPassing = false;
			if (fileInfo.ext === "json") {
				isPassing = await isJsonReviewPassing(filePath);
			} else {
				isPassing = await isLogReviewPassing(filePath);
			}

			if (isPassing && includePassedSlots) {
				// Record this as a passed slot with adapter info
				let jobSlots = passedSlots.get(jobId);
				if (!jobSlots) {
					jobSlots = new Map();
					passedSlots.set(jobId, jobSlots);
				}
				jobSlots.set(reviewIndex, {
					reviewIndex,
					passIteration: fileInfo.runNumber,
					adapter,
				});
				continue; // Don't process as failure
			}

			let failure: GateFailures | null = null;
			if (fileInfo.ext === "json") {
				failure = await parseJsonReviewFile(filePath);
			} else {
				failure = await parseLogFile(filePath);
			}

			if (failure) {
				// Apply status filtering
				for (const af of failure.adapterFailures) {
					af.reviewIndex = reviewIndex;
					const filteredViolations: PreviousViolation[] = [];
					for (const v of af.violations) {
						const status = v.status || "new";
						if (status === "skipped") continue;
						if (
							status !== "new" &&
							status !== "fixed" &&
							status !== "skipped"
						) {
							log.warn(
								`Unexpected status "${status}" for violation in ${jobId}. Treating as "new".`,
							);
							v.status = "new";
						}
						filteredViolations.push(v);
					}
					af.violations = filteredViolations;

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
		}

		for (const [jobId, adapterFailures] of jobReviewFailures.entries()) {
			gateFailures.push({
				jobId,
				gateName: "",
				entryPoint: "",
				adapterFailures,
				logPath: path.join(logDir, `${jobId}.log`),
			});
		}

		// Process check files (non-review)
		for (const [prefix, runMap] of checkPrefixMap.entries()) {
			const latestRun = Math.max(...runMap.keys());
			const exts = runMap.get(latestRun);
			if (!exts) continue;

			let failure: GateFailures | null = null;
			if (exts.has("json")) {
				failure = await parseJsonReviewFile(
					path.join(logDir, `${prefix}.${latestRun}.json`),
				);
			} else if (exts.has("log")) {
				failure = await parseLogFile(
					path.join(logDir, `${prefix}.${latestRun}.log`),
				);
			}

			if (failure) {
				for (const af of failure.adapterFailures) {
					const filteredViolations: PreviousViolation[] = [];
					for (const v of af.violations) {
						const status = v.status || "new";
						if (status === "skipped") continue;
						if (
							status !== "new" &&
							status !== "fixed" &&
							status !== "skipped"
						) {
							log.warn(
								`Unexpected status "${status}" for violation in ${failure.jobId}. Treating as "new".`,
							);
							v.status = "new";
						}
						filteredViolations.push(v);
					}
					af.violations = filteredViolations;
				}

				const totalViolations = failure.adapterFailures.reduce(
					(sum, af) => sum + af.violations.length,
					0,
				);
				if (totalViolations > 0) {
					gateFailures.push(failure);
				}
			}
		}

		if (includePassedSlots) {
			return { failures: gateFailures, passedSlots };
		}
		return gateFailures;
	} catch (error: unknown) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code: string }).code === "ENOENT"
		) {
			return includePassedSlots ? { failures: [], passedSlots: new Map() } : [];
		}
		return includePassedSlots ? { failures: [], passedSlots: new Map() } : [];
	}
}

/**
 * Check if any review JSON files in the log directory contain violations
 * with status "skipped". Used to determine the correct terminal status
 * when a rerun has no code changes but all failures have been addressed.
 */
export async function hasSkippedViolationsInLogs(opts: {
	logDir: string;
}): Promise<boolean> {
	const { logDir } = opts;
	try {
		const files = await fs.readdir(logDir);
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			try {
				const content = await fs.readFile(path.join(logDir, file), "utf-8");
				const data = JSON.parse(content) as {
					violations?: { status?: string }[];
				};
				if (data.violations?.some((v) => v.status === "skipped")) {
					return true;
				}
			} catch {
				// Skip unparseable files and continue to next
			}
		}
		return false;
	} catch {
		return false;
	}
}

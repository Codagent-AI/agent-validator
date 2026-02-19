import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getAdapter, isUsageLimit } from "../cli-adapters/index.js";
import type { AdapterConfig, LoadedReviewGateConfig } from "../config/types.js";
import { getCategoryLogger } from "../output/app-logger.js";
import {
	type DiffFileRange,
	isValidViolationLocation,
	parseDiff,
} from "../utils/diff-parser.js";
import {
	getUnhealthyAdapters,
	isAdapterCoolingDown,
	markAdapterHealthy,
	markAdapterUnhealthy,
} from "../utils/execution-state.js";
import type {
	GateResult,
	PreviousViolation,
	ReviewFullJsonOutput,
} from "./result.js";

const log = getCategoryLogger("gate", "review");

const execAsync = promisify(exec);

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BUFFER_SIZE = 10000;
const REVIEW_ADAPTER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Chars-per-token approximation for rough token estimates. */
const CHARS_PER_TOKEN = 4;

export const JSON_SYSTEM_INSTRUCTION = `
You are in a read-only mode. You may read files in the repository to gather context.
Do NOT attempt to modify files or run shell commands that change system state.
Do NOT access files outside the repository root.
Do NOT access the .git/ directory or read git history/commit information.
Use your available file-reading and search tools to find information.
If the diff is insufficient or ambiguous, use your tools to read the full file content or related files.

CRITICAL SCOPE RESTRICTIONS:
- ONLY review the code changes shown in the diff below
- DO NOT review commit history or existing code outside the diff
- All violations MUST reference file paths and line numbers that appear IN THE DIFF
- The "file" field must match a file from the diff
- The "line" field must be within a changed region (lines starting with + in the diff)

IMPORTANT: You must output ONLY a valid JSON object. Do not output any markdown text, explanations, or code blocks outside of the JSON.
Each violation MUST include a "priority" field with one of: "critical", "high", "medium", "low".
Each violation MUST include a "status" field set to "new".

If violations are found:
{
  "status": "fail",
  "violations": [
    {
      "file": "path/to/file.rb",
      "line": 10,
      "issue": "Description of the violation",
      "fix": "Suggestion on how to fix it",
      "priority": "high",
      "status": "new"
    }
  ]
}

If NO violations are found:
{
  "status": "pass",
  "message": "No problems found"
}
`;

type ReviewConfig = LoadedReviewGateConfig;

interface ReviewJsonOutput {
	status: "pass" | "fail";
	message?: string;
	violations?: Array<{
		file: string;
		line: number | string;
		issue: string;
		fix?: string;
		priority: "critical" | "high" | "medium" | "low";
		status: "new" | "fixed" | "skipped";
		result?: string | null;
	}>;
}

export class ReviewGateExecutor {
	private constructPrompt(
		config: ReviewConfig,
		previousViolations: PreviousViolation[] = [],
	): string {
		const baseContent = config.promptContent || "";

		if (previousViolations.length > 0) {
			return (
				baseContent +
				"\n\n" +
				this.buildPreviousFailuresSection(previousViolations) +
				"\n" +
				JSON_SYSTEM_INSTRUCTION
			);
		}

		return `${baseContent}\n${JSON_SYSTEM_INSTRUCTION}`;
	}

	async execute(
		jobId: string,
		config: ReviewConfig,
		entryPointPath: string,
		loggerFactory: (
			adapterName?: string,
			reviewIndex?: number,
		) => Promise<{
			logger: (output: string) => Promise<void>;
			logPath: string;
		}>,
		baseBranch: string,
		previousFailures?: Map<string, PreviousViolation[]>,
		changeOptions?: {
			commit?: string;
			uncommitted?: boolean;
			fixBase?: string;
		},
		rerunThreshold: "critical" | "high" | "medium" | "low" = "high",
		passedSlots?: Map<number, { adapter: string; passIteration: number }>,
		logDir?: string,
		adapterConfigs?: Record<string, AdapterConfig>,
	): Promise<GateResult> {
		const startTime = Date.now();
		const logBuffer: string[] = [];
		let logSequence = 0;
		const activeLoggers: Array<
			(output: string, index: number) => Promise<void>
		> = [];
		const logPaths: string[] = [];
		const logPathsSet = new Set<string>();

		const mainLogger = async (output: string) => {
			const seq = logSequence++;
			if (logBuffer.length < MAX_LOG_BUFFER_SIZE) {
				logBuffer.push(output);
			}
			await Promise.allSettled(activeLoggers.map((l) => l(output, seq)));
		};

		const getAdapterLogger = async (
			adapterName: string,
			reviewIndex: number,
		) => {
			const { logger, logPath } = await loggerFactory(adapterName, reviewIndex);
			if (!logPathsSet.has(logPath)) {
				logPathsSet.add(logPath);
				logPaths.push(logPath);
			}

			const seenIndices = new Set<number>();

			const safeLogger = async (msg: string, index: number) => {
				if (seenIndices.has(index)) return;
				seenIndices.add(index);
				await logger(msg);
			};

			activeLoggers.push(safeLogger);

			const snapshot = [...logBuffer];
			await Promise.all(snapshot.map((msg, i) => safeLogger(msg, i)));

			return logger;
		};

		try {
			log.debug(`Starting review: ${config.name} | entry=${entryPointPath}`);
			await mainLogger(`Starting review: ${config.name}\n`);
			await mainLogger(`Entry point: ${entryPointPath}\n`);
			await mainLogger(`Base branch: ${baseBranch}\n`);

			const diff = await this.getDiff(
				entryPointPath,
				baseBranch,
				changeOptions,
			);

			// Compute and log diff size stats
			const diffLines = diff.split("\n").length;
			const diffChars = diff.length;
			const diffEstTokens = Math.ceil(diffChars / CHARS_PER_TOKEN);
			const diffFileRanges = parseDiff(diff);
			const diffFiles = diffFileRanges.size;
			const diffSizeMsg = `[diff-stats] files=${diffFiles} lines=${diffLines} chars=${diffChars} est_tokens=${diffEstTokens}`;
			log.debug(diffSizeMsg);
			await mainLogger(`${diffSizeMsg}\n`);

			if (!diff.trim()) {
				log.debug(`Empty diff after trim, returning pass`);
				await mainLogger("No changes found in entry point, skipping review.\n");
				await mainLogger("Result: pass - No changes to review\n");
				return {
					jobId,
					status: "pass",
					duration: Date.now() - startTime,
					message: "No changes to review",
					logPaths,
				};
			}

			const required = config.num_reviews ?? 1;
			const outputs: Array<{
				adapter: string;
				reviewIndex: number;
				duration?: number;
				status: "pass" | "fail" | "error";
				message: string;
				json?: ReviewJsonOutput;
				skipped?: Array<{
					file: string;
					line: number | string;
					issue: string;
					result?: string | null;
				}>;
			}> = [];

			const preferences = config.cli_preference || [];
			const parallel = config.parallel ?? false;
			log.debug(
				`Checking adapters: ${preferences.join(", ") || "(none configured)"}`,
			);

			// Determine healthy adapters using cooldown-based filtering
			const healthyAdapters: string[] = [];
			const unhealthyMap = logDir ? await getUnhealthyAdapters(logDir) : {};

			for (const toolName of preferences) {
				const adapter = getAdapter(toolName);
				if (!adapter) {
					log.debug(`Adapter ${toolName}: not found`);
					continue;
				}

				// Check cooldown status
				const unhealthyEntry = unhealthyMap[toolName];
				if (unhealthyEntry) {
					if (isAdapterCoolingDown(unhealthyEntry)) {
						log.debug(`Adapter ${toolName}: cooling down`);
						await mainLogger(
							`Skipping ${toolName}: cooling down (${unhealthyEntry.reason})\n`,
						);
						continue;
					}

					// Cooldown expired - probe binary availability
					const health = await adapter.checkHealth();
					if (health.status === "healthy") {
						log.debug(
							`Adapter ${toolName}: cooldown expired, binary available, clearing unhealthy flag`,
						);
						if (logDir) {
							await markAdapterHealthy(logDir, toolName);
						}
					} else {
						log.debug(
							`Adapter ${toolName}: cooldown expired but binary missing`,
						);
						await mainLogger(
							`Skipping ${toolName}: ${health.message || "Missing"}\n`,
						);
						continue;
					}
				} else {
					// Not in unhealthy list - check binary availability
					const health = await adapter.checkHealth();
					if (health.status !== "healthy") {
						log.debug(
							`Adapter ${toolName}: ${health.status}${health.message ? ` - ${health.message}` : ""}`,
						);
						await mainLogger(
							`Skipping ${toolName}: ${health.message || "Unhealthy"}\n`,
						);
						continue;
					}
				}

				healthyAdapters.push(toolName);
			}

			if (healthyAdapters.length === 0) {
				const msg = "Review dispatch failed: no healthy adapters available";
				log.error(`ERROR: ${msg}`);
				await mainLogger(`Result: error - ${msg}\n`);
				return {
					jobId,
					status: "error",
					duration: Date.now() - startTime,
					message: msg,
					logPaths,
				};
			}
			log.debug(`Healthy adapters: ${healthyAdapters.join(", ")}`);

			// Round-robin assignment over healthy adapters
			const assignments: Array<{
				adapter: string;
				reviewIndex: number;
				skip?: boolean;
				skipReason?: string;
				passIteration?: number;
			}> = [];
			for (let i = 0; i < required; i++) {
				const adapter = healthyAdapters[i % healthyAdapters.length];
				if (!adapter) continue;
				assignments.push({
					adapter,
					reviewIndex: i + 1,
				});
			}

			// Skip logic for passed slots (only when num_reviews > 1 and in rerun mode)
			if (required > 1 && passedSlots && passedSlots.size > 0) {
				// Identify which slots passed (with same adapter) and which failed
				const passedIndexes: number[] = [];
				const failedIndexes: number[] = [];

				for (const assignment of assignments) {
					const passed = passedSlots.get(assignment.reviewIndex);
					// Only consider as passed if same adapter is assigned
					if (passed && passed.adapter === assignment.adapter) {
						passedIndexes.push(assignment.reviewIndex);
						assignment.passIteration = passed.passIteration;
					} else {
						failedIndexes.push(assignment.reviewIndex);
					}
				}

				if (failedIndexes.length > 0) {
					// Some slots failed: run failed slots, skip passed slots
					for (const assignment of assignments) {
						if (assignment.passIteration !== undefined) {
							assignment.skip = true;
							assignment.skipReason = `previously passed in iteration ${assignment.passIteration} (num_reviews > 1)`;
						}
					}
				} else if (passedIndexes.length === assignments.length) {
					// All slots passed: safety latch - run slot 1, skip rest
					for (const assignment of assignments) {
						if (assignment.reviewIndex === 1) {
							assignment.skip = false;
							// Log safety latch message
							await mainLogger(
								`Running @1: safety latch (all slots previously passed)\n`,
							);
						} else {
							assignment.skip = true;
							assignment.skipReason = `previously passed in iteration ${assignment.passIteration} (num_reviews > 1)`;
						}
					}
				}
			}

			// Log skip messages
			for (const assignment of assignments) {
				if (assignment.skip && assignment.skipReason) {
					await mainLogger(
						`Skipping @${assignment.reviewIndex}: ${assignment.skipReason}\n`,
					);
				}
			}

			const dispatchMsg = `Dispatching ${required} review(s) via round-robin: ${assignments.map((a) => `${a.adapter}@${a.reviewIndex}`).join(", ")}`;
			log.debug(dispatchMsg);
			await mainLogger(`${dispatchMsg}\n`);

			// Separate assignments into running and skipped
			const runningAssignments = assignments.filter((a) => !a.skip);
			const skippedAssignments = assignments.filter((a) => a.skip);
			log.debug(
				`Running: ${runningAssignments.length}, Skipped: ${skippedAssignments.length}`,
			);

			// Track skipped slots for output
			const skippedSlotOutputs: Array<{
				adapter: string;
				reviewIndex: number;
				status: "skipped_prior_pass";
				message: string;
				passIteration: number;
			}> = [];

			// Handle skipped slots: write JSON log with status "skipped_prior_pass"
			for (const assignment of skippedAssignments) {
				const { logger, logPath } = await loggerFactory(
					assignment.adapter,
					assignment.reviewIndex,
				);

				// Write to log file explaining the skip
				const skipMessage = `[${new Date().toISOString()}] Review skipped: previously passed in iteration ${assignment.passIteration}\n`;
				await logger(skipMessage);
				await logger(`Adapter: ${assignment.adapter}\n`);
				await logger(`Review index: @${assignment.reviewIndex}\n`);
				await logger(`Status: skipped_prior_pass\n`);

				const jsonPath = logPath.replace(/\.log$/, ".json");
				const skippedOutput: ReviewFullJsonOutput = {
					adapter: assignment.adapter,
					timestamp: new Date().toISOString(),
					status: "skipped_prior_pass",
					rawOutput: "",
					violations: [],
					passIteration: assignment.passIteration,
				};
				await fs.writeFile(jsonPath, JSON.stringify(skippedOutput, null, 2));

				if (!logPathsSet.has(logPath)) {
					logPathsSet.add(logPath);
					logPaths.push(logPath);
				}

				skippedSlotOutputs.push({
					adapter: assignment.adapter,
					reviewIndex: assignment.reviewIndex,
					status: "skipped_prior_pass",
					message: `Skipped: previously passed in iteration ${assignment.passIteration}`,
					passIteration: assignment.passIteration ?? 0,
				});
			}

			if (parallel && runningAssignments.length > 1) {
				// Parallel execution
				const results = await Promise.all(
					runningAssignments.map((assignment) =>
						this.runSingleReview(
							assignment.adapter,
							assignment.reviewIndex,
							config,
							diff,
							getAdapterLogger,
							mainLogger,
							loggerFactory,
							previousFailures,
							rerunThreshold,
							logDir,
							adapterConfigs,
						),
					),
				);

				for (const res of results) {
					if (res) {
						outputs.push({
							adapter: res.adapter,
							reviewIndex: res.reviewIndex,
							duration: res.duration,
							...res.evaluation,
						});
					}
				}
			} else {
				// Sequential execution
				for (const assignment of runningAssignments) {
					const res = await this.runSingleReview(
						assignment.adapter,
						assignment.reviewIndex,
						config,
						diff,
						getAdapterLogger,
						mainLogger,
						loggerFactory,
						previousFailures,
						rerunThreshold,
						logDir,
						adapterConfigs,
					);
					if (res) {
						outputs.push({
							adapter: res.adapter,
							reviewIndex: res.reviewIndex,
							duration: res.duration,
							...res.evaluation,
						});
					}
				}
			}

			// Check if all running reviews completed (skipped ones don't count)
			if (outputs.length < runningAssignments.length) {
				const msg = `Failed to complete reviews. Expected: ${runningAssignments.length}, Completed: ${outputs.length}. See logs for details.`;
				await mainLogger(`Result: error - ${msg}\n`);
				return {
					jobId,
					status: "error",
					duration: Date.now() - startTime,
					message: msg,
					logPaths,
				};
			}

			const failed = outputs.filter((result) => result.status === "fail");
			const errored = outputs.filter((result) => result.status === "error");
			const allSkipped = outputs.flatMap((result) => result.skipped || []);

			let status: "pass" | "fail" | "error" = "pass";
			let message = "Passed";

			if (errored.length > 0) {
				status = "error";
				message = `Error in ${errored.length} adapter(s)`;
			} else if (failed.length > 0) {
				status = "fail";
				message = `Failed by ${failed.length} adapter(s)`;
			}

			// Add skipped slot count to message if any
			if (skippedSlotOutputs.length > 0) {
				message += ` (${skippedSlotOutputs.length} skipped due to prior pass)`;
			}

			const subResults = outputs.map((out) => {
				const specificLog = logPaths.find((p) => {
					const filename = path.basename(p);
					return (
						filename.includes(`_${out.adapter}@${out.reviewIndex}.`) &&
						filename.endsWith(".log")
					);
				});

				let logPath = specificLog;
				if (specificLog && out.json && out.status === "fail") {
					logPath = specificLog.replace(/\.log$/, ".json");
				}

				const errorCount =
					out.json && Array.isArray(out.json.violations)
						? out.json.violations.filter((v) => !v.status || v.status === "new")
								.length
						: out.status === "fail" || out.status === "error"
							? 1
							: 0;

				const fixedCount =
					out.json && Array.isArray(out.json.violations)
						? out.json.violations.filter((v) => v.status === "fixed").length
						: 0;

				return {
					nameSuffix: `(${out.adapter}@${out.reviewIndex})`,
					status: out.status,
					duration: out.duration,
					message: out.message,
					logPath,
					errorCount,
					fixedCount,
					skipped: out.skipped,
				};
			});

			// Add skipped slot subResults (they don't affect gate status)
			for (const skipped of skippedSlotOutputs) {
				const specificLog = logPaths.find((p) => {
					const filename = path.basename(p);
					return (
						filename.includes(`_${skipped.adapter}@${skipped.reviewIndex}.`) &&
						filename.endsWith(".log")
					);
				});

				subResults.push({
					nameSuffix: `(${skipped.adapter}@${skipped.reviewIndex})`,
					status: "pass" as const, // Show as pass since it previously passed
					duration: undefined,
					message: skipped.message,
					logPath: specificLog?.replace(/\.log$/, ".json"),
					errorCount: 0,
					fixedCount: 0,
					skipped: undefined,
				});
			}

			// Sort subResults by review index for consistent ordering
			subResults.sort((a, b) => {
				const aIndex = parseInt(a.nameSuffix.match(/@(\d+)/)?.[1] || "0", 10);
				const bIndex = parseInt(b.nameSuffix.match(/@(\d+)/)?.[1] || "0", 10);
				return aIndex - bIndex;
			});

			log.debug(`Complete: ${status} - ${message}`);
			await mainLogger(`Result: ${status} - ${message}\n`);

			return {
				jobId,
				status,
				duration: Date.now() - startTime,
				message,
				logPaths,
				subResults,
				skipped: allSkipped,
			};
		} catch (error: unknown) {
			const err = error as { message?: string; stack?: string };
			const errMsg = err.message || "Unknown error";
			const errStack = err.stack || "";
			// nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
			log.error(`CRITICAL ERROR: ${errMsg} ${errStack}`);
			await mainLogger(`Critical Error: ${errMsg}\n`);
			await mainLogger("Result: error\n");
			return {
				jobId,
				status: "error",
				duration: Date.now() - startTime,
				message: errMsg,
				logPaths,
			};
		}
	}

	private async runSingleReview(
		toolName: string,
		reviewIndex: number,
		config: ReviewConfig,
		diff: string,
		getAdapterLogger: (
			adapterName: string,
			reviewIndex: number,
		) => Promise<(output: string) => Promise<void>>,
		mainLogger: (output: string) => Promise<void>,
		loggerFactory: (
			adapterName?: string,
			reviewIndex?: number,
		) => Promise<{
			logger: (output: string) => Promise<void>;
			logPath: string;
		}>,
		previousFailures?: Map<string, PreviousViolation[]>,
		rerunThreshold: "critical" | "high" | "medium" | "low" = "high",
		logDir?: string,
		adapterConfigs?: Record<string, AdapterConfig>,
	): Promise<{
		adapter: string;
		reviewIndex: number;
		duration: number;
		evaluation: {
			status: "pass" | "fail" | "error";
			message: string;
			json?: ReviewJsonOutput;
			skipped?: Array<{
				file: string;
				line: number | string;
				issue: string;
				result?: string | null;
			}>;
		};
	} | null> {
		const reviewStartTime = Date.now();
		const adapter = getAdapter(toolName);
		if (!adapter) return null;

		if (!adapter.name || typeof adapter.name !== "string") {
			await mainLogger(
				`Error: Invalid adapter name: ${JSON.stringify(adapter.name)}\n`,
			);
			return null;
		}
		const adapterLogger = await getAdapterLogger(adapter.name, reviewIndex);
		const { logPath } = await loggerFactory(adapter.name, reviewIndex);

		try {
			const startMsg = `[START] review:.:${config.name} (${adapter.name}@${reviewIndex})`;
			await adapterLogger(`${startMsg}\n`);

			// Look up previous violations by review index key, falling back to adapter name for legacy logs
			const indexKey = String(reviewIndex);
			const adapterPreviousViolations =
				previousFailures?.get(indexKey) ??
				previousFailures?.get(adapter.name) ??
				[];
			const finalPrompt = this.constructPrompt(
				config,
				adapterPreviousViolations,
			);

			// Log prompt + diff size so we can compare against actual token usage from telemetry
			const promptChars = finalPrompt.length;
			const diffChars = diff.length;
			const totalInputChars = promptChars + diffChars;
			const promptEstTokens = Math.ceil(promptChars / CHARS_PER_TOKEN);
			const diffEstTokens = Math.ceil(diffChars / CHARS_PER_TOKEN);
			const totalEstTokens = promptEstTokens + diffEstTokens;
			const inputSizeMsg = `[input-stats] prompt_chars=${promptChars} diff_chars=${diffChars} total_chars=${totalInputChars} prompt_est_tokens=${promptEstTokens} diff_est_tokens=${diffEstTokens} total_est_tokens=${totalEstTokens}`;
			await adapterLogger(`${inputSizeMsg}\n`);
			await adapterLogger(`[diff]\n${diff}\n`);

			const adapterCfg = adapterConfigs?.[toolName];
			const output = await adapter.execute({
				prompt: finalPrompt,
				diff,
				model: adapterCfg?.model ?? config.model,
				timeoutMs: config.timeout
					? config.timeout * 1000
					: REVIEW_ADAPTER_TIMEOUT_MS,
				onOutput: (chunk: string) => {
					// Stream output to log file in real-time
					adapterLogger(chunk);
				},
				allowToolUse: adapterCfg?.allow_tool_use,
				thinkingBudget: adapterCfg?.thinking_budget,
			});

			await adapterLogger(
				`\n--- Review Output (${adapter.name}) ---\n${output}\n`,
			);

			const evaluation = this.evaluateOutput(output, diff);

			// Check for usage limit only when output failed to parse as valid JSON.
			// This avoids false positives when a review legitimately mentions "usage limit".
			if (evaluation.status === "error" && isUsageLimit(output)) {
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
				return {
					adapter: adapter.name,
					reviewIndex,
					duration: Date.now() - reviewStartTime,
					evaluation: {
						status: "error",
						message: reason,
					},
				};
			}

			// Rerun Filtering: If we have previous failures, filter new violations by threshold
			if (
				adapterPreviousViolations.length > 0 &&
				evaluation.json?.violations &&
				evaluation.status === "fail"
			) {
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

			let skipped: Array<{
				file: string;
				line: number | string;
				issue: string;
				result?: string | null;
			}> = [];

			if (evaluation.json) {
				if (evaluation.json.status === "fail") {
					if (Array.isArray(evaluation.json.violations)) {
						for (const v of evaluation.json.violations) {
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
					} else {
						await adapterLogger(
							"Warning: Missing 'violations' array in failure response\n",
						);
					}
				}

				const jsonPath = await this.writeJsonResult(
					logPath,
					adapter.name,
					evaluation.status,
					output,
					evaluation.json,
				);

				skipped = (evaluation.json.violations || [])
					.filter((v) => v.status === "skipped")
					.map((v) => ({
						file: v.file,
						line: v.line,
						issue: v.issue,
						result: v.result,
					}));

				await adapterLogger(`\n--- Parsed Result (${adapter.name}) ---\n`);
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
					if (evaluation.json.message)
						await adapterLogger(`Message: ${evaluation.json.message}\n`);
				} else {
					await adapterLogger(`Status: ${evaluation.json.status}\n`);
					await adapterLogger(
						`Raw: ${JSON.stringify(evaluation.json, null, 2)}\n`,
					);
				}
				await adapterLogger(`---------------------\n`);
			}

			const resultMsg = `Review result (${adapter.name}@${reviewIndex}): ${evaluation.status} - ${evaluation.message}`;
			await adapterLogger(`${resultMsg}\n`);

			return {
				adapter: adapter.name,
				reviewIndex,
				duration: Date.now() - reviewStartTime,
				evaluation: {
					status: evaluation.status,
					message: evaluation.message,
					json: evaluation.json,
					skipped,
				},
			};
		} catch (error: unknown) {
			const err = error as { message?: string };
			const errorMsg = `Error running ${adapter.name}@${reviewIndex}: ${err.message}`;
			log.error(errorMsg);
			await adapterLogger(`${errorMsg}\n`);
			await mainLogger(`${errorMsg}\n`);

			// Check if the error is a usage limit
			if (err.message && isUsageLimit(err.message)) {
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
				return {
					adapter: adapter.name,
					reviewIndex,
					duration: Date.now() - reviewStartTime,
					evaluation: {
						status: "error",
						message: reason,
					},
				};
			}

			return null;
		}
	}

	private async getDiff(
		entryPointPath: string,
		baseBranch: string,
		options?: { commit?: string; uncommitted?: boolean; fixBase?: string },
	): Promise<string> {
		// Debug: log which diff mode is active
		log.debug(
			`getDiff: entryPoint=${entryPointPath}, fixBase=${options?.fixBase ?? "none"}, uncommitted=${options?.uncommitted ?? false}, commit=${options?.commit ?? "none"}`,
		);

		// If fixBase is provided (rerun mode)
		if (options?.fixBase) {
			// Validate fixBase to prevent command injection
			if (!/^[a-f0-9]+$/.test(options.fixBase)) {
				throw new Error(`Invalid session ref: ${options.fixBase}`);
			}

			const pathArg = this.pathArg(entryPointPath);
			try {
				const diff = await this.execDiff(
					`git diff ${options.fixBase}${pathArg}`,
				);

				const { stdout: untrackedStdout } = await execAsync(
					`git ls-files --others --exclude-standard${pathArg}`,
					{ maxBuffer: MAX_BUFFER_BYTES },
				);
				const currentUntracked = new Set(this.parseLines(untrackedStdout));

				const { stdout: snapshotFilesStdout } = await execAsync(
					`git ls-tree -r --name-only ${options.fixBase}${pathArg}`,
					{ maxBuffer: MAX_BUFFER_BYTES },
				);
				const snapshotFiles = new Set(this.parseLines(snapshotFilesStdout));

				const newUntracked = [...currentUntracked].filter(
					(f) => !snapshotFiles.has(f),
				);
				const newUntrackedDiffs: string[] = [];

				for (const file of newUntracked) {
					try {
						const d = await this.execDiff(
							`git diff --no-index -- /dev/null ${this.quoteArg(file)}`,
						);
						if (d.trim()) newUntrackedDiffs.push(d);
					} catch (error: unknown) {
						const err = error as { message?: string; stderr?: string };
						const msg = [err.message, err.stderr].filter(Boolean).join("\n");
						if (
							!((msg.includes("Could not access") ||msg.includes("ENOENT") ) ||msg.includes("No such file"))
						) {
							throw error;
						}
					}
				}

				const scopedDiff = [diff, ...newUntrackedDiffs]
					.filter(Boolean)
					.join("\n");
				log.debug(
					`Scoped diff via fixBase: ${scopedDiff.split("\n").length} lines`,
				);
				return scopedDiff;
			} catch (error) {
				log.warn(
					`Failed to compute diff against fixBase ${options.fixBase}, falling back to full uncommitted diff. ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		if (options?.uncommitted) {
			log.debug(`Using full uncommitted diff (no fixBase)`);
			const pathArg = this.pathArg(entryPointPath);
			const staged = await this.execDiff(`git diff --cached${pathArg}`);
			const unstaged = await this.execDiff(`git diff${pathArg}`);
			const untracked = await this.untrackedDiff(entryPointPath);
			return [staged, unstaged, untracked].filter(Boolean).join("\n");
		}

		if (options?.commit) {
			const pathArg = this.pathArg(entryPointPath);
			try {
				return await this.execDiff(
					`git diff ${options.commit}^..${options.commit}${pathArg}`,
				);
			} catch (error: unknown) {
				const err = error as { message?: string; stderr?: string };
				if (
					err.message?.includes("unknown revision") ||
					err.stderr?.includes("unknown revision")
				) {
					return await this.execDiff(
						`git diff --root ${options.commit}${pathArg}`,
					);
				}
				throw error;
			}
		}

		const isCI =
			process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
		return isCI
			? this.getCIDiff(entryPointPath, baseBranch)
			: this.getLocalDiff(entryPointPath, baseBranch);
	}

	private async getCIDiff(
		entryPointPath: string,
		baseBranch: string,
	): Promise<string> {
		const baseRef = baseBranch;
		const headRef = process.env.GITHUB_SHA || "HEAD";
		const pathArg = this.pathArg(entryPointPath);

		try {
			return await this.execDiff(`git diff ${baseRef}...${headRef}${pathArg}`);
		} catch (_error) {
			const fallback = await this.execDiff(`git diff HEAD^...HEAD${pathArg}`);
			return fallback;
		}
	}

	private async getLocalDiff(
		entryPointPath: string,
		baseBranch: string,
	): Promise<string> {
		const pathArg = this.pathArg(entryPointPath);
		const committed = await this.execDiff(
			`git diff ${baseBranch}...HEAD${pathArg}`,
		);
		const uncommitted = await this.execDiff(`git diff HEAD${pathArg}`);
		const untracked = await this.untrackedDiff(entryPointPath);

		return [committed, uncommitted, untracked].filter(Boolean).join("\n");
	}

	private async untrackedDiff(entryPointPath: string): Promise<string> {
		const pathArg = this.pathArg(entryPointPath);
		const { stdout } = await execAsync(
			`git ls-files --others --exclude-standard${pathArg}`,
			{
				maxBuffer: MAX_BUFFER_BYTES,
			},
		);
		const files = this.parseLines(stdout);
		const diffs: string[] = [];

		for (const file of files) {
			try {
				const diff = await this.execDiff(
					`git diff --no-index -- /dev/null ${this.quoteArg(file)}`,
				);
				if (diff.trim()) diffs.push(diff);
			} catch (error: unknown) {
				const err = error as { message?: string; stderr?: string };
				const msg = [err.message, err.stderr].filter(Boolean).join("\n");
				if (
					msg.includes("Could not access") ||
					msg.includes("ENOENT") ||
					msg.includes("No such file")
				) {
					continue;
				}
				throw error;
			}
		}

		return diffs.join("\n");
	}

	private async execDiff(command: string): Promise<string> {
		try {
			const { stdout } = await execAsync(command, {
				maxBuffer: MAX_BUFFER_BYTES,
			});
			return stdout;
		} catch (error: unknown) {
			const err = error as { code?: number; stdout?: string };
			if (typeof err.code === "number" && err.stdout) {
				return err.stdout;
			}
			throw error;
		}
	}

	private buildPreviousFailuresSection(
		violations: PreviousViolation[],
	): string {
		const toVerify = violations.filter((v) => v.status === "fixed");
		const unaddressed = violations.filter(
			(v) => v.status === "new" || !v.status,
		);

		const affectedFiles = [...new Set(violations.map((v) => v.file))];

		const lines: string[] = [];

		lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RERUN MODE: VERIFY PREVIOUS FIXES ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is a RERUN review. The agent attempted to fix some of the violations listed below.
Your task is STRICTLY LIMITED to verifying the fixes for violations marked as FIXED.

PREVIOUS VIOLATIONS TO VERIFY:
`);

		if (toVerify.length === 0) {
			lines.push("(No violations were marked as FIXED for verification)\n");
		} else {
			toVerify.forEach((v, i) => {
				lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
				if (v.fix) {
					lines.push(`   Suggested fix: ${v.fix}`);
				}
				if (v.result) {
					lines.push(`   Agent result: ${v.result}`);
				}
				lines.push("");
			});
		}

		if (unaddressed.length > 0) {
			lines.push(`UNADDRESSED VIOLATIONS (STILL FAILING):
The following violations were NOT marked as fixed or skipped and are still active failures:
`);
			unaddressed.forEach((v, i) => {
				lines.push(`${i + 1}. ${v.file}:${v.line} - ${v.issue}`);
			});
			lines.push("");
		}

		lines.push(`STRICT INSTRUCTIONS FOR RERUN MODE:

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

		return lines.join("\n");
	}

	public evaluateOutput(
		output: string,
		diff?: string,
	): {
		status: "pass" | "fail" | "error";
		message: string;
		json?: ReviewJsonOutput;
		filteredCount?: number;
	} {
		const diffRanges = diff ? parseDiff(diff) : undefined;

		try {
			const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
			if (jsonBlockMatch?.[1]) {
				try {
					const json = JSON.parse(jsonBlockMatch[1]);
					return this.validateAndReturn(json, diffRanges);
				} catch {
					// Fall through
				}
			}

			const end = output.lastIndexOf("}");
			if (end !== -1) {
				let start = output.lastIndexOf("{", end);
				while (start !== -1) {
					const candidate = output.substring(start, end + 1);
					try {
						const json = JSON.parse(candidate);
						if (json.status) {
							return this.validateAndReturn(json, diffRanges);
						}
					} catch {
						// Not valid JSON, keep searching
					}
					start = output.lastIndexOf("{", start - 1);
				}
			}

			const firstStart = output.indexOf("{");
			if (firstStart !== -1 && end !== -1 && end > firstStart) {
				try {
					const candidate = output.substring(firstStart, end + 1);
					const json = JSON.parse(candidate);
					return this.validateAndReturn(json, diffRanges);
				} catch {
					// Ignore
				}
			}

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

	private validateAndReturn(
		json: ReviewJsonOutput,
		diffRanges?: Map<string, DiffFileRange>,
	): {
		status: "pass" | "fail" | "error";
		message: string;
		json?: ReviewJsonOutput;
		filteredCount?: number;
	} {
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

		let filteredCount = 0;

		if (Array.isArray(json.violations) && diffRanges?.size) {
			const originalCount = json.violations.length;

			json.violations = json.violations.filter(
				(v: { file: string; line: number | string }) => {
					// Coerce string line numbers to numbers for validation
					const lineStr =
						typeof v.line === "string" ? v.line.trim() : undefined;
					const lineNum =
						typeof v.line === "number"
							? v.line
							: lineStr && /^\d+$/.test(lineStr)
								? Number(lineStr)
								: undefined;
					const isValid = isValidViolationLocation(v.file, lineNum, diffRanges);
					return isValid;
				},
			);

			filteredCount = originalCount - json.violations.length;

			if (json.violations.length === 0) {
				return {
					status: "pass",
					message: `Passed (${filteredCount} out-of-scope violations filtered)`,
					json: { status: "pass" },
					filteredCount,
				};
			}
		}

		const violationCount = Array.isArray(json.violations)
			? json.violations.length
			: "some";

		const msg = `Found ${violationCount} violations`;

		return { status: "fail", message: msg, json, filteredCount };
	}

	private async writeJsonResult(
		logPath: string,
		adapter: string,
		status: "pass" | "fail" | "error",
		rawOutput: string,
		json: ReviewJsonOutput,
	): Promise<string> {
		const jsonPath = logPath.replace(/\.log$/, ".json");
		const fullOutput: ReviewFullJsonOutput = {
			adapter,
			timestamp: new Date().toISOString(),
			status,
			rawOutput,
			violations: json.violations || [],
		};

		await fs.writeFile(jsonPath, JSON.stringify(fullOutput, null, 2));
		return jsonPath;
	}

	private parseLines(stdout: string): string[] {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private pathArg(entryPointPath: string): string {
		return ` -- ${this.quoteArg(entryPointPath)}`;
	}

	private quoteArg(value: string): string {
		return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
	}
}

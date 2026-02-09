import fs from "node:fs/promises";
import chalk from "chalk";
import type { Job } from "../core/job.js";
import type { GateResult } from "../gates/result.js";
import { reconstructHistory } from "../utils/log-parser.js";

export class ConsoleReporter {
	onJobStart(job: Job) {
		console.error(chalk.blue(`[START] ${job.id}`));
	}

	onJobComplete(job: Job, result: GateResult) {
		const duration = `${(result.duration / 1000).toFixed(2)}s`;

		const message = result.message ?? "";

		if (result.subResults && result.subResults.length > 0) {
			// Print split results

			for (const sub of result.subResults) {
				const statusColor =
					sub.status === "pass"
						? chalk.green
						: sub.status === "fail"
							? chalk.red
							: chalk.magenta;

				const label =
					sub.status === "pass"
						? "PASS"
						: sub.status === "fail"
							? "FAIL"
							: "ERROR";

				let logInfo = "";

				if (sub.status !== "pass" && sub.logPath) {
					// Prefer JSON if it exists for reviews

					const displayLog = sub.logPath;

					const logPrefix = displayLog.endsWith(".json") ? "Review:" : "Log:";

					logInfo = `\n      ${logPrefix} ${displayLog}`;
				}

				console.error(
					statusColor(
						`[${label}]  ${job.id} ${chalk.dim(sub.nameSuffix)} (${duration}) - ${sub.message}${logInfo}`,
					),
				);
			}
		} else {
			// Standard single result
			let logInfo = "";
			if (result.status !== "pass") {
				// Try to find a relevant log path
				const logPath = result.logPath || result.logPaths?.[0];
				if (logPath) {
					logInfo = `\n      Log: ${logPath}`;
				}
			}

			if (result.status === "pass") {
				console.error(chalk.green(`[PASS]  ${job.id} (${duration})`));
			} else if (result.status === "fail") {
				console.error(
					chalk.red(`[FAIL]  ${job.id} (${duration}) - ${message}${logInfo}`),
				);
			} else {
				console.error(
					chalk.magenta(
						`[ERROR] ${job.id} (${duration}) - ${message}${logInfo}`,
					),
				);
			}
		}
	}

	async printSummary(
		results: GateResult[],
		logDir?: string,
		statusOverride?: string,
	) {
		console.error(
			`\n${chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`,
		);
		console.error(chalk.bold("RESULTS SUMMARY"));
		console.error(chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));

		if (logDir) {
			try {
				const history = await reconstructHistory(logDir);
				for (const iter of history) {
					if (iter.fixed.length === 0 && iter.skipped.length === 0) continue;

					console.error(`\nIteration ${iter.iteration}:`);
					for (const f of iter.fixed) {
						const label = f.adapter ? `${f.jobId} (${f.adapter})` : f.jobId;
						console.error(chalk.green(`  ✓ Fixed: ${label} - ${f.details}`));
					}
					for (const s of iter.skipped) {
						const label = s.adapter ? `${s.jobId} (${s.adapter})` : s.jobId;
						console.error(
							chalk.yellow(
								`  ⊘ Skipped: ${label} - ${s.file}:${s.line} ${s.issue}`,
							),
						);
						if (s.result) {
							console.error(chalk.dim(`    Reason: ${s.result}`));
						}
					}
				}

				const totalFixed = history.reduce(
					(sum, iter) => sum + iter.fixed.length,
					0,
				);
				const totalSkipped = history.reduce(
					(sum, iter) => sum + iter.skipped.length,
					0,
				);

				let totalFailed = 0;
				for (const res of results) {
					if (res.subResults && res.subResults.length > 0) {
						for (const sub of res.subResults) {
							if (sub.status === "fail" || sub.status === "error") {
								totalFailed += sub.errorCount ?? 1;
							}
						}
					} else if (res.status === "fail" || res.status === "error") {
						totalFailed += res.errorCount ?? 1;
					}
				}

				console.error(
					`\n${chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`,
				);
				const iterationsText =
					history.length > 1 ? ` after ${history.length} iterations` : "";
				console.error(
					`Total: ${totalFixed} fixed, ${totalSkipped} skipped, ${totalFailed} failed${iterationsText}`,
				);
			} catch (err) {
				console.warn(
					chalk.yellow(`Warning: Failed to reconstruct history: ${err}`),
				);
			}
		}

		const failed = results.filter((r) => r.status === "fail");
		const errored = results.filter((r) => r.status === "error");
		const anySkipped = results.some((r) => r.skipped && r.skipped.length > 0);

		let overallStatus = "Passed";
		let statusColor = chalk.green;

		if (statusOverride) {
			overallStatus = statusOverride;
			statusColor = chalk.red;
		} else if (errored.length > 0) {
			overallStatus = "Error";
			statusColor = chalk.magenta;
		} else if (failed.length > 0) {
			overallStatus = "Failed";
			statusColor = chalk.red;
		} else if (anySkipped) {
			overallStatus = "Passed with warnings";
			statusColor = chalk.yellow;
		}

		console.error(statusColor(`Status: ${overallStatus}`));
		console.error(
			chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
		);
	}

	/** @internal Public for testing */
	async extractFailureDetails(result: GateResult): Promise<string[]> {
		const logPaths =
			result.logPaths || (result.logPath ? [result.logPath] : []);

		if (logPaths.length === 0) {
			return [result.message ?? "Unknown error"];
		}

		const allDetails: string[] = [];
		for (const logPath of logPaths) {
			try {
				const logContent = await fs.readFile(logPath, "utf-8");
				const details = this.parseLogContent(logContent, result.jobId);
				allDetails.push(...details);
			} catch (_error: unknown) {
				allDetails.push(`(Could not read log file: ${logPath})`);
			}
		}

		return allDetails.length > 0
			? allDetails
			: [result.message ?? "Unknown error"];
	}

	private parseLogContent(logContent: string, jobId: string): string[] {
		const _lines = logContent.split("\n");
		const details: string[] = [];

		// Check if this is a review log
		if (jobId.startsWith("review:")) {
			// Look for parsed violations section (formatted output)
			// Use regex to be flexible about adapter name in parentheses
			// Matches: "--- Parsed Result ---" or "--- Parsed Result (adapter) ---"
			const parsedResultRegex = /---\s*Parsed Result(?:\s+\(([^)]+)\))?\s*---/;
			const match = logContent.match(parsedResultRegex);

			if (match && match.index !== undefined) {
				const violationsStart = match.index;
				const violationsSection = logContent.substring(violationsStart);
				const sectionLines = violationsSection.split("\n");

				for (let i = 0; i < sectionLines.length; i++) {
					// biome-ignore lint/style/noNonNullAssertion: index within bounds
					const line = sectionLines[i]!;
					// Match numbered violation lines: "1. file:line - issue" (line can be a number or '?')
					const violationMatch = line.match(
						/^\d+\.\s+(.+?):(\d+|\?)\s+-\s+(.+)$/,
					);
					if (violationMatch) {
						const file = violationMatch[1];
						const lineNum = violationMatch[2];
						const issue = violationMatch[3];
						details.push(
							`  ${chalk.cyan(file)}:${chalk.yellow(lineNum)} - ${issue}`,
						);

						// Check next line for "Fix:" suggestion
						if (i + 1 < sectionLines.length) {
							// biome-ignore lint/style/noNonNullAssertion: bounds checked above
							const nextLine = sectionLines[i + 1]!.trim();
							if (nextLine.startsWith("Fix:")) {
								const fix = nextLine.substring(4).trim();
								details.push(`    ${chalk.dim("Fix:")} ${fix}`);
								i++; // Skip the fix line
							}
						}
					}
				}
			}

			// If no parsed violations, look for JSON violations (handles both minified and pretty-printed)
			if (details.length === 0) {
				// Find the first '{' and last '}' to extract JSON object
				const jsonStart = logContent.indexOf("{");
				const jsonEnd = logContent.lastIndexOf("}");
				if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
					try {
						const jsonStr = logContent.substring(jsonStart, jsonEnd + 1);
						const json = JSON.parse(jsonStr);
						if (
							json.status === "fail" &&
							json.violations &&
							Array.isArray(json.violations)
						) {
							json.violations.forEach(
								(v: {
									file?: string;
									line?: number | string;
									issue?: string;
									fix?: string;
								}) => {
									const file = v.file || "unknown";
									const line = v.line || "?";
									const issue = v.issue || "Unknown issue";
									details.push(
										`  ${chalk.cyan(file)}:${chalk.yellow(line)} - ${issue}`,
									);
									if (v.fix) {
										details.push(`    ${chalk.dim("Fix:")} ${v.fix}`);
									}
								},
							);
						}
					} catch {
						// JSON parse failed, fall through to other parsing
					}
				}
			}

			// If still no details, look for error messages
			if (details.length === 0) {
				// Try to find the actual error message (first non-empty line after "Error:")
				const errorIndex = logContent.indexOf("Error:");
				if (errorIndex !== -1) {
					const afterError = logContent.substring(errorIndex + 6).trim();
					// biome-ignore lint/style/noNonNullAssertion: split always has at least one element
					const firstErrorLine = afterError.split("\n")[0]!.trim();
					if (
						firstErrorLine &&
						!firstErrorLine.startsWith("Usage:") &&
						!firstErrorLine.startsWith("Commands:")
					) {
						details.push(`  ${firstErrorLine}`);
					}
				}

				// Also check for "Result: error" lines
				if (details.length === 0) {
					const resultMatch = logContent.match(
						/Result:\s*error(?:\s*-\s*(.+?))?(?:\n|$)/,
					);
					if (resultMatch?.[1]) {
						details.push(`  ${resultMatch[1]}`);
					}
				}
			}
		} else {
			// This is a check log
			// Look for STDERR section
			const stderrStart = logContent.indexOf("STDERR:");
			if (stderrStart !== -1) {
				const stderrSection = logContent.substring(stderrStart + 7).trim();
				const stderrLines = stderrSection.split("\n").filter((line) => {
					// Skip empty lines and command output markers
					return (
						line.trim() &&
						!line.includes("STDOUT:") &&
						!line.includes("Command failed:") &&
						!line.includes("Result:")
					);
				});
				if (stderrLines.length > 0) {
					details.push(
						...stderrLines.slice(0, 10).map((line) => `  ${line.trim()}`),
					);
				}
			}

			// If no STDERR, look for error messages
			if (details.length === 0) {
				const errorMatch = logContent.match(/Command failed:\s*(.+?)(?:\n|$)/);
				if (errorMatch) {
					details.push(`  ${errorMatch[1]}`);
				} else {
					// Look for any line with "Result: fail" or "Result: error"
					const resultMatch = logContent.match(
						/Result:\s*(fail|error)\s*-\s*(.+?)(?:\n|$)/,
					);
					if (resultMatch) {
						details.push(`  ${resultMatch[2]}`);
					}
				}
			}
		}

		// If we still have no details, use the message from the result
		if (details.length === 0) {
			details.push("  (See log file for details)");
		}

		return details;
	}
}

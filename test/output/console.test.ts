import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Job } from "../../src/core/job";
import type { GateResult } from "../../src/gates/result";
import { ConsoleReporter } from "../../src/output/console";
import fs from "node:fs/promises";
import path from "node:path";

describe("ConsoleReporter", () => {
	let originalConsoleError: typeof console.error;
	let errorOutput: string[];

	beforeEach(() => {
		originalConsoleError = console.error;
		errorOutput = [];
		console.error = (...args: unknown[]) => {
			errorOutput.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		console.error = originalConsoleError;
	});

	describe("onJobStart", () => {
		it("should write [START] prefix to stderr", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;

			reporter.onJobStart(job);

			const output = errorOutput.join("");
			expect(output).toContain("[START]");
			expect(output).toContain("check:test");
		});
	});

	describe("onJobComplete", () => {
		it("should log [PASS] for passing jobs", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;
			const result: GateResult = {
				jobId: "check:test",
				status: "pass",
				duration: 1234,
			};

			reporter.onJobComplete(job, result);

			const output = errorOutput.join("");
			expect(output).toContain("[PASS]");
			expect(output).toContain("check:test");
		});

		it("should log [FAIL] for failing jobs with log path", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;
			const result: GateResult = {
				jobId: "check:test",
				status: "fail",
				duration: 1234,
				message: "Tests failed",
				logPath: "validator_logs/check_test.log",
			};

			reporter.onJobComplete(job, result);

			const output = errorOutput.join("");
			expect(output).toContain("[FAIL]");
			expect(output).toContain("check:test");
			expect(output).toContain("Tests failed");
			expect(output).toContain("validator_logs/check_test.log");
		});

		it("should log [ERROR] for errored jobs", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "review:test", type: "review" } as Job;
			const result: GateResult = {
				jobId: "review:test",
				status: "error",
				duration: 5000,
				message: "Failed to complete",
				logPath: "validator_logs/review_test.log",
			};

			reporter.onJobComplete(job, result);

			const output = errorOutput.join("");
			expect(output).toContain("[ERROR]");
			expect(output).toContain("review:test");
			expect(output).toContain("Failed to complete");
			expect(output).toContain("validator_logs/review_test.log");
		});
	});

	describe("printSummary", () => {
		it("should write Passed summary to stderr", async () => {
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{ jobId: "check:test", status: "pass", duration: 100 },
			];

			await reporter.printSummary(results);

			const output = errorOutput.join("");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Passed");
		});

		it("should write Failed summary to stderr", async () => {
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{
					jobId: "check:test",
					status: "fail",
					duration: 100,
					message: "Failed",
				},
			];

			await reporter.printSummary(results);

			const output = errorOutput.join("");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Failed");
			expect(output).not.toContain("Mark decisions with:");
		});

		it("shows the update-review hint for outstanding review violations", async () => {
			const logDir = path.join(import.meta.dir, "../../.test-console-review-hint");
			await fs.mkdir(logDir, { recursive: true });
			try {
				await fs.writeFile(path.join(logDir, "review_src_quality_claude@1.1.json"), JSON.stringify({
					adapter: "claude", status: "fail", violations: [
						{ file: "src/foo.ts", line: 1, issue: "Issue", status: "new" },
					],
				}));
				await new ConsoleReporter().printSummary([
					{ jobId: "review:src:quality", status: "fail", duration: 100 },
				], logDir);
				expect(errorOutput.join("\n")).toContain('Mark decisions with: agent-validate update-review fix|skip <id> "<reason>"');
			} finally {
				await fs.rm(logDir, { recursive: true, force: true });
			}
		});

		it("keeps the failed summary visible when a review log cannot be parsed", async () => {
			const logDir = path.join(import.meta.dir, "../../.test-console-malformed-review");
			await fs.mkdir(logDir, { recursive: true });
			try {
				await fs.writeFile(path.join(logDir, "review_src_quality_claude@1.1.json"), "{invalid");
				await new ConsoleReporter().printSummary([
					{ jobId: "review:src:quality", status: "fail", duration: 100 },
				], logDir);
				expect(errorOutput.join("\n")).toContain("Status: Failed");
			} finally {
				await fs.rm(logDir, { recursive: true, force: true });
			}
		});

		it("should write Trusted summary to stderr when status is overridden", async () => {
			const reporter = new ConsoleReporter();

			await reporter.printSummary([], undefined, "Trusted");

			const output = errorOutput.join("");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Trusted");
		});

		it("names configured identity after status when override is attached", async () => {
			const previous = process.env.AGENT_VALIDATOR_REVIEWER_CLI;
			process.env.AGENT_VALIDATOR_REVIEWER_CLI = "claude";
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{ jobId: "check:test", status: "pass", duration: 100 },
			];

			try {
				await reporter.printSummary(results, undefined, undefined, {
					source: "runner-reviewer-role",
					adapter: "github-copilot",
				});
			} finally {
				if (previous === undefined) {
					delete process.env.AGENT_VALIDATOR_REVIEWER_CLI;
				} else {
					process.env.AGENT_VALIDATOR_REVIEWER_CLI = previous;
				}
			}

			const output = errorOutput.join("\n");
			expect(output).toContain("Status: Passed");
			expect(output).toContain(
				"Reviewer: github-copilot (runner-reviewer-role)",
			);
			const statusIndex = output.indexOf("Status: Passed");
			const reviewerIndex = output.indexOf(
				"Reviewer: github-copilot (runner-reviewer-role)",
			);
			expect(reviewerIndex).toBeGreaterThan(statusIndex);
		});

		it("names xhigh collapse on the configured identity line", async () => {
			const reporter = new ConsoleReporter();

			await reporter.printSummary([], undefined, undefined, {
				source: "runner-reviewer-role",
				adapter: "claude",
				effortCollapsed: "xhigh",
			});

			const output = errorOutput.join("\n");
			expect(output).toContain(
				"Reviewer: claude (runner-reviewer-role; effort xhigh→high)",
			);
		});

		it("does not add a reviewer identity source line when no override is attached", async () => {
			const previous = process.env.AGENT_VALIDATOR_REVIEWER_CLI;
			process.env.AGENT_VALIDATOR_REVIEWER_CLI = "copilot";
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{ jobId: "check:test", status: "pass", duration: 100 },
			];

			try {
				await reporter.printSummary(results);
			} finally {
				if (previous === undefined) {
					delete process.env.AGENT_VALIDATOR_REVIEWER_CLI;
				} else {
					process.env.AGENT_VALIDATOR_REVIEWER_CLI = previous;
				}
			}

			const output = errorOutput.join("");
			expect(output).toContain("Status: Passed");
			expect(output).not.toContain("Reviewer:");
			expect(output).not.toContain("runner-reviewer-role");
			expect(output).not.toContain("project-config");
		});
	});
});

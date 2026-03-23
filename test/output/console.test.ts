import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Job } from "../../src/core/job";
import type { GateResult } from "../../src/gates/result";
import { ConsoleReporter } from "../../src/output/console";

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
		});
	});
});

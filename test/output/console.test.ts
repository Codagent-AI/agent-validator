import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Job } from "../../src/core/job";
import type { GateResult } from "../../src/gates/result";
import { ConsoleReporter } from "../../src/output/console";

describe("ConsoleReporter", () => {
	let originalConsoleError: typeof console.error;
	let originalConsoleLog: typeof console.log;
	let logOutput: string[];
	let stdoutOutput: string[];

	beforeEach(() => {
		originalConsoleError = console.error;
		originalConsoleLog = console.log;
		logOutput = [];
		stdoutOutput = [];
		console.error = (...args: unknown[]) => {
			logOutput.push(args.map(String).join(" "));
		};
		console.log = (...args: unknown[]) => {
			stdoutOutput.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		console.error = originalConsoleError;
		console.log = originalConsoleLog;
	});

	describe("onJobStart", () => {
		it("should log job start with [START] prefix", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;

			reporter.onJobStart(job);

			expect(stdoutOutput.length).toBeGreaterThan(0);
			expect(stdoutOutput.join("")).toContain("[START]");
			expect(stdoutOutput.join("")).toContain("check:test");
		});

		it("should write job start to stdout so agents can see it", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;

			reporter.onJobStart(job);

			const output = stdoutOutput.join("");
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

			const output = stdoutOutput.join("");
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
				logPath: "gauntlet_logs/check_test.log",
			};

			reporter.onJobComplete(job, result);

			const output = stdoutOutput.join("");
			expect(output).toContain("[FAIL]");
			expect(output).toContain("check:test");
			expect(output).toContain("Tests failed");
			expect(output).toContain("gauntlet_logs/check_test.log");
		});

		it("should log [ERROR] for errored jobs", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "review:test", type: "review" } as Job;
			const result: GateResult = {
				jobId: "review:test",
				status: "error",
				duration: 5000,
				message: "Failed to complete",
				logPath: "gauntlet_logs/review_test.log",
			};

			reporter.onJobComplete(job, result);

			const output = stdoutOutput.join("");
			expect(output).toContain("[ERROR]");
			expect(output).toContain("review:test");
			expect(output).toContain("Failed to complete");
			expect(output).toContain("gauntlet_logs/review_test.log");
		});

		it("should write job results to stdout so agents can see them", () => {
			const reporter = new ConsoleReporter();
			const job = { id: "check:test", type: "check" } as Job;
			const result: GateResult = {
				jobId: "check:test",
				status: "fail",
				duration: 1234,
				message: "Tests failed",
				logPath: "gauntlet_logs/check_test.log",
			};

			reporter.onJobComplete(job, result);

			const output = stdoutOutput.join("");
			expect(output).toContain("[FAIL]");
			expect(output).toContain("check:test");
			expect(output).toContain("Tests failed");
		});
	});

	describe("printSummary", () => {
		it("should log summary with status", async () => {
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{ jobId: "check:test", status: "pass", duration: 100 },
			];

			await reporter.printSummary(results);

			const output = stdoutOutput.join("");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Passed");
		});

		it("should show Failed status when jobs fail", async () => {
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

			const output = stdoutOutput.join("");
			expect(output).toContain("Status: Failed");
		});

		it("should write full summary to stdout so agents can see it", async () => {
			const reporter = new ConsoleReporter();
			const results: GateResult[] = [
				{ jobId: "check:test", status: "pass", duration: 100 },
			];

			await reporter.printSummary(results);

			const output = stdoutOutput.join(" ");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Passed");
		});

		it("should write Failed summary to stdout", async () => {
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

			const output = stdoutOutput.join(" ");
			expect(output).toContain("RESULTS SUMMARY");
			expect(output).toContain("Status: Failed");
		});
	});
});

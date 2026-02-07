import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Logger } from "../../src/output/logger";

// Mock adapter execution
const mockExecute = mock(async () => "");

mock.module("../../src/cli-adapters/index.js", () => ({
	getAdapter: (name: string) => ({
		name,
		isAvailable: async () => true,
		checkHealth: async () => ({ status: "healthy" }),
		execute: mockExecute,
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getCommandExtension: () => "md",
		canUseSymlink: () => false,
		transformCommand: (c: string) => c,
	}),
	getAllAdapters: () => [],
	getProjectCommandAdapters: () => [],
	getUserCommandAdapters: () => [],
	getValidCLITools: () => ["mock-adapter"],
	isUsageLimit: (output: string) =>
		output.toLowerCase().includes("usage limit"),
	runStreamingCommand: async () => "",
	collectStderr: () => () => "",
	processExitError: () => new Error("mock"),
	finalizeProcessClose: async () => {},
}));

// We need to import after mocking
const { ReviewGateExecutor } = await import("../../src/gates/review.js");

describe("ReviewGateExecutor Rerun Logic", () => {
	let executor: InstanceType<typeof ReviewGateExecutor>;
	let logger: Logger;
	const logDir = path.join(
		"/tmp",
		`review-rerun-test-${Math.random().toString(36).slice(2)}`,
	);

	beforeEach(async () => {
		await fs.mkdir(logDir, { recursive: true });
		logger = new Logger(logDir);
		executor = new ReviewGateExecutor();
	});

	afterEach(async () => {
		await fs.rm(logDir, { recursive: true, force: true });
		mockExecute.mockClear();
	});

	// Note: Tests for getDiff with fixBase require real git commands or dependency injection.
	// The filtering logic tests below focus on the threshold filtering which doesn't require git mocking.

	it("should filter low priority new violations in rerun mode", async () => {
		const jobId = "job-id";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("1", [
			{
				file: "file.ts",
				line: 1,
				issue: "old issue",
				status: "fixed",
			},
		]);

		// Mock LLM output with new violations
		mockExecute.mockResolvedValue(
			JSON.stringify({
				status: "fail",
				violations: [
					{
						file: "file.ts",
						line: 10,
						issue: "Critical issue",
						priority: "critical",
						status: "new",
					},
					{
						file: "file.ts",
						line: 11,
						issue: "High issue",
						priority: "high",
						status: "new",
					},
					{
						file: "file.ts",
						line: 12,
						issue: "Medium issue",
						priority: "medium",
						status: "new",
					},
					{
						file: "file.ts",
						line: 13,
						issue: "Low issue",
						priority: "low",
						status: "new",
					},
				],
			}),
		);

		const loggerFactory = logger.createLoggerFactory(jobId);

		// Use a mock getDiff by patching the executor
		// biome-ignore lint/suspicious/noExplicitAny: Patching private method for testing
		(executor as any).getDiff = async () => "mock diff content";

		const result = await executor.execute(
			jobId,
			// biome-ignore lint/suspicious/noExplicitAny: Mock config
			config as any,
			"src/",
			loggerFactory,
			"main",
			previousFailures,
			{ uncommitted: true },
			"high", // threshold
		);

		expect(result.status).toBe("fail");
		// We expect critical and high to remain. Medium and low to be filtered.

		const subResult = result.subResults?.[0];
		expect(subResult).toBeDefined();

		// Count errors.
		// errorCount is number of violations.
		expect(subResult?.errorCount).toBe(2); // Critical + High
	});

	it("should pass if all new violations are filtered", async () => {
		const jobId = "job-id-pass";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("1", [
			{
				file: "file.ts",
				line: 1,
				issue: "old issue",
				status: "fixed",
			},
		]);

		mockExecute.mockResolvedValue(
			JSON.stringify({
				status: "fail",
				violations: [
					{
						file: "file.ts",
						line: 12,
						issue: "Medium issue",
						priority: "medium",
						status: "new",
					},
					{
						file: "file.ts",
						line: 13,
						issue: "Low issue",
						priority: "low",
						status: "new",
					},
				],
			}),
		);

		const loggerFactory = logger.createLoggerFactory(jobId);

		// Use a mock getDiff by patching the executor
		// biome-ignore lint/suspicious/noExplicitAny: Patching private method for testing
		(executor as any).getDiff = async () => "mock diff content";

		const result = await executor.execute(
			jobId,
			// biome-ignore lint/suspicious/noExplicitAny: Mock config
			config as any,
			"src/",
			loggerFactory,
			"main",
			previousFailures,
			{ uncommitted: true },
			"high", // threshold
		);

		expect(result.status).toBe("pass");
		const subResult = result.subResults?.[0];
		expect(subResult?.errorCount).toBe(0);
		expect(subResult?.status).toBe("pass");
	});
});

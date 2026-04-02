import { afterEach, describe, expect, it, mock } from "bun:test";
import type { LoadedConfig } from "../../src/config/types";
import type { Job } from "../../src/core/job";
import { type IterationStats, Runner } from "../../src/core/runner";
import type { ConsoleReporter } from "../../src/output/console";
import type { Logger } from "../../src/output/logger";
import type { DebugLogger } from "../../src/utils/debug-log";

// Mock dependencies
const mockLogger = {
	init: mock(async () => { }),
	createJobLogger: mock(async () => async () => { }),
	createLoggerFactory: mock(async () => async () => { }),
	getLogPath: mock(async () => "/tmp/log.log"),
	getRunNumber: mock(() => 1),
} as unknown as Logger;

const mockReporter = {
	onJobStart: mock(() => { }),
	onJobComplete: mock(() => { }),
	printSummary: mock(async () => { }),
} as unknown as ConsoleReporter;

const mockConfig = {
	project: {
		log_dir: "/tmp/logs",
		allow_parallel: true,
		cli: {},
		rerun_new_issue_threshold: "high",
	},
} as unknown as LoadedConfig;

// Mock executors via dependency injection (not mock.module)
const mockExecuteReview = mock(async () => ({
	status: "pass",
	duration: 100,
	jobId: "review-job",
}));

const mockExecuteCheck = mock(async () => ({
	status: "pass",
	duration: 100,
	jobId: "check-job",
}));

// biome-ignore lint/suspicious/noExplicitAny: Mock executor for DI
const mockCheckExecutor = { execute: mockExecuteCheck } as any;
// biome-ignore lint/suspicious/noExplicitAny: Mock executor for DI
const mockReviewExecutor = { execute: mockExecuteReview } as any;

function createRunner(overrides?: { logger?: Logger }) {
	return new Runner(
		mockConfig,
		overrides?.logger ?? mockLogger,
		mockReporter,
		undefined, // previousFailuresMap
		undefined, // changeOptions
		undefined, // baseBranchOverride
		undefined, // passedSlotsMap
		undefined, // debugLogger
		undefined, // isRerun
		mockCheckExecutor,
		mockReviewExecutor,
	);
}

describe("Runner", () => {
	afterEach(() => {
		(mockExecuteReview as ReturnType<typeof mock>).mockClear();
		(mockExecuteCheck as ReturnType<typeof mock>).mockClear();
		(mockReporter.onJobStart as ReturnType<typeof mock>).mockClear();
		(mockReporter.onJobComplete as ReturnType<typeof mock>).mockClear();
	});

	it("should handle synchronous errors in executeJob gracefully", async () => {
		// Force review executor to throw
		mockExecuteReview.mockImplementationOnce(async () => {
			throw new Error("Crash!");
		});

		const runner = createRunner();

		const job: Job = {
			id: "review-job",
			type: "review",
			entryPoint: "src",
			gateConfig: {
				name: "review",
				cli_preference: ["mock"],
				// biome-ignore lint/suspicious/noExplicitAny: Partial mock config for testing
			} as any,
			workingDirectory: ".",
			name: "review",
		};

		// Suppress console.error during this test to prevent bun from misinterpreting
		// the expected error output as a test failure
		const originalError = console.error;
		console.error = () => { };

		const outcome = await runner.run([job]);

		console.error = originalError;

		expect(outcome.allPassed).toBe(false);
		expect(outcome.anyErrors).toBe(true);
		expect(mockReporter.onJobStart).toHaveBeenCalled();
		expect(mockReporter.onJobComplete).toHaveBeenCalledWith(
			job,
			expect.objectContaining({
				status: "error",
				message: "Crash!",
			}),
		);
	});

	describe("iteration statistics", () => {
		it("returns stats object with fixed, skipped, and failed counts", async () => {
			const runner = createRunner();

			const job: Job = {
				id: "review-job",
				type: "review",
				entryPoint: "src",
				gateConfig: {
					name: "review",
					cli_preference: ["mock"],
					// biome-ignore lint/suspicious/noExplicitAny: Partial mock config for testing
				} as any,
				workingDirectory: ".",
				name: "review",
			};

			const outcome = await runner.run([job]);

			// Should have stats object with the correct structure
			expect(outcome.stats).toBeDefined();
			expect(typeof outcome.stats.fixed).toBe("number");
			expect(typeof outcome.stats.skipped).toBe("number");
			expect(typeof outcome.stats.failed).toBe("number");
		});

		it("returns zero stats when no violations exist", async () => {
			const runner = createRunner();

			const job: Job = {
				id: "review-job",
				type: "review",
				entryPoint: "src",
				gateConfig: {
					name: "review",
					cli_preference: ["mock"],
					// biome-ignore lint/suspicious/noExplicitAny: Partial mock config for testing
				} as any,
				workingDirectory: ".",
				name: "review",
			};

			const outcome = await runner.run([job]);

			// With mock returning pass status, stats should be zero
			expect(outcome.stats.fixed).toBe(0);
			expect(outcome.stats.skipped).toBe(0);
			expect(outcome.stats.failed).toBe(0);
		});

		it("returns zero stats on retry limit exceeded early exit", async () => {
			// Create a logger that returns run number > max allowed
			const exceedLimitLogger = {
				...mockLogger,
				getRunNumber: mock(() => 5), // Exceeds default max_retries + 1 = 4
			} as unknown as Logger;

			const runner = createRunner({ logger: exceedLimitLogger });

			// Suppress console.error and save exitCode during this test to prevent
			// the expected error handling from affecting the test runner
			const originalError = console.error;
			console.error = () => { };

			const outcome = await runner.run([]);

			console.error = originalError;
			// Reset exitCode to 0 since the runner sets it to 1 on retry limit exceeded
			process.exitCode = 0;

			expect(outcome.retryLimitExceeded).toBe(true);
			expect(outcome.stats).toBeDefined();
			expect(outcome.stats.fixed).toBe(0);
			expect(outcome.stats.skipped).toBe(0);
			expect(outcome.stats.failed).toBe(0);
		});
	});

	it("passes logDir to review executor", async () => {
		const runner = createRunner();

		const job: Job = {
			id: "review-job",
			type: "review",
			entryPoint: "src",
			gateConfig: {
				name: "review",
				cli_preference: ["mock"],
				// biome-ignore lint/suspicious/noExplicitAny: Partial mock config for testing
			} as any,
			workingDirectory: ".",
			name: "review",
		};

		await runner.run([job]);

		// Verify logDir is passed to execute (index 9, before adapterConfigs at index 10)
		expect(mockExecuteReview).toHaveBeenCalled();
		// biome-ignore lint/suspicious/noExplicitAny: Testing mock call arguments
		const callArgs = (mockExecuteReview as any).mock.calls[0] as unknown[];
		expect(callArgs?.[9]).toBe("/tmp/logs");
	});
});

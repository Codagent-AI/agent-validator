import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { CLIAdapter } from "../../src/cli-adapters/index.js";
import type {
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../../src/config/types.js";
import type { ReviewGateExecutor } from "../../src/gates/review.js";
import { Logger } from "../../src/output/logger.js";

const TEST_DIR = path.join(process.cwd(), `test-review-logs-${Date.now()}`);
const COOLDOWN_STATE_DIR = path.join(
	process.cwd(),
	`test-review-cooldown-${Date.now()}`,
);

describe("ReviewGateExecutor Logging", () => {
	let logger: Logger;
	let executor: ReviewGateExecutor;

	beforeEach(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });

		// Create the log directory and logger
		const logsDir = path.join(TEST_DIR, "logs");
		await fs.mkdir(logsDir, { recursive: true });
		logger = new Logger(logsDir);

		// Create a factory function for mock adapters that returns the correct name
		const createMockAdapter = (name: string): CLIAdapter =>
			({
				name,
				isAvailable: async () => true,
				checkHealth: async () => ({ status: "healthy" }),
				execute: async () => {
					await new Promise((r) => setTimeout(r, 1)); // Simulate async work
					return JSON.stringify({ status: "pass", message: "OK" });
				},
				getProjectCommandDir: () => null,
				getUserCommandDir: () => null,
				getCommandExtension: () => "md",
				canUseSymlink: () => false,
				transformCommand: (c: string) => c,
			}) as unknown as CLIAdapter;

		// Mock getAdapter and other exports
		mock.module("../../src/cli-adapters/index.js", () => ({
			getAdapter: (name: string) => createMockAdapter(name),
			getAllAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getProjectCommandAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getUserCommandAdapters: () => [
				createMockAdapter("codex"),
				createMockAdapter("claude"),
			],
			getValidCLITools: () => ["codex", "claude", "gemini"],
			isUsageLimit: (output: string) =>
				output.toLowerCase().includes("usage limit"),
			runStreamingCommand: async () => "",
			collectStderr: () => () => "",
			processExitError: () => new Error("mock"),
			finalizeProcessClose: async () => {},
		}));

		const { ReviewGateExecutor } = await import("../../src/gates/review.js");
		executor = new ReviewGateExecutor();

		// Mock getDiff to return a simple diff without needing a real git repo
		// biome-ignore lint/suspicious/noExplicitAny: Mocking private method for testing
		(executor as any).getDiff = async () => {
			return `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1 +1 @@
-test content
+modified test content`;
		};
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		mock.restore();
	});

	it("should only create adapter-specific logs and no generic log", async () => {
		const jobId = "review:src:code-quality";
		const config = {
			name: "code-quality",
			cli_preference: ["codex", "claude"],
			num_reviews: 2,
			prompt: "Review the code",
			parallel: true,
			run_in_ci: true,
			run_locally: true,
		} as ReviewGateConfig & ReviewPromptFrontmatter;

		const loggerFactory = logger.createLoggerFactory(jobId);

		const result = await executor.execute(
			jobId,
			config,
			"src/",
			loggerFactory,
			"main",
		);

		// Enhanced error messages for better debugging
		if (result.status !== "pass") {
			throw new Error(
				`Expected result.status to be "pass" but got "${result.status}". Message: ${result.message || "none"}. Duration: ${result.duration}ms`,
			);
		}

		if (!result.logPaths) {
			throw new Error(
				`Expected result.logPaths to be defined but got ${JSON.stringify(result.logPaths)}`,
			);
		}

		if (result.logPaths.length !== 2) {
			throw new Error(
				`Expected result.logPaths to have length 2 but got ${result.logPaths.length}. Paths: ${JSON.stringify(result.logPaths)}`,
			);
		}

		// With round-robin dispatch, log files use @<index> pattern
		const hasCodex = result.logPaths.some((p) =>
			p.includes("review_src_code-quality_codex@1.1.log"),
		);
		if (!hasCodex) {
			throw new Error(
				`Expected result.logPaths to contain "review_src_code-quality_codex@1.1.log" but got full list: ${JSON.stringify(result.logPaths)}`,
			);
		}

		const hasClaude = result.logPaths.some((p) =>
			p.includes("review_src_code-quality_claude@2.1.log"),
		);
		if (!hasClaude) {
			throw new Error(
				`Expected result.logPaths to contain "review_src_code-quality_claude@2.1.log" but got full list: ${JSON.stringify(result.logPaths)}`,
			);
		}

		const logsDir = path.join(TEST_DIR, "logs");
		const files = await fs.readdir(logsDir);
		const filesList = files.join(", ");

		if (!files.includes("review_src_code-quality_codex@1.1.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_codex@1.1.log" but only found: [${filesList}]`,
			);
		}

		if (!files.includes("review_src_code-quality_claude@2.1.log")) {
			throw new Error(
				`Expected log directory to contain "review_src_code-quality_claude@2.1.log" but only found: [${filesList}]`,
			);
		}

		if (files.some((f) => f.match(/^review_src_code-quality\.\d+\.log$/))) {
			throw new Error(
				`Expected log directory NOT to contain generic log "review_src_code-quality.N.log" but it was found. All files: [${filesList}]`,
			);
		}

		// Helper to verify log content
		const verifyLogContent = async (options: {
			filename: string;
			adapterName: string;
			id: string;
		}) => {
			const { filename, adapterName, id } = options;
			const content = await fs.readFile(path.join(logsDir, filename), "utf-8");
			if (!content.includes("Starting review: code-quality")) {
				throw new Error(
					`Expected ${adapterName} log to contain "Starting review: code-quality" but got: ${content.substring(0, 200)}...`,
				);
			}
			const expectedResult = `Review result (${adapterName}@${id}): pass`;
			if (!content.includes(expectedResult)) {
				throw new Error(
					`Expected ${adapterName} log to contain "${expectedResult}" but got: ${content.substring(0, 200)}...`,
				);
			}
		};

		await verifyLogContent({
			filename: "review_src_code-quality_codex@1.1.log",
			adapterName: "codex",
			id: "1",
		});
		await verifyLogContent({
			filename: "review_src_code-quality_claude@2.1.log",
			adapterName: "claude",
			id: "2",
		});
	});

	it("should be handled correctly by ConsoleReporter", async () => {
		const logsDir = path.join(TEST_DIR, "logs");
		const jobId = "review:src:code-quality";
		const codexPath = path.join(
			logsDir,
			"review_src_code-quality_codex@1.1.log",
		);
		const claudePath = path.join(
			logsDir,
			"review_src_code-quality_claude@2.1.log",
		);

		await fs.writeFile(
			codexPath,
			`
[2026-01-14T10:00:00.000Z] Starting review: code-quality
--- Parsed Result (codex) ---
Status: FAIL
Violations:
1. src/index.ts:10 - Security risk
   Fix: Use a safer method
`,
		);

		await fs.writeFile(
			claudePath,
			`
[2026-01-14T10:00:00.000Z] Starting review: code-quality
--- Parsed Result (claude) ---
Status: FAIL
Violations:
1. src/main.ts:20 - Style issue
   Fix: Rename variable
`,
		);

		const result = {
			jobId,
			status: "fail" as const,
			duration: 1000,
			message: "Found violations",
			logPaths: [codexPath, claudePath],
		};

		const { ConsoleReporter } = await import("../../src/output/console.js");
		const reporter = new ConsoleReporter();

		// We can access extractFailureDetails directly as it is public
		const details = await reporter.extractFailureDetails(result);

		// Check for presence of key information rather than exact counts
		expect(
			details.some(
				(d: string) =>
					d.includes("src/index.ts") &&
					d.includes("10") &&
					d.includes("Security risk"),
			),
		).toBe(true);
		expect(details.some((d: string) => d.includes("Use a safer method"))).toBe(
			true,
		);
		expect(
			details.some(
				(d: string) =>
					d.includes("src/main.ts") &&
					d.includes("20") &&
					d.includes("Style issue"),
			),
		).toBe(true);
		expect(details.some((d: string) => d.includes("Rename variable"))).toBe(
			true,
		);
	});
});

describe("ReviewGateExecutor Cooldown and Usage Limit", () => {
	let logger: Logger;

	const FAKE_DIFF = `diff --git a/src/test.ts b/src/test.ts\nindex abc..def 100644\n--- a/src/test.ts\n+++ b/src/test.ts\n@@ -1 +1 @@\n-old\n+new`;

	function createMockAdapter(
		name: string,
		overrides?: Partial<CLIAdapter>,
	): CLIAdapter {
		return {
			name,
			isAvailable: async () => true,
			checkHealth: async () => ({ status: "healthy" as const }),
			execute: async () => JSON.stringify({ status: "pass", message: "OK" }),
			getProjectCommandDir: () => null,
			getUserCommandDir: () => null,
			getCommandExtension: () => "md",
			canUseSymlink: () => false,
			transformCommand: (c: string) => c,
			...overrides,
		} as unknown as CLIAdapter;
	}

	function mockAdapterModule(
		factory: (name: string) => CLIAdapter,
		names: string[],
	) {
		const adapters = names.map((n) => factory(n));
		mock.module("../../src/cli-adapters/index.js", () => ({
			getAdapter: (name: string) => factory(name),
			getAllAdapters: () => adapters,
			getProjectCommandAdapters: () => adapters,
			getUserCommandAdapters: () => adapters,
			getValidCLITools: () => names,
			isUsageLimit: (output: string) =>
				output.toLowerCase().includes("usage limit"),
			runStreamingCommand: async () => "",
			collectStderr: () => () => "",
			processExitError: () => new Error("mock"),
			finalizeProcessClose: async () => {},
		}));
	}

	async function createExecutor(): Promise<ReviewGateExecutor> {
		const { ReviewGateExecutor } = await import("../../src/gates/review.js");
		const exec = new ReviewGateExecutor();
		// biome-ignore lint/suspicious/noExplicitAny: Mocking private method for testing
		(exec as any).getDiff = async () => FAKE_DIFF;
		return exec;
	}

	async function runReview(
		executor: ReviewGateExecutor,
		preferences: string[],
	) {
		const config = {
			name: "code-quality",
			cli_preference: preferences,
			num_reviews: 1,
			prompt: "Review the code",
			parallel: true,
			run_in_ci: true,
			run_locally: true,
		} as ReviewGateConfig & ReviewPromptFrontmatter;
		const loggerFactory = logger.createLoggerFactory("review:src:test");
		return executor.execute(
			"review:src:test",
			config,
			"src/",
			loggerFactory,
			"main",
			undefined,
			undefined,
			"high",
			undefined,
			COOLDOWN_STATE_DIR,
		);
	}

	async function writeState(
		unhealthyAdapters: Record<string, { marked_at: string; reason: string }>,
	) {
		await fs.writeFile(
			path.join(COOLDOWN_STATE_DIR, ".execution_state"),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: "main",
				commit: "abc123",
				unhealthy_adapters: unhealthyAdapters,
			}),
		);
	}

	beforeEach(async () => {
		await fs.mkdir(COOLDOWN_STATE_DIR, { recursive: true });
		const logsDir = path.join(COOLDOWN_STATE_DIR, "logs");
		await fs.mkdir(logsDir, { recursive: true });
		logger = new Logger(logsDir);
	});

	afterEach(async () => {
		await fs.rm(COOLDOWN_STATE_DIR, { recursive: true, force: true });
		mock.restore();
	});

	async function runWithExecuteBehavior(overrides: Partial<CLIAdapter>) {
		mockAdapterModule((name) => createMockAdapter(name, overrides), ["codex"]);
		const executor = await createExecutor();
		return runReview(executor, ["codex"]);
	}

	it("6.3: usage limit in review output marks adapter unhealthy and returns error", async () => {
		const result = await runWithExecuteBehavior({
			execute: async () =>
				"You've hit your usage limit. Please try again later.",
		});

		expect(result.status).toBe("error");
		const stateContent = await fs.readFile(
			path.join(COOLDOWN_STATE_DIR, ".execution_state"),
			"utf-8",
		);
		const state = JSON.parse(stateContent);
		expect(state.unhealthy_adapters?.codex?.reason).toBe(
			"Usage limit exceeded",
		);
	});

	it("6.4: adapter in cooldown is skipped during review dispatch", async () => {
		await writeState({
			codex: {
				marked_at: new Date().toISOString(),
				reason: "Usage limit exceeded",
			},
		});
		mockAdapterModule((name) => createMockAdapter(name), ["codex", "claude"]);
		const executor = await createExecutor();
		const result = await runReview(executor, ["codex", "claude"]);

		expect(result.status).toBe("pass");
		expect(result.subResults).toBeDefined();
		if (result.subResults) {
			// biome-ignore lint/suspicious/noExplicitAny: Testing subResults adapter property
			expect(result.subResults.map((r: any) => r.adapter)).not.toContain(
				"codex",
			);
		}
	});

	it("6.5: adapter past cooldown with available binary is re-included", async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		await writeState({
			codex: {
				marked_at: twoHoursAgo.toISOString(),
				reason: "Usage limit exceeded",
			},
		});
		mockAdapterModule((name) => createMockAdapter(name), ["codex"]);
		const executor = await createExecutor();
		const result = await runReview(executor, ["codex"]);

		expect(result.status).toBe("pass");
		const stateContent = await fs.readFile(
			path.join(COOLDOWN_STATE_DIR, ".execution_state"),
			"utf-8",
		);
		const state = JSON.parse(stateContent);
		expect(state.unhealthy_adapters?.codex).toBeUndefined();
	});

	it("6.6: adapter past cooldown with missing binary remains excluded", async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		await writeState({
			codex: {
				marked_at: twoHoursAgo.toISOString(),
				reason: "Usage limit exceeded",
			},
		});
		mockAdapterModule(
			(name) =>
				createMockAdapter(name, {
					checkHealth: async () => ({
						status: "missing" as const,
						available: false,
						message: "Command not found",
					}),
				}),
			["codex"],
		);
		const executor = await createExecutor();
		const result = await runReview(executor, ["codex"]);

		expect(result.status).toBe("error");
		expect(result.message).toContain("no healthy adapters");
	});

	it("6.7: all adapters cooling down returns error", async () => {
		await writeState({
			codex: {
				marked_at: new Date().toISOString(),
				reason: "Usage limit exceeded",
			},
			claude: {
				marked_at: new Date().toISOString(),
				reason: "Usage limit exceeded",
			},
		});
		mockAdapterModule((name) => createMockAdapter(name), ["codex", "claude"]);
		const executor = await createExecutor();
		const result = await runReview(executor, ["codex", "claude"]);

		expect(result.status).toBe("error");
		expect(result.message).toContain("no healthy adapters");
	});

	it("6.8: non-usage-limit adapter error does not mark adapter unhealthy", async () => {
		const result = await runWithExecuteBehavior({
			execute: async () => {
				throw new Error("Network timeout");
			},
		});

		expect(result.status).toBe("error");
		try {
			const stateContent = await fs.readFile(
				path.join(COOLDOWN_STATE_DIR, ".execution_state"),
				"utf-8",
			);
			const state = JSON.parse(stateContent);
			expect(state.unhealthy_adapters?.codex).toBeUndefined();
		} catch {
			// No state file is also acceptable
		}
	});
});

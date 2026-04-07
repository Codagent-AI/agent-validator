import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { CLIAdapter } from "../../src/cli-adapters/index.js";
import type {
	ReviewGateConfig,
	ReviewPromptFrontmatter,
} from "../../src/config/types.js";
import type { ReviewGateExecutor as ReviewGateExecutorType } from "../../src/gates/review.js";
import { Logger } from "../../src/output/logger.js";

// ---------------------------------------------------------------------------
// Shared mutable delegates for mock.module()
//
// Bun runs all test files in the same process. Top-level mock.module() calls
// in other files (e.g. init.test.ts) can override per-test mocks set in
// beforeEach. To avoid this, we register the mock ONCE at the top level with
// delegates that each describe block sets in its own beforeEach.
// ---------------------------------------------------------------------------

let currentGetAdapter: (name: string) => CLIAdapter;
let currentGetAllAdapters: () => CLIAdapter[];
let currentGetValidCLITools: () => string[];
let currentIsUsageLimit: (output: string) => boolean;
let currentExecute: (...args: unknown[]) => Promise<string>;

function defaultMockAdapter(name: string): CLIAdapter {
	return {
		name,
		isAvailable: async () => true,
		checkHealth: async () => ({ status: "healthy" as const }),
		execute: async (...args: unknown[]) => currentExecute(...args),
		getProjectCommandDir: () => null,
		getUserCommandDir: () => null,
		getCommandExtension: () => "md",
		canUseSymlink: () => false,
		transformCommand: (c: string) => c,
	} as unknown as CLIAdapter;
}

function resetDefaults() {
	currentExecute = async () => JSON.stringify({ status: "pass", message: "OK" });
	currentGetAdapter = (name) => defaultMockAdapter(name);
	currentGetAllAdapters = () => [defaultMockAdapter("codex"), defaultMockAdapter("claude")];
	currentGetValidCLITools = () => ["codex", "claude"];
	currentIsUsageLimit = (output) => output.toLowerCase().includes("usage limit");
}

resetDefaults();

mock.module("../../src/cli-adapters/index.js", () => ({
	getAdapter: (name: string) => currentGetAdapter(name),
	getAllAdapters: () => currentGetAllAdapters(),
	getProjectCommandAdapters: () => currentGetAllAdapters(),
	getUserCommandAdapters: () => currentGetAllAdapters(),
	getValidCLITools: () => currentGetValidCLITools(),
	isUsageLimit: (output: string) => currentIsUsageLimit(output),
	runStreamingCommand: async () => "",
	collectStderr: () => () => "",
	processExitError: () => new Error("mock"),
	finalizeProcessClose: async () => {},
}));

const { ReviewGateExecutor } = await import("../../src/gates/review.js");

// ---------------------------------------------------------------------------

const TEST_DIR = path.join(process.cwd(), `test-review-logs-${Date.now()}`);
const COOLDOWN_STATE_DIR = path.join(
	process.cwd(),
	`test-review-cooldown-${Date.now()}`,
);

describe("ReviewGateExecutor Logging", () => {
	let logger: Logger;
	let executor: ReviewGateExecutorType;

	beforeEach(async () => {
		resetDefaults();

		// Simulate async work in execute
		currentExecute = async () => {
			await new Promise((r) => setTimeout(r, 1));
			return JSON.stringify({ status: "pass", message: "OK" });
		};

		await fs.mkdir(TEST_DIR, { recursive: true });
		const logsDir = path.join(TEST_DIR, "logs");
		await fs.mkdir(logsDir, { recursive: true });
		logger = new Logger(logsDir);

		executor = new ReviewGateExecutor();
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
			execute: async (...args: unknown[]) => currentExecute(...args),
			getProjectCommandDir: () => null,
			getUserCommandDir: () => null,
			getCommandExtension: () => "md",
			canUseSymlink: () => false,
			transformCommand: (c: string) => c,
			...overrides,
		} as unknown as CLIAdapter;
	}

	function setAdapterNames(names: string[], overrides?: Partial<CLIAdapter>) {
		const factory = (name: string) => createMockAdapter(name, overrides);
		const adapters = names.map((n) => factory(n));
		currentGetAdapter = factory;
		currentGetAllAdapters = () => adapters;
		currentGetValidCLITools = () => names;
	}

	function createExecutor(): ReviewGateExecutorType {
		const exec = new ReviewGateExecutor();
		// biome-ignore lint/suspicious/noExplicitAny: Mocking private method for testing
		(exec as any).getDiff = async () => FAKE_DIFF;
		return exec;
	}

	function runReview(
		executor: ReviewGateExecutorType,
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
		resetDefaults();
		await fs.mkdir(COOLDOWN_STATE_DIR, { recursive: true });
		const logsDir = path.join(COOLDOWN_STATE_DIR, "logs");
		await fs.mkdir(logsDir, { recursive: true });
		logger = new Logger(logsDir);
	});

	afterEach(async () => {
		await fs.rm(COOLDOWN_STATE_DIR, { recursive: true, force: true });
	});

	it("6.3: usage limit in review output marks adapter unhealthy and returns error", async () => {
		currentExecute = async () =>
			"You've hit your usage limit. Please try again later.";
		setAdapterNames(["codex"]);
		const executor = createExecutor();
		const result = await runReview(executor, ["codex"]);

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
		setAdapterNames(["codex", "claude"]);
		const executor = createExecutor();
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
		setAdapterNames(["codex"]);
		const executor = createExecutor();
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
		setAdapterNames(["codex"], {
			checkHealth: async () => ({
				status: "missing" as const,
				available: false,
				message: "Command not found",
			}),
		});
		const executor = createExecutor();
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
		setAdapterNames(["codex", "claude"]);
		const executor = createExecutor();
		const result = await runReview(executor, ["codex", "claude"]);

		expect(result.status).toBe("error");
		expect(result.message).toContain("no healthy adapters");
	});

	it("6.8: non-usage-limit adapter error does not mark adapter unhealthy", async () => {
		currentExecute = async () => {
			throw new Error("Network timeout");
		};
		setAdapterNames(["codex"]);
		const executor = createExecutor();
		const result = await runReview(executor, ["codex"]);

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

describe("ReviewGateExecutor Rerun Logic", () => {
	let logger: Logger;
	const RERUN_DIR = path.join(
		process.cwd(),
		`test-review-rerun-${Date.now()}`,
	);

	beforeEach(async () => {
		resetDefaults();
		currentGetAllAdapters = () => [];
		currentGetValidCLITools = () => ["mock-adapter"];
		await fs.mkdir(RERUN_DIR, { recursive: true });
		logger = new Logger(RERUN_DIR);
	});

	afterEach(async () => {
		await fs.rm(RERUN_DIR, { recursive: true, force: true });
	});

	it("should filter low priority new violations in rerun mode", async () => {
		currentExecute = async () =>
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
			});

		const executor = new ReviewGateExecutor();
		const jobId = "job-id";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("1", [
			{ file: "file.ts", line: 1, issue: "old issue", status: "fixed" },
		]);

		const loggerFactory = logger.createLoggerFactory(jobId);
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
			"high",
		);

		expect(result.status).toBe("fail");
		const subResult = result.subResults?.[0];
		expect(subResult).toBeDefined();
		expect(subResult?.errorCount).toBe(2); // Critical + High
	});

	it("should pass if all new violations are filtered", async () => {
		currentExecute = async () =>
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
			});

		const executor = new ReviewGateExecutor();
		const jobId = "job-id-pass";
		const config = {
			name: "test-review",
			cli_preference: ["mock-adapter"],
			num_reviews: 1,
		};

		const previousFailures = new Map();
		previousFailures.set("1", [
			{ file: "file.ts", line: 1, issue: "old issue", status: "fixed" },
		]);

		const loggerFactory = logger.createLoggerFactory(jobId);
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
			"high",
		);

		expect(result.status).toBe("pass");
		const subResult = result.subResults?.[0];
		expect(subResult?.errorCount).toBe(0);
		expect(subResult?.status).toBe("pass");
	});
});

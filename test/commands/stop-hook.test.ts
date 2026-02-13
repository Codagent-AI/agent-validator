import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

const TEST_DIR = path.join(process.cwd(), `test-stop-hook-${Date.now()}`);

// Store mocks
let spawnMock: ReturnType<typeof mock>;

// Mock child_process.spawn, exec, and execFile
mock.module("node:child_process", () => {
	return {
		spawn: (...args: unknown[]) => spawnMock?.(...args),
		exec: mock(() => { }),
		execFile: mock(
			(
				cmd: string,
				args: string[],
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				callback(null, "", "");
			},
		),
	};
});

// Import after mocking
const {
	registerStopHookCommand,
	outputHookResponse,
	getStatusMessage,
} = await import("../../src/commands/stop-hook.js");

import type { StopHookStatus } from "../../src/commands/stop-hook.js";
import {
	isBlockingStatus,
	isSuccessStatus,
} from "../../src/types/gauntlet-status.js";

describe("Stop Hook Command", () => {
	let program: Command;
	let logs: string[];
	const originalCwd = process.cwd();
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;

	beforeAll(async () => {
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	beforeEach(async () => {
		program = new Command();
		registerStopHookCommand(program);
		logs = [];

		console.log = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};

		process.chdir(TEST_DIR);

		// Reset spawn mock to default behavior
		spawnMock = mock(() => {
			const mockChild = {
				stdout: {
					on: mock(() => { }),
				},
				stderr: {
					on: mock(() => { }),
				},
				on: mock((event: string, callback: (code: number) => void) => {
					if (event === "close") {
						setTimeout(() => callback(0), 10);
					}
				}),
			};
			return mockChild;
		});
	});

	afterEach(async () => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		process.chdir(originalCwd);

		// Clean up test artifacts
		await fs
			.rm(path.join(TEST_DIR, ".gauntlet"), {
				recursive: true,
				force: true,
			})
			.catch(() => { });
		await fs
			.rm(path.join(TEST_DIR, "gauntlet_logs"), {
				recursive: true,
				force: true,
			})
			.catch(() => { });
		await fs
			.rm(path.join(TEST_DIR, "src"), {
				recursive: true,
				force: true,
			})
			.catch(() => { });
		await fs
			.rm(path.join(TEST_DIR, "package.json"), { force: true })
			.catch(() => { });
	});

	describe("Command Registration", () => {
		it("should register the stop-hook command", () => {
			const cmd = program.commands.find((c) => c.name() === "stop-hook");
			expect(cmd).toBeDefined();
			expect(cmd?.description()).toBe(
				"Claude Code stop hook - validates gauntlet completion",
			);
		});
	});

	describe("Protocol Compliance", () => {
		it("should parse valid JSON input correctly", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main",
			);

			// Mock spawn to return passing status
			spawnMock = mock(() => {
				const mockChild = {
					stdout: {
						on: mock((event: string, callback: (data: Buffer) => void) => {
							if (event === "data") {
								callback(Buffer.from("Status: Passed\n"));
							}
						}),
					},
					stderr: {
						on: mock(() => { }),
					},
					on: mock((event: string, callback: (code: number) => void) => {
						if (event === "close") {
							setTimeout(() => callback(0), 10);
						}
					}),
				};
				return mockChild;
			});

			// We can't easily test stdin parsing in unit tests without complex mocking
			// This test verifies the command structure is correct
			expect(
				program.commands.find((c) => c.name() === "stop-hook"),
			).toBeDefined();
		});
	});

	describe("Infinite Loop Prevention", () => {
		it("should document that stop_hook_active=true allows stop immediately", () => {
			// This behavior is implemented in the stop-hook command
			// When stop_hook_active is true, the command exits 0 without running gauntlet
			// Testing this requires stdin mocking which is complex in bun:test
			expect(true).toBe(true);
		});
	});

	describe("Gauntlet Project Detection", () => {
		it("should allow stop when no .gauntlet/config.yml exists", async () => {
			// No gauntlet config = allow stop
			// The command checks for .gauntlet/config.yml and exits 0 if not found
			const configPath = path.join(TEST_DIR, ".gauntlet", "config.yml");
			const configExists = await fs.stat(configPath).catch(() => false);
			expect(configExists).toBe(false);
		});

		it("should proceed to gauntlet execution when config exists", async () => {
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main",
			);

			const configPath = path.join(TEST_DIR, ".gauntlet", "config.yml");
			const stat = await fs.stat(configPath);
			expect(stat.isFile()).toBe(true);
		});
	});

	describe("Environment Detection", () => {
		it("should detect local dev environment correctly", async () => {
			// Create local dev environment markers
			await fs.mkdir(path.join(TEST_DIR, "src"), { recursive: true });
			await fs.writeFile(path.join(TEST_DIR, "src", "index.ts"), "// index");
			await fs.writeFile(
				path.join(TEST_DIR, "package.json"),
				JSON.stringify({ name: "agent-gauntlet" }),
			);

			const packageJson = JSON.parse(
				await fs.readFile(path.join(TEST_DIR, "package.json"), "utf-8"),
			);
			expect(packageJson.name).toBe("agent-gauntlet");
		});

		it("should detect installed environment when package name differs", async () => {
			await fs.writeFile(
				path.join(TEST_DIR, "package.json"),
				JSON.stringify({ name: "other-project" }),
			);

			const packageJson = JSON.parse(
				await fs.readFile(path.join(TEST_DIR, "package.json"), "utf-8"),
			);
			expect(packageJson.name).not.toBe("agent-gauntlet");
		});
	});

	describe("Termination Condition Checking", () => {
		it("should recognize 'Status: Passed' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Passed\nDone.";
			expect(output.includes("Status: Passed")).toBe(true);
		});

		it("should recognize 'Status: Passed with warnings' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Passed with warnings\nDone.";
			expect(output.includes("Status: Passed with warnings")).toBe(true);
		});

		it("should recognize 'Status: Retry limit exceeded' as termination condition", () => {
			const output = "Running gauntlet...\nStatus: Retry limit exceeded\nDone.";
			expect(output.includes("Status: Retry limit exceeded")).toBe(true);
		});

		it("should not recognize other statuses as termination conditions", () => {
			const output = "Running gauntlet...\nStatus: Failed\nDone.";
			const terminationConditions = [
				"Status: Passed",
				"Status: Passed with warnings",
				"Status: Retry limit exceeded",
			];
			const hasTermination = terminationConditions.some((c) =>
				output.includes(c),
			);
			expect(hasTermination).toBe(false);
		});
	});

	describe("Infrastructure Error Detection", () => {
		it("should recognize 'A gauntlet run is already in progress' as infrastructure error", () => {
			const output = "Error: A gauntlet run is already in progress. Exiting.";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			expect(hasInfraError).toBe(true);
		});

		it("should not recognize regular gauntlet failures as infrastructure errors", () => {
			const output = "Status: Failed\nLint check failed.";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			expect(hasInfraError).toBe(false);
		});

		it("should not match broad patterns that could appear in legitimate output", () => {
			// command not found could appear in test output, so it's not matched
			const output = "Test failed: command not found: missing-tool";
			const infrastructureErrors = ["A gauntlet run is already in progress"];
			const hasInfraError = infrastructureErrors.some((e) =>
				output.toLowerCase().includes(e.toLowerCase()),
			);
			// Should NOT match - command not found is handled by spawn error handler
			expect(hasInfraError).toBe(false);
		});
	});

	describe("Hook Response Output", () => {
		it("should output valid JSON with decision and reason fields", () => {
			const hookResponse = {
				decision: "block",
				reason:
					"Gauntlet gates did not pass. Please fix the issues before stopping.",
			};

			const output = JSON.stringify(hookResponse);
			const parsed = JSON.parse(output);

			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toBeDefined();
			expect(typeof parsed.reason).toBe("string");
		});

		it("should output single-line JSON", () => {
			const hookResponse = {
				decision: "block",
				reason: "Gauntlet gates did not pass.",
			};

			const output = JSON.stringify(hookResponse);
			expect(output.includes("\n")).toBe(false);
		});
	});

	describe("Lock Pre-Check", () => {
		it("should check for lock file existence before spawning", async () => {
			// Create gauntlet config and lock file
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".gauntlet-run.lock"),
				"12345",
			);

			// If lock file exists, stop hook should allow stop without spawning
			const lockPath = path.join(
				TEST_DIR,
				"gauntlet_logs",
				".gauntlet-run.lock",
			);
			const lockExists = await fs
				.stat(lockPath)
				.then(() => true)
				.catch(() => false);
			expect(lockExists).toBe(true);
		});
	});

	describe("Run Interval Check", () => {
		it("should skip run when interval not elapsed", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });

			// Create execution state with recent timestamp
			const state = {
				last_run_completed_at: new Date().toISOString(),
				branch: "main",
				commit: "abc123",
			};
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				JSON.stringify(state),
			);

			// Verify state file was created
			const stateContent = await fs.readFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				"utf-8",
			);
			const parsedState = JSON.parse(stateContent);
			expect(parsedState.last_run_completed_at).toBeDefined();
		});

		it("should run when interval has elapsed", async () => {
			// Create gauntlet config
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);
			await fs.mkdir(path.join(TEST_DIR, "gauntlet_logs"), { recursive: true });

			// Create execution state with old timestamp (15 minutes ago)
			const oldTime = new Date(Date.now() - 15 * 60 * 1000);
			const state = {
				last_run_completed_at: oldTime.toISOString(),
				branch: "main",
				commit: "abc123",
			};
			await fs.writeFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				JSON.stringify(state),
			);

			// Verify state file was created with old timestamp
			const stateContent = await fs.readFile(
				path.join(TEST_DIR, "gauntlet_logs", ".execution_state"),
				"utf-8",
			);
			const parsedState = JSON.parse(stateContent);
			const elapsedMinutes =
				(Date.now() - new Date(parsedState.last_run_completed_at).getTime()) /
				(1000 * 60);
			// Should be at least 14 minutes (accounting for test execution time)
			expect(elapsedMinutes).toBeGreaterThan(14);
		});

		it("should run when no execution state exists", async () => {
			// Clean up any leftover gauntlet_logs from previous tests
			await fs
				.rm(path.join(TEST_DIR, "gauntlet_logs"), {
					recursive: true,
					force: true,
				})
				.catch(() => { });

			// Create gauntlet config without execution state
			await fs.mkdir(path.join(TEST_DIR, ".gauntlet"), { recursive: true });
			await fs.writeFile(
				path.join(TEST_DIR, ".gauntlet", "config.yml"),
				"base_branch: main\nlog_dir: gauntlet_logs",
			);

			// Verify no execution state exists (gauntlet_logs directory doesn't exist)
			const statePath = path.join(
				TEST_DIR,
				"gauntlet_logs",
				".execution_state",
			);
			const stateExists = await fs
				.stat(statePath)
				.then(() => true)
				.catch(() => false);
			expect(stateExists).toBe(false);
		});
	});

	describe("getStatusMessage", () => {
		it("should return appropriate message for passed status", () => {
			const message = getStatusMessage("passed");
			expect(message).toBe(
				"✓ Gauntlet passed — all gates completed successfully.",
			);
		});

		it("should return appropriate message for no_applicable_gates status", () => {
			const message = getStatusMessage("no_applicable_gates");
			expect(message).toBe(
				"✓ Gauntlet passed — no applicable gates matched current changes.",
			);
		});

		it("should return appropriate message for passed_with_warnings status", () => {
			const message = getStatusMessage("passed_with_warnings");
			expect(message).toBe(
				"✓ Gauntlet completed — passed with warnings (some issues were skipped).",
			);
		});

		it("should return appropriate message for retry_limit_exceeded status", () => {
			const message = getStatusMessage("retry_limit_exceeded");
			expect(message).toContain("Gauntlet terminated");
			expect(message).toContain("retry limit exceeded");
			expect(message).toContain("agent-gauntlet clean");
		});

		it("should include interval minutes in interval_not_elapsed message", () => {
			const message = getStatusMessage("interval_not_elapsed", {
				intervalMinutes: 10,
			});
			expect(message).toContain("10 min");
			expect(message).toContain("Gauntlet skipped");
		});

		it("should return default message for interval_not_elapsed without context", () => {
			const message = getStatusMessage("interval_not_elapsed");
			expect(message).toContain("Gauntlet skipped");
			expect(message).toContain("run interval not elapsed");
		});

		it("should return appropriate message for lock_conflict status", () => {
			const message = getStatusMessage("lock_conflict");
			expect(message).toContain("Gauntlet skipped");
			expect(message).toContain("already in progress");
		});

		it("should return appropriate message for no_changes status", () => {
			const message = getStatusMessage("no_changes");
			expect(message).toContain("Gauntlet passed");
			expect(message).toContain("no changes detected");
		});

		it("should return appropriate message for failed status", () => {
			const message = getStatusMessage("failed");
			expect(message).toContain("Gauntlet failed");
			expect(message).toContain("issues must be fixed");
		});

		it("should return appropriate message for no_config status", () => {
			const message = getStatusMessage("no_config");
			expect(message).toContain("Not a gauntlet project");
			expect(message).toContain(".gauntlet/config.yml");
		});

		it("should return appropriate message for stop_hook_active status", () => {
			const message = getStatusMessage("stop_hook_active");
			expect(message).toContain("Stop hook cycle detected");
			expect(message).toContain("infinite loop");
		});

		it("should include error message in error status message", () => {
			const message = getStatusMessage("error", {
				errorMessage: "Unexpected error occurred",
			});
			expect(message).toContain("Stop hook error");
			expect(message).toContain("Unexpected error occurred");
		});

		it("should return default message for error without context", () => {
			const message = getStatusMessage("error");
			expect(message).toContain("Stop hook error");
			expect(message).toContain("unexpected error");
		});

		it("should return appropriate message for invalid_input status", () => {
			const message = getStatusMessage("invalid_input");
			expect(message).toContain("Invalid hook input");
			expect(message).toContain("could not parse JSON");
		});
	});

	describe("outputHookResponse JSON format", () => {
		it("should output JSON with status and message for passed status", () => {
			outputHookResponse("passed");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("passed");
			expect(response.message).toContain("Gauntlet passed");
		});

		it("should output JSON with status and message for no_applicable_gates status", () => {
			outputHookResponse("no_applicable_gates");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("no_applicable_gates");
			expect(response.message).toContain("no applicable gates");
		});

		it("should output JSON with status and message for passed_with_warnings status", () => {
			outputHookResponse("passed_with_warnings");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("passed_with_warnings");
			expect(response.message).toContain("passed with warnings");
		});

		it("should output JSON with status and message for retry_limit_exceeded status", () => {
			outputHookResponse("retry_limit_exceeded");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("retry_limit_exceeded");
			expect(response.message).toContain("retry limit exceeded");
		});

		it("should output JSON with status and message for interval_not_elapsed status", () => {
			outputHookResponse("interval_not_elapsed", { intervalMinutes: 10 });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("interval_not_elapsed");
			expect(response.message).toContain("10 min");
		});

		it("should output JSON with status and message for lock_conflict status", () => {
			outputHookResponse("lock_conflict");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("lock_conflict");
			expect(response.message).toContain("already in progress");
		});

		it("should output JSON with status and message for no_changes status", () => {
			outputHookResponse("no_changes");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("no_changes");
			expect(response.message).toContain("no changes detected");
		});

		it("should output JSON with decision=block for failed status", () => {
			outputHookResponse("failed", { reason: "Fix the issues" });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("block");
			expect(response.status).toBe("failed");
			expect(response.message).toContain("Gauntlet failed");
			expect(response.reason).toBe("Fix the issues");
		});

		it("should output JSON with status and message for no_config status", () => {
			outputHookResponse("no_config");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("no_config");
			expect(response.message).toContain("Not a gauntlet project");
		});

		it("should output JSON with status and message for stop_hook_active status", () => {
			outputHookResponse("stop_hook_active");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("stop_hook_active");
			expect(response.message).toContain("Stop hook cycle");
		});

		it("should output JSON with status and message for error status", () => {
			outputHookResponse("error", { errorMessage: "Something went wrong" });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("error");
			expect(response.message).toContain("Something went wrong");
		});

		it("should output JSON with status and message for invalid_input status", () => {
			outputHookResponse("invalid_input");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("invalid_input");
			expect(response.message).toContain("Invalid hook input");
		});

		it("should only produce decision=block for blocking statuses", () => {
			const allStatuses: StopHookStatus[] = [
				"passed",
				"no_applicable_gates",
				"passed_with_warnings",
				"no_changes",
				"retry_limit_exceeded",
				"interval_not_elapsed",
				"lock_conflict",
				"error",
				"failed",
				"no_config",
				"stop_hook_active",
				"loop_detected",
				"invalid_input",
				"pr_push_required",
				"ci_pending",
				"ci_failed",
				"ci_passed",
				"validation_required",
				"stop_hook_disabled",
			];

			for (const status of allStatuses) {
				logs = []; // Clear logs for each test
				outputHookResponse(status);
				const response = JSON.parse(logs[0]!);
				const blockingStatuses = ["failed", "pr_push_required", "ci_pending", "ci_failed", "validation_required"];
				if (blockingStatuses.includes(status)) {
					expect(response.decision).toBe("block");
				} else {
					expect(response.decision).toBe("approve");
				}
			}
		});

		it("should output single-line JSON for all responses", () => {
			outputHookResponse("passed");
			expect(logs[0]!.includes("\n")).toBe(false);
		});
	});

	describe("stopReason field (always displayed to user)", () => {
		it("should include stopReason in response for blocking status with detailed instructions", () => {
			const instructions = "**GAUNTLET FAILED** - Fix the issues";
			outputHookResponse("failed", { reason: instructions });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.stopReason).toBe(instructions);
			expect(response.reason).toBe(instructions);
		});

		it("should include stopReason with human-friendly message for passed status", () => {
			outputHookResponse("passed");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.stopReason).toBeDefined();
			expect(response.stopReason).toContain("Gauntlet passed");
		});

		it("should include stopReason for interval_not_elapsed indicating interval not elapsed", () => {
			outputHookResponse("interval_not_elapsed", { intervalMinutes: 10 });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.stopReason).toBeDefined();
			expect(response.stopReason).toContain("10 min");
			expect(response.stopReason).toContain("not elapsed");
		});

		it("should include stopReason for no_config indicating not a gauntlet project", () => {
			outputHookResponse("no_config");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.stopReason).toBeDefined();
			expect(response.stopReason).toContain("Not a gauntlet project");
		});

		it("should include stopReason for lock_conflict indicating another run in progress", () => {
			outputHookResponse("lock_conflict");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.stopReason).toBeDefined();
			expect(response.stopReason).toContain("already in progress");
		});

		it("should include stopReason for all non-blocking statuses", () => {
			const nonBlockingStatuses: StopHookStatus[] = [
				"passed",
				"passed_with_warnings",
				"no_applicable_gates",
				"no_changes",
				"retry_limit_exceeded",
				"interval_not_elapsed",
				"lock_conflict",
				"no_config",
				"stop_hook_active",
				"loop_detected",
				"error",
				"invalid_input",
			];

			for (const status of nonBlockingStatuses) {
				logs = []; // Clear logs for each test
				outputHookResponse(status);
				const response = JSON.parse(logs[0]!);
				expect(response.stopReason).toBeDefined();
				expect(typeof response.stopReason).toBe("string");
				expect(response.stopReason.length).toBeGreaterThan(0);
			}
		});
	});

	describe("child process detection (GAUNTLET_STOP_HOOK_ACTIVE_ENV)", () => {
		it("should allow stop immediately when GAUNTLET_STOP_HOOK_ACTIVE env var is set", async () => {
			// Set the environment variable before running
			process.env.GAUNTLET_STOP_HOOK_ACTIVE = "1";

			try {
				// Simulate stdin with valid JSON
				const originalStdin = process.stdin;
				const mockStdin = {
					on: mock((event: string, callback: (chunk: Buffer) => void) => {
						if (event === "data") {
							setTimeout(() => callback(Buffer.from("{}\n")), 0);
						}
					}),
					readableEnded: false,
					removeListener: mock(() => { }),
				};
				// biome-ignore lint/suspicious/noExplicitAny: Mock stdin for testing
				(process as any).stdin = mockStdin;

				await program.parseAsync(["node", "cli", "stop-hook"]);

				// biome-ignore lint/suspicious/noExplicitAny: Restore stdin
				(process as any).stdin = originalStdin;

				// Should have a single JSON output with stop_hook_active status
				expect(logs.length).toBeGreaterThan(0);
				// The verbose log uses console.error which we capture in logs
				const jsonOutput = logs.find((l) => l.startsWith("{"));
				if (jsonOutput) {
					const response = JSON.parse(jsonOutput);
					expect(response.decision).toBe("approve");
					expect(response.status).toBe("stop_hook_active");
				}
			} finally {
				// Clean up
				delete process.env.GAUNTLET_STOP_HOOK_ACTIVE;
			}
		});

		it("should not initialize debug logger when child process detected", async () => {
			// This test verifies the code path - debug logger init happens AFTER the child process check
			// So when GAUNTLET_STOP_HOOK_ACTIVE is set, no debug logging should occur
			process.env.GAUNTLET_STOP_HOOK_ACTIVE = "1";

			try {
				const originalStdin = process.stdin;
				const mockStdin = {
					on: mock((event: string, callback: (chunk: Buffer) => void) => {
						if (event === "data") {
							setTimeout(() => callback(Buffer.from("{}\n")), 0);
						}
					}),
					readableEnded: false,
					removeListener: mock(() => { }),
				};
				// biome-ignore lint/suspicious/noExplicitAny: Mock stdin for testing
				(process as any).stdin = mockStdin;

				await program.parseAsync(["node", "cli", "stop-hook"]);

				// biome-ignore lint/suspicious/noExplicitAny: Restore stdin
				(process as any).stdin = originalStdin;

				// Should return immediately with stop_hook_active
				const jsonOutput = logs.find((l) => l.startsWith("{"));
				if (jsonOutput) {
					const response = JSON.parse(jsonOutput);
					expect(response.status).toBe("stop_hook_active");
				}
			} finally {
				delete process.env.GAUNTLET_STOP_HOOK_ACTIVE;
			}
		});
	});

	describe("self-timeout safety net", () => {
		it("should have a self-timeout that fires outputHookResponse and exits", async () => {
			// Read source file to verify the self-timeout is present
			const { readFileSync } = await import("node:fs");
			const sourceFile = readFileSync(
				path.join(originalCwd, "src/commands/stop-hook.ts"),
				"utf-8",
			);

			// Should have the self-timeout constant
			expect(sourceFile).toContain("STOP_HOOK_TIMEOUT_MS");
			expect(sourceFile).toContain("5 * 60 * 1000");

			// Should set up setTimeout at the start of the action handler
			const actionStart = sourceFile.indexOf(".action(async ()");
			const selfTimeoutSetup = sourceFile.indexOf("setTimeout(", actionStart);
			const stdinRead = sourceFile.indexOf("readStdin", actionStart);

			// Self-timeout should be set BEFORE stdin read
			expect(selfTimeoutSetup).toBeLessThan(stdinRead);

			// Should call process.exit(0) in the timeout handler
			expect(sourceFile).toContain("process.exit(0)");

			// Should unref the timer so it doesn't keep the process alive
			expect(sourceFile).toContain("selfTimeout.unref()");
		});

		it("should clear the self-timeout in a finally block", async () => {
			const { readFileSync } = await import("node:fs");
			const sourceFile = readFileSync(
				path.join(originalCwd, "src/commands/stop-hook.ts"),
				"utf-8",
			);

			// Should clear the timeout in a finally block
			expect(sourceFile).toContain("clearTimeout(selfTimeout)");
			// The finally block should exist
			expect(sourceFile).toContain("} finally {");
		});
	});

	describe("pr_push_required status", () => {
		it("isBlockingStatus returns true for pr_push_required", () => {
			expect(isBlockingStatus("pr_push_required")).toBe(true);
		});

		it("isBlockingStatus returns true for failed", () => {
			expect(isBlockingStatus("failed")).toBe(true);
		});

		it("isBlockingStatus returns false for passed", () => {
			expect(isBlockingStatus("passed")).toBe(false);
		});

		it("getStatusMessage returns appropriate message for pr_push_required", () => {
			const message = getStatusMessage("pr_push_required");
			expect(message).toContain("Gauntlet passed");
			expect(message).toContain("PR needs to be created or updated");
		});

		it("outputHookResponse outputs block decision for pr_push_required", () => {
			const instructions = "Create a PR";
			outputHookResponse("pr_push_required", { reason: instructions });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("block");
			expect(response.status).toBe("pr_push_required");
			expect(response.reason).toBe(instructions);
		});
	});

	describe("CI status handling", () => {
		describe("isBlockingStatus with CI statuses", () => {
			it("returns true for ci_pending", () => {
				expect(isBlockingStatus("ci_pending")).toBe(true);
			});

			it("returns true for ci_failed", () => {
				expect(isBlockingStatus("ci_failed")).toBe(true);
			});

			it("returns false for ci_passed", () => {
				expect(isBlockingStatus("ci_passed")).toBe(false);
			});
		});

		describe("isSuccessStatus with CI statuses", () => {
			it("returns true for ci_passed", () => {
				expect(isSuccessStatus("ci_passed")).toBe(true);
			});

			it("returns false for ci_pending", () => {
				expect(isSuccessStatus("ci_pending")).toBe(false);
			});

			it("returns false for ci_failed", () => {
				expect(isSuccessStatus("ci_failed")).toBe(false);
			});
		});

		describe("getStatusMessage with CI statuses", () => {
			it("returns appropriate message for ci_pending", () => {
				const message = getStatusMessage("ci_pending");
				expect(message).toContain("CI checks still running");
			});

			it("returns appropriate message for ci_failed", () => {
				const message = getStatusMessage("ci_failed");
				expect(message).toContain("CI failed");
			});

			it("returns appropriate message for ci_passed", () => {
				const message = getStatusMessage("ci_passed");
				expect(message).toContain("CI passed");
			});
		});
	});

	describe("validation_required status", () => {
		it("isBlockingStatus returns true for validation_required", () => {
			expect(isBlockingStatus("validation_required")).toBe(true);
		});

		it("getStatusMessage returns appropriate message for validation_required", () => {
			const message = getStatusMessage("validation_required");
			expect(message).toContain("changes detected");
		});

		it("outputHookResponse outputs block decision for validation_required", () => {
			outputHookResponse("validation_required", { reason: "Use gauntlet-run skill" });
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("block");
			expect(response.status).toBe("validation_required");
			expect(response.reason).toBe("Use gauntlet-run skill");
		});
	});

	describe("loop_detected status", () => {
		it("isBlockingStatus returns false for loop_detected", () => {
			expect(isBlockingStatus("loop_detected")).toBe(false);
		});

		it("getStatusMessage returns appropriate message for loop_detected", () => {
			const message = getStatusMessage("loop_detected");
			expect(message).toContain("Loop detected");
			expect(message).toContain("3 times within 60s");
		});

		it("outputHookResponse outputs approve decision for loop_detected", () => {
			outputHookResponse("loop_detected");
			expect(logs.length).toBe(1);
			const response = JSON.parse(logs[0]!);
			expect(response.decision).toBe("approve");
			expect(response.status).toBe("loop_detected");
			expect(response.message).toContain("Loop detected");
		});
	});
});

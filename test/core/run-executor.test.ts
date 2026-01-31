import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("run-executor logging", () => {
	describe("LogTape integration", () => {
		it("uses getCategoryLogger for logging", () => {
			// Read the source file and verify it uses the app logger
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should import getCategoryLogger from app-logger
			expect(sourceFile).toContain("getCategoryLogger");
			expect(sourceFile).toContain("app-logger");
		});

		it("initializes logger in interactive mode when not already configured", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should check if logger is configured and initialize if not
			expect(sourceFile).toContain("isLoggerConfigured");
			expect(sourceFile).toContain('mode: "interactive"');
		});
	});
});

describe("console-log.ts stderr capture", () => {
	it("console-log.ts captures both stdout and stderr", () => {
		// Read the source file and verify it intercepts stderr
		const sourceFile = readFileSync(
			join(process.cwd(), "src/output/console-log.ts"),
			"utf-8",
		);

		// Should intercept process.stderr.write
		expect(sourceFile).toContain("process.stderr.write");
		// Should call writeToLog for stderr
		expect(sourceFile.match(/stderr\.write.*writeToLog/s)).not.toBeNull();
	});

	it("both stdout and stderr write to the log file", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/output/console-log.ts"),
			"utf-8",
		);

		// Both stdout and stderr should have writeToLog calls
		const stdoutWrite = sourceFile.match(
			/process\.stdout\.write\s*=\s*\([^)]*\)[^{]*\{[^}]*writeToLog/s,
		);
		const stderrWrite = sourceFile.match(
			/process\.stderr\.write\s*=\s*\([^)]*\)[^{]*\{[^}]*writeToLog/s,
		);

		expect(stdoutWrite).not.toBeNull();
		expect(stderrWrite).not.toBeNull();
	});
});

describe("run-executor stop hook config", () => {
	describe("stop_hook_disabled status", () => {
		it("should have stop_hook_disabled in getStatusMessage", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			expect(sourceFile).toContain('"stop_hook_disabled"');
			expect(sourceFile).toContain("Stop hook is disabled via configuration");
		});

		it("should import resolveStopHookConfig", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			expect(sourceFile).toContain("resolveStopHookConfig");
			expect(sourceFile).toContain("stop-hook-config");
		});

		it("should check enabled status before interval check", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should check stopHookConfig.enabled
			expect(sourceFile).toContain("stopHookConfig.enabled");
			expect(sourceFile).toContain("!stopHookConfig.enabled");
		});

		it("should return stop_hook_disabled when disabled", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should return stop_hook_disabled status
			expect(sourceFile).toContain('status: "stop_hook_disabled"');
		});
	});

	describe("interval zero means always run", () => {
		it("should skip interval check when interval is 0", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should check if interval > 0 before checking elapsed time
			expect(sourceFile).toContain("stopHookConfig.run_interval_minutes > 0");
		});
	});
});

describe("run-executor checkInterval option", () => {
	describe("ExecuteRunOptions interface", () => {
		it("should have checkInterval option in the interface", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should have checkInterval in interface
			expect(sourceFile).toContain("checkInterval?: boolean");
		});
	});

	describe("interval checking logic", () => {
		it("should include shouldRunBasedOnInterval function", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should have the interval checking function
			expect(sourceFile).toContain("shouldRunBasedOnInterval");
			expect(sourceFile).toContain("intervalMinutes");
		});

		it("should check interval before lock acquisition when checkInterval is true", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Interval check should appear before lock acquisition in the executeRun function
			const executeRunStart = sourceFile.indexOf(
				"export async function executeRun",
			);
			const intervalCheckInExecute = sourceFile.indexOf(
				"options.checkInterval",
				executeRunStart,
			);
			const lockAcquisitionInExecute = sourceFile.indexOf(
				"await tryAcquireLock",
				executeRunStart,
			);

			// First verify both substrings exist in executeRun
			expect(intervalCheckInExecute).toBeGreaterThan(-1);
			expect(lockAcquisitionInExecute).toBeGreaterThan(-1);

			// Then verify ordering
			expect(intervalCheckInExecute).toBeLessThan(lockAcquisitionInExecute);
		});

		it("should check interval before auto-clean when checkInterval is true", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Find positions of interval check and auto-clean
			const executeRunStart = sourceFile.indexOf(
				"export async function executeRun",
			);
			const intervalCheckInExecute = sourceFile.indexOf(
				"options.checkInterval",
				executeRunStart,
			);
			const autoCleanInExecute = sourceFile.indexOf(
				"shouldAutoClean",
				executeRunStart,
			);

			// First verify both substrings exist in executeRun
			expect(intervalCheckInExecute).toBeGreaterThan(-1);
			expect(autoCleanInExecute).toBeGreaterThan(-1);

			// Then verify ordering
			expect(intervalCheckInExecute).toBeLessThan(autoCleanInExecute);
		});

		it("should return interval_not_elapsed status when interval has not elapsed", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should return interval_not_elapsed status
			expect(sourceFile).toContain('"interval_not_elapsed"');
			expect(sourceFile).toContain('status: "interval_not_elapsed"');
		});

		it("should only check interval when no existing logs (not in rerun mode)", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should have logic to skip interval check when logs exist
			expect(sourceFile).toMatch(
				/checkInterval[\s\S]*hasExistingLogs[\s\S]*!logsExist/,
			);
		});

		it("should use resolveStopHookConfig for interval configuration", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/core/run-executor.ts"),
				"utf-8",
			);

			// Should resolve config using the new resolver
			expect(sourceFile).toContain("resolveStopHookConfig");
			expect(sourceFile).toContain("config.project.stop_hook");
		});
	});

	describe("CLI commands behavior", () => {
		it("run command should not pass checkInterval (source verification)", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/commands/run.ts"),
				"utf-8",
			);

			// run command should call executeRun without checkInterval
			// It should NOT contain checkInterval: true
			expect(sourceFile).not.toContain("checkInterval: true");
		});

		it("stop-hook should pass checkInterval: true (source verification)", () => {
			const sourceFile = readFileSync(
				join(process.cwd(), "src/commands/stop-hook.ts"),
				"utf-8",
			);

			// stop-hook should call executeRun with checkInterval: true
			expect(sourceFile).toContain("checkInterval: true");
		});
	});
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRUSTED_SNAPSHOT_DOCS_URL } from "../../src/core/trusted-message.js";
import { isSuccessStatus } from "../../src/types/validator-status.js";
import { getStatusMessage } from "../../src/core/run-executor-helpers.js";

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
			expect(sourceFile).toContain("mode: 'interactive'");
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

describe("run-executor auto-clean on retry_limit_exceeded", () => {
	it("should auto-clean logs when status is retry_limit_exceeded", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor-helpers.ts"),
			"utf-8",
		);

		// The auto-clean block should include retry_limit_exceeded
		// Find the section after status determination that calls cleanLogs
		expect(sourceFile).toMatch(
			/status\s*===\s*'retry_limit_exceeded'[\s\S]*?cleanLogs/,
		);
	});

	it("should not delete execution state on retry_limit_exceeded", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor-helpers.ts"),
			"utf-8",
		);

		// The retry_limit_exceeded path should NOT call deleteExecutionState
		// Find the auto-clean block and verify it only calls cleanLogs
		const retryLimitBlock = sourceFile.match(
			/retry_limit_exceeded[\s\S]*?cleanLogs\([^)]+\)/,
		);
		expect(retryLimitBlock).not.toBeNull();
		// The same block should not reference deleteExecutionState
		if (retryLimitBlock) {
			expect(retryLimitBlock[0]).not.toContain("deleteExecutionState");
		}
	});

	it("status message for retry_limit_exceeded should not mention manual clean", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor-helpers.ts"),
			"utf-8",
		);

		// The status message should say logs are automatically archived
		expect(sourceFile).not.toMatch(
			/retry_limit_exceeded[\s\S]*?agent-validator clean/,
		);
	});

	it("should pass max_previous_logs to cleanLogs on passed status", () => {
		const sourceFile = readFileSync(
			join(process.cwd(), "src/core/run-executor-helpers.ts"),
			"utf-8",
		);

		// The "passed" auto-clean should pass max_previous_logs
		expect(sourceFile).toMatch(
			/status\s*===\s*'passed'[\s\S]*?cleanLogs\([\s\S]*?config\.project\.max_previous_logs/,
		);
	});
});

describe("trusted status", () => {
	it("treats trusted as success-equivalent", () => {
		expect(isSuccessStatus("trusted")).toBe(true);
	});

	it("includes the trusted snapshot explanation link in status messages", () => {
		expect(getStatusMessage("trusted")).toContain(TRUSTED_SNAPSHOT_DOCS_URL);
	});
});

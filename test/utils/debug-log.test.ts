import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	DebugLogger,
	getDebugLogFilename,
	mergeDebugLogConfig,
} from "../../src/utils/debug-log.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-debug-log");

describe("DebugLogger", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	describe("getDebugLogFilename", () => {
		it("returns the correct filename with dot prefix", () => {
			expect(getDebugLogFilename()).toBe(".debug.log");
		});
	});

	describe("mergeDebugLogConfig", () => {
		it("returns disabled config when both are undefined", () => {
			const result = mergeDebugLogConfig(undefined, undefined);
			expect(result.enabled).toBe(false);
			expect(result.maxSizeMb).toBe(10);
		});

		it("uses project config when provided", () => {
			const project = { enabled: true, max_size_mb: 5 };
			const result = mergeDebugLogConfig(project, undefined);
			expect(result.enabled).toBe(true);
			expect(result.maxSizeMb).toBe(5);
		});

		it("uses global config when project is undefined", () => {
			const global = { enabled: true, max_size_mb: 20 };
			const result = mergeDebugLogConfig(undefined, global);
			expect(result.enabled).toBe(true);
			expect(result.maxSizeMb).toBe(20);
		});

		it("project config takes precedence over global", () => {
			const project = { enabled: false, max_size_mb: 5 };
			const global = { enabled: true, max_size_mb: 20 };
			const result = mergeDebugLogConfig(project, global);
			expect(result.enabled).toBe(false);
			expect(result.maxSizeMb).toBe(5);
		});
	});

	describe("logging methods", () => {
		it("does not write when disabled", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: false,
				maxSizeMb: 10,
			});
			await logger.logCommand("run", ["-b", "main"]);

			const files = await fs.readdir(TEST_DIR);
			expect(files).not.toContain(".debug.log");
		});

		it("writes log entries when enabled", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logCommand("run", ["-b", "main"]);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("COMMAND run -b main");
		});

		it("writes RUN_START entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunStart("full", 5, 3);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("RUN_START mode=full changes=5 gates=3");
		});

		it("writes RUN_START with diff stats - branch ref", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunStartWithDiff("full", {
				baseRef: "origin/main",
				total: 10,
				newFiles: 3,
				modifiedFiles: 5,
				deletedFiles: 2,
				linesAdded: 150,
				linesRemoved: 30,
			}, 4);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("RUN_START mode=full");
			expect(content).toContain("base_ref=origin/main");
			expect(content).toContain("files_changed=10");
			expect(content).toContain("files_new=3");
			expect(content).toContain("files_modified=5");
			expect(content).toContain("files_deleted=2");
			expect(content).toContain("lines_added=150");
			expect(content).toContain("lines_removed=30");
			expect(content).toContain("gates=4");
		});

		it("writes RUN_START with diff stats - commit SHA", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunStartWithDiff("verification", {
				baseRef: "abc123def456",
				total: 2,
				newFiles: 1,
				modifiedFiles: 1,
				deletedFiles: 0,
				linesAdded: 25,
				linesRemoved: 10,
			}, 1);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("mode=verification");
			expect(content).toContain("base_ref=abc123def456");
		});

		it("writes RUN_START with diff stats - uncommitted", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunStartWithDiff("full", {
				baseRef: "uncommitted",
				total: 1,
				newFiles: 1,
				modifiedFiles: 0,
				deletedFiles: 0,
				linesAdded: 50,
				linesRemoved: 0,
			}, 2);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("base_ref=uncommitted");
		});

		it("writes RUN_START with diff stats - worktree ref", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunStartWithDiff("verification", {
				baseRef: "WORKTREE-abc123",
				total: 3,
				newFiles: 0,
				modifiedFiles: 3,
				deletedFiles: 0,
				linesAdded: 20,
				linesRemoved: 15,
			}, 1);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("base_ref=WORKTREE-abc123");
		});

		it("writes RUN_END entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logRunEnd("pass", 2, 1, 0, 1);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain(
				"RUN_END status=pass fixed=2 skipped=1 failed=0 iterations=1",
			);
		});

		it("writes GATE_RESULT entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logGateResult("check:src:lint", "pass", 1234, 0);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("GATE_RESULT check:src:lint status=pass");
			expect(content).toContain("duration=");
			expect(content).toContain("violations=0");
		});

		it("writes CLEAN entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logClean("auto", "all_passed");

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("CLEAN type=auto reason=all_passed");
		});

		it("writes STOP_HOOK entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logStopHook("allow", "passed");

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			expect(content).toContain("STOP_HOOK decision=allow reason=passed");
		});

		it("includes timestamp in log entries", async () => {
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 10,
			});
			await logger.logCommand("test", []);

			const logPath = path.join(TEST_DIR, ".debug.log");
			const content = await fs.readFile(logPath, "utf-8");
			// Should have ISO timestamp format
			expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});
	});

	describe("log rotation", () => {
		it("rotates log when size exceeds max", async () => {
			// Create a log file that exceeds the size limit
			const logPath = path.join(TEST_DIR, ".debug.log");
			const largeContent = "x".repeat(100);
			await fs.writeFile(logPath, largeContent);

			// Create a logger with small max size (less than current content)
			const logger = new DebugLogger(TEST_DIR, {
				enabled: true,
				maxSizeMb: 0.00001, // ~10 bytes - much smaller than our 100 byte file
			});

			// Write another entry - this should trigger rotation first
			await logger.logCommand("run", ["test"]);

			const files = await fs.readdir(TEST_DIR);
			// Should have both .debug.log (new) and .debug.log.1 (rotated)
			expect(files).toContain(".debug.log");
			expect(files).toContain(".debug.log.1");

			// Backup should contain the original content
			const backupContent = await fs.readFile(
				path.join(TEST_DIR, ".debug.log.1"),
				"utf-8",
			);
			expect(backupContent).toBe(largeContent);
		});
	});
});

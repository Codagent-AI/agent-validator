import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	hasFailedRunLogs,
	checkRunInterval,
} from "../../src/hooks/stop-hook-state.js";

describe("stop-hook-state", () => {
	const testLogDir = path.join(process.cwd(), `test-state-${Date.now()}`);

	beforeEach(async () => {
		await fs.mkdir(testLogDir, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(testLogDir, { recursive: true, force: true });
	});

	describe("hasFailedRunLogs()", () => {
		it("returns false when log dir is empty", async () => {
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});

		it("returns false when log dir does not exist", async () => {
			expect(await hasFailedRunLogs("/nonexistent/dir")).toBe(false);
		});

		it("returns true when .log files exist", async () => {
			await fs.writeFile(path.join(testLogDir, "check_lint.1.log"), "fail");
			expect(await hasFailedRunLogs(testLogDir)).toBe(true);
		});

		it("returns true when .json files exist (review results)", async () => {
			await fs.writeFile(path.join(testLogDir, "review_quality.1.json"), "{}");
			expect(await hasFailedRunLogs(testLogDir)).toBe(true);
		});

		it("ignores dot-files like .execution_state and .debug.log", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".execution_state"),
				"{}",
			);
			await fs.writeFile(
				path.join(testLogDir, ".debug.log"),
				"log",
			);
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});

		it("ignores console.* files", async () => {
			await fs.writeFile(
				path.join(testLogDir, "console.1.log"),
				"output",
			);
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});

		it("ignores the 'previous' directory", async () => {
			await fs.mkdir(path.join(testLogDir, "previous"), { recursive: true });
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});
	});

	describe("checkRunInterval()", () => {
		it("returns true (should run) when no execution state exists", async () => {
			expect(await checkRunInterval(testLogDir, 5)).toBe(true);
		});

		it("returns true when interval has elapsed", async () => {
			const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
			await fs.writeFile(
				path.join(testLogDir, ".execution_state"),
				JSON.stringify({
					last_run_completed_at: oldTime.toISOString(),
					branch: "main",
					commit: "abc123",
				}),
			);
			expect(await checkRunInterval(testLogDir, 5)).toBe(true);
		});

		it("returns false when interval has not elapsed", async () => {
			const recentTime = new Date(); // just now
			await fs.writeFile(
				path.join(testLogDir, ".execution_state"),
				JSON.stringify({
					last_run_completed_at: recentTime.toISOString(),
					branch: "main",
					commit: "abc123",
				}),
			);
			expect(await checkRunInterval(testLogDir, 5)).toBe(false);
		});

		it("returns true when interval is 0 (always run)", async () => {
			const recentTime = new Date();
			await fs.writeFile(
				path.join(testLogDir, ".execution_state"),
				JSON.stringify({
					last_run_completed_at: recentTime.toISOString(),
					branch: "main",
					commit: "abc123",
				}),
			);
			expect(await checkRunInterval(testLogDir, 0)).toBe(true);
		});

		it("returns true for corrupted state file", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".execution_state"),
				"not json",
			);
			expect(await checkRunInterval(testLogDir, 5)).toBe(true);
		});
	});
});

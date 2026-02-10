import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	checkRunInterval,
	hasFailedRunLogs,
} from "../../src/hooks/stop-hook-state.js";

describe("stop-hook-state", () => {
	let testLogDir: string;

	beforeEach(async () => {
		testLogDir = await fs.mkdtemp(path.join(os.tmpdir(), "gauntlet-state-"));
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
			await fs.writeFile(path.join(testLogDir, ".execution_state"), "{}");
			await fs.writeFile(path.join(testLogDir, ".debug.log"), "log");
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});

		it("ignores console.* files", async () => {
			await fs.writeFile(path.join(testLogDir, "console.1.log"), "output");
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});

		it("ignores the 'previous' directory", async () => {
			await fs.mkdir(path.join(testLogDir, "previous"), { recursive: true });
			expect(await hasFailedRunLogs(testLogDir)).toBe(false);
		});
	});

	describe("checkRunInterval()", () => {
		async function seedExecutionState(
			logDir: string,
			ageMs: number,
		): Promise<void> {
			const timestamp = new Date(Date.now() - ageMs);
			await fs.writeFile(
				path.join(logDir, ".execution_state"),
				JSON.stringify({
					last_run_completed_at: timestamp.toISOString(),
					branch: "main",
					commit: "abc123",
				}),
			);
		}

		it("returns true (should run) when no execution state exists", async () => {
			expect(await checkRunInterval(testLogDir, 5)).toBe(true);
		});

		it.each([
			{
				label: "returns true when interval has elapsed",
				ageMs: 10 * 60 * 1000,
				intervalMin: 5,
				expected: true,
			},
			{
				label: "returns false when interval has not elapsed",
				ageMs: 0,
				intervalMin: 5,
				expected: false,
			},
			{
				label: "returns true when interval is 0 (always run)",
				ageMs: 0,
				intervalMin: 0,
				expected: true,
			},
		])("$label", async ({ ageMs, intervalMin, expected }) => {
			await seedExecutionState(testLogDir, ageMs);
			expect(await checkRunInterval(testLogDir, intervalMin)).toBe(expected);
		});

		it("returns true for corrupted state file", async () => {
			await fs.writeFile(path.join(testLogDir, ".execution_state"), "not json");
			expect(await checkRunInterval(testLogDir, 5)).toBe(true);
		});
	});
});

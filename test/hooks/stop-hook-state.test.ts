import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	LOOP_THRESHOLD,
	LOOP_WINDOW_MS,
	checkRunInterval,
	hasFailedRunLogs,
	readBlockTimestamps,
	recordBlockTimestamp,
	resetBlockTimestamps,
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

	describe("readBlockTimestamps()", () => {
		it("returns empty array when file does not exist", async () => {
			expect(await readBlockTimestamps(testLogDir)).toEqual([]);
		});

		it("returns empty array for non-existent directory", async () => {
			expect(await readBlockTimestamps("/nonexistent/dir")).toEqual([]);
		});

		it("returns empty array for corrupt file", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				"not json",
			);
			expect(await readBlockTimestamps(testLogDir)).toEqual([]);
		});

		it("returns empty array when file contains non-array JSON", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify({ ts: 123 }),
			);
			expect(await readBlockTimestamps(testLogDir)).toEqual([]);
		});

		it("returns valid timestamps from file", async () => {
			const timestamps = [1707753600000, 1707753605000];
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify(timestamps),
			);
			expect(await readBlockTimestamps(testLogDir)).toEqual(timestamps);
		});

		it("filters out non-number entries", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify([1707753600000, "bad", null, 1707753605000]),
			);
			expect(await readBlockTimestamps(testLogDir)).toEqual([
				1707753600000, 1707753605000,
			]);
		});
	});

	describe("recordBlockTimestamp()", () => {
		it("creates file with single timestamp on first block", async () => {
			const before = Date.now();
			const result = await recordBlockTimestamp(testLogDir);
			const after = Date.now();

			expect(result).toHaveLength(1);
			expect(result[0]).toBeGreaterThanOrEqual(before);
			expect(result[0]).toBeLessThanOrEqual(after);
		});

		it("appends timestamp to existing recent entries", async () => {
			const recent = Date.now() - 10_000; // 10s ago
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify([recent]),
			);

			const result = await recordBlockTimestamp(testLogDir);
			expect(result).toHaveLength(2);
			expect(result[0]).toBe(recent);
		});

		it("prunes timestamps outside the window", async () => {
			const old = Date.now() - LOOP_WINDOW_MS - 1000; // outside window
			const recent = Date.now() - 5000; // inside window
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify([old, recent]),
			);

			const result = await recordBlockTimestamp(testLogDir);
			expect(result).toHaveLength(2); // recent + new
			expect(result[0]).toBe(recent);
		});

		it("reaches threshold after multiple rapid blocks", async () => {
			for (let i = 0; i < LOOP_THRESHOLD; i++) {
				await recordBlockTimestamp(testLogDir);
			}
			const timestamps = await readBlockTimestamps(testLogDir);
			expect(timestamps.length).toBeGreaterThanOrEqual(LOOP_THRESHOLD);
		});
	});

	describe("resetBlockTimestamps()", () => {
		it("deletes the timestamps file when it exists", async () => {
			await fs.writeFile(
				path.join(testLogDir, ".block-timestamps"),
				JSON.stringify([Date.now()]),
			);

			await resetBlockTimestamps(testLogDir);

			const exists = await fs
				.stat(path.join(testLogDir, ".block-timestamps"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("does not throw when file does not exist", async () => {
			// Should not throw
			await resetBlockTimestamps(testLogDir);
		});

		it("does not throw for non-existent directory", async () => {
			// Should not throw
			await resetBlockTimestamps("/nonexistent/dir");
		});
	});

	describe("loop detection constants", () => {
		it("LOOP_WINDOW_MS is 60 seconds", () => {
			expect(LOOP_WINDOW_MS).toBe(60_000);
		});

		it("LOOP_THRESHOLD is 3", () => {
			expect(LOOP_THRESHOLD).toBe(3);
		});
	});
});

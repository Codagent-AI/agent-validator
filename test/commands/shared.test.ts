import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
	acquireLock,
	cleanLogs,
	getLockFilename,
	hasExistingLogs,
	performAutoClean,
	releaseLock,
	shouldAutoClean,
} from "../../src/commands/shared.js";
import {
	getCurrentBranch,
	getExecutionStateFilename,
	writeExecutionState,
} from "../../src/utils/execution-state.js";

const TEST_DIR = path.join(import.meta.dir, "../../.test-shared");

describe("Lock file", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("acquireLock creates lock file when absent", async () => {
		await acquireLock(TEST_DIR);
		const lockPath = path.join(TEST_DIR, ".gauntlet-run.lock");
		const stat = await fs.stat(lockPath);
		expect(stat.isFile()).toBe(true);
		await releaseLock(TEST_DIR);
	});

	it("acquireLock creates logDir if missing", async () => {
		const subDir = path.join(TEST_DIR, "sub", "dir");
		await acquireLock(subDir);
		const lockPath = path.join(subDir, ".gauntlet-run.lock");
		const stat = await fs.stat(lockPath);
		expect(stat.isFile()).toBe(true);
		await releaseLock(subDir);
	});

	it("releaseLock removes lock file", async () => {
		await acquireLock(TEST_DIR);
		await releaseLock(TEST_DIR);
		const lockPath = path.join(TEST_DIR, ".gauntlet-run.lock");
		try {
			await fs.stat(lockPath);
			expect(true).toBe(false); // should not reach
		} catch (e: unknown) {
			expect((e as { code: string }).code).toBe("ENOENT");
		}
	});

	it("releaseLock is no-op when lock missing", async () => {
		// Should not throw
		await releaseLock(TEST_DIR);
	});
});

describe("hasExistingLogs", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("returns false for empty directory", async () => {
		expect(await hasExistingLogs(TEST_DIR)).toBe(false);
	});

	it("returns false for non-existent directory", async () => {
		expect(await hasExistingLogs(path.join(TEST_DIR, "nope"))).toBe(false);
	});

	it("returns true when .log files exist", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");
		expect(await hasExistingLogs(TEST_DIR)).toBe(true);
	});

	it("ignores previous/ directory", async () => {
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "content");
		expect(await hasExistingLogs(TEST_DIR)).toBe(false);
	});
});

describe("cleanLogs", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("moves .log files to previous/", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "a");
		await fs.writeFile(path.join(TEST_DIR, "review_src.2.log"), "b");

		await cleanLogs(TEST_DIR);

		const rootFiles = await fs.readdir(TEST_DIR);
		expect(rootFiles.filter((f) => f.endsWith(".log"))).toEqual([]);

		const previousFiles = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(previousFiles.sort()).toEqual([
			"check_src.1.log",
			"review_src.2.log",
		]);
	});

	it("clears existing previous/ before moving", async () => {
		const prevDir = path.join(TEST_DIR, "previous");
		await fs.mkdir(prevDir, { recursive: true });
		await fs.writeFile(path.join(prevDir, "old.log"), "old");
		await fs.writeFile(path.join(TEST_DIR, "new.1.log"), "new");

		await cleanLogs(TEST_DIR);

		const previousFiles = await fs.readdir(prevDir);
		expect(previousFiles).toEqual(["new.1.log"]);
	});

	it("handles missing logDir gracefully", async () => {
		await cleanLogs(path.join(TEST_DIR, "nonexistent"));
		// Should not throw
	});

	it("creates previous/ if it does not exist", async () => {
		await fs.writeFile(path.join(TEST_DIR, "test.1.log"), "x");
		await cleanLogs(TEST_DIR);
		const stat = await fs.stat(path.join(TEST_DIR, "previous"));
		expect(stat.isDirectory()).toBe(true);
	});

	it("does nothing when no current logs to archive (clean command guard)", async () => {
		// Create previous/ with old logs but no current logs
		const prevDir = path.join(TEST_DIR, "previous");
		await fs.mkdir(prevDir, { recursive: true });
		await fs.writeFile(path.join(prevDir, "old.log"), "old content");

		await cleanLogs(TEST_DIR);

		// previous/ should still contain old.log
		const previousFiles = await fs.readdir(prevDir);
		expect(previousFiles).toEqual(["old.log"]);
	});

	it("does nothing when log directory does not exist (clean command guard)", async () => {
		const nonExistentDir = path.join(TEST_DIR, "does-not-exist");
		await cleanLogs(nonExistentDir);

		// Directory should not be created
		const exists = await fs
			.stat(nonExistentDir)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});

	it("preserves .execution_state in root during clean", async () => {
		// Create a log file and execution state
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "log content");
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				branch: "test",
				commit: "abc",
				last_run_completed_at: new Date().toISOString(),
			}),
		);

		await cleanLogs(TEST_DIR);

		// Execution state should remain in root (not moved to previous/)
		const rootFiles = await fs.readdir(TEST_DIR);
		expect(rootFiles).toContain(getExecutionStateFilename());
		expect(rootFiles).not.toContain("check.1.log");

		// Logs should be in previous/
		const previousFiles = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(previousFiles).not.toContain(getExecutionStateFilename());
		expect(previousFiles).toContain("check.1.log");
	});
});

describe("cleanLogs rotation", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("rotates with maxPreviousLogs=3: evicts oldest, shifts, creates new previous/", async () => {
		// Setup: previous/, previous.1/, previous.2/ all exist
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "run-a.log"), "a");
		await fs.mkdir(path.join(TEST_DIR, "previous.1"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous.1", "run-b.log"), "b");
		await fs.mkdir(path.join(TEST_DIR, "previous.2"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous.2", "run-c.log"), "c");
		// Current logs
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "current");

		await cleanLogs(TEST_DIR, 3);

		// previous.2/ should have what was in previous.1/
		const prev2 = await fs.readdir(path.join(TEST_DIR, "previous.2"));
		expect(prev2).toEqual(["run-b.log"]);
		// previous.1/ should have what was in previous/
		const prev1 = await fs.readdir(path.join(TEST_DIR, "previous.1"));
		expect(prev1).toEqual(["run-a.log"]);
		// previous/ should have current logs
		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
		// Root should have no log files
		const root = await fs.readdir(TEST_DIR);
		expect(root.filter((f) => f.endsWith(".log") && !f.startsWith("."))).toEqual([]);
	});

	it("maxPreviousLogs=0: deletes current logs, no archiving", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "content");

		await cleanLogs(TEST_DIR, 0);

		const files = await fs.readdir(TEST_DIR);
		expect(files.filter((f) => f.endsWith(".log"))).toEqual([]);
		// No previous/ directory created
		expect(files).not.toContain("previous");
	});

	it("maxPreviousLogs=1: single previous/ directory (pre-existing behavior)", async () => {
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "old");
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "new");

		await cleanLogs(TEST_DIR, 1);

		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});

	it("skips missing intermediate directories without error", async () => {
		// previous/ exists but previous.1/ does NOT
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "run-a.log"), "a");
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "current");

		await cleanLogs(TEST_DIR, 3);

		// previous.1/ should have what was in previous/
		const prev1 = await fs.readdir(path.join(TEST_DIR, "previous.1"));
		expect(prev1).toEqual(["run-a.log"]);
		// previous/ should have current logs
		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});

	it("backward compatible: cleanLogs without maxPreviousLogs defaults to 3", async () => {
		await fs.writeFile(path.join(TEST_DIR, "check.1.log"), "content");

		// Call without the second argument — should default to 3
		await cleanLogs(TEST_DIR);

		const prev = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(prev).toEqual(["check.1.log"]);
	});
});

describe("getLockFilename", () => {
	it("returns the correct lock filename", () => {
		expect(getLockFilename()).toBe(".gauntlet-run.lock");
	});
});

describe("shouldAutoClean", () => {
	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("returns clean: false when no state file exists", async () => {
		const result = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(result.clean).toBe(false);
	});

	it("returns clean: false when directory does not exist", async () => {
		const result = await shouldAutoClean(
			path.join(TEST_DIR, "nonexistent"),
			"origin/main",
		);
		expect(result.clean).toBe(false);
	});

	it("returns clean: true with reason when branch changed", async () => {
		// Create state file with a different branch
		const state = {
			last_run_completed_at: new Date().toISOString(),
			branch: "different-branch-that-does-not-exist",
			commit: "abc123",
		};
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify(state),
		);

		const result = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(result.clean).toBe(true);
		expect(result.reason).toBe("branch changed");
	});

	// Note: Testing "commit merged" scenario requires a real git repository
	// with specific commit history, which is harder to set up in unit tests.
	// Integration tests would be more appropriate for that scenario.
});

describe("auto-clean during rerun mode", () => {
	// This documents the interaction between hasExistingLogs and shouldAutoClean.
	// The actual skip logic is in run.ts/check.ts/review.ts:
	//   if (!logsExist) { await shouldAutoClean(...) }
	// These tests verify the primitives work correctly for that pattern.

	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("hasExistingLogs returns true when logs exist (rerun mode)", async () => {
		// Setup: existing logs from a previous run
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");

		// Verify hasExistingLogs detects rerun mode
		const logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(true);

		// In this case, commands should skip shouldAutoClean entirely
		// (the actual skip is in run.ts/check.ts/review.ts)
	});

	it("hasExistingLogs returns false after clean (fresh start)", async () => {
		// Setup: logs were cleaned, only previous/ has content
		await fs.mkdir(path.join(TEST_DIR, "previous"), { recursive: true });
		await fs.writeFile(path.join(TEST_DIR, "previous", "old.log"), "old");

		// Verify hasExistingLogs detects fresh start
		const logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(false);

		// In this case, commands would call shouldAutoClean
		// (but since we just cleaned, shouldAutoClean would likely return false)
	});

	it("both functions work together to prevent auto-clean during reruns", async () => {
		// This test documents the expected pattern used in run/check/review commands

		// Scenario 1: Fresh start with stale state file
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: "different-branch-that-does-not-exist",
				commit: "abc123",
			}),
		);

		let logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(false); // No logs = fresh start

		const autoClean = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(autoClean.clean).toBe(true); // Would trigger auto-clean

		// Scenario 2: After first run creates logs (rerun mode)
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");

		logsExist = await hasExistingLogs(TEST_DIR);
		expect(logsExist).toBe(true); // Logs exist = rerun mode

		// In rerun mode, shouldAutoClean should NOT be called
		// (the skip logic is in the command files, not here)
		// This test just verifies hasExistingLogs correctly detects the state
	});
});

describe("auto-clean workflow integration", () => {
	// Tests for the fix: auto-clean runs regardless of existing logs.
	// Previously, shouldAutoClean was gated behind !logsExist, so it never
	// ran when logs existed. The fix calls shouldAutoClean unconditionally.
	// These tests verify the correct behavioral sequence.

	beforeEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	});

	it("shouldAutoClean detects branch change even when logs exist", async () => {
		// Setup: log files exist AND stale execution state (different branch)
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: "different-branch-that-does-not-exist",
				commit: "abc123",
			}),
		);

		// Verify logs exist (old code would have skipped auto-clean here)
		expect(await hasExistingLogs(TEST_DIR)).toBe(true);

		// shouldAutoClean should still detect the branch change
		const result = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(result.clean).toBe(true);
		expect(result.reason).toBe("branch changed");
	});

	it("full auto-clean workflow: logs exist + branch changed → clean + fresh start", async () => {
		// Setup: log files + stale state (different branch)
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");
		await fs.writeFile(path.join(TEST_DIR, "review_src.2.json"), "{}");
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: "different-branch-that-does-not-exist",
				commit: "abc123",
			}),
		);

		// Step 1: shouldAutoClean detects context change
		const autoClean = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(autoClean.clean).toBe(true);

		// Step 2: performAutoClean archives logs and resets state
		await performAutoClean(TEST_DIR, autoClean);

		// Step 3: hasExistingLogs returns false (fresh start)
		expect(await hasExistingLogs(TEST_DIR)).toBe(false);

		// Logs should be archived in previous/
		const previousFiles = await fs.readdir(path.join(TEST_DIR, "previous"));
		expect(previousFiles).toContain("check_src.1.log");
		expect(previousFiles).toContain("review_src.2.json");
	});

	it("full auto-clean workflow: logs exist + same branch → no clean, rerun mode", async () => {
		// Write a mock execution state with the current branch but a dummy commit
		// that cannot be found in origin/main (avoids "commit merged" false positive).
		const currentBranch = await getCurrentBranch();
		await fs.writeFile(
			path.join(TEST_DIR, getExecutionStateFilename()),
			JSON.stringify({
				last_run_completed_at: new Date().toISOString(),
				branch: currentBranch,
				commit: "0000000000000000000000000000000000000000",
			}),
		);

		// Add log files (simulating a previous run)
		await fs.writeFile(path.join(TEST_DIR, "check_src.1.log"), "content");

		// Step 1: shouldAutoClean returns false (same branch)
		const autoClean = await shouldAutoClean(TEST_DIR, "origin/main");
		expect(autoClean.clean).toBe(false);

		// Step 2: hasExistingLogs returns true (rerun mode preserved)
		expect(await hasExistingLogs(TEST_DIR)).toBe(true);
	});
});

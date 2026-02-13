import fs from "node:fs/promises";
import path from "node:path";
import {
	createWorkingTreeRef,
	readExecutionState,
} from "../utils/execution-state.js";

/** Window in milliseconds to detect rapid-fire blocks */
export const LOOP_WINDOW_MS = 60_000;

/** Number of blocks within the window to trigger loop detection */
export const LOOP_THRESHOLD = 3;

/** Filename for storing block timestamps */
const BLOCK_TIMESTAMPS_FILE = ".block-timestamps";

/** Lock file for atomic timestamp updates */
const BLOCK_TIMESTAMPS_LOCK = ".block-timestamps.lock";

/** Max time to wait for lock acquisition (ms) */
const LOCK_TIMEOUT_MS = 2000;

/** Retry interval when waiting for lock (ms) */
const LOCK_RETRY_MS = 50;

/**
 * Acquire a file-based lock using exclusive create (wx flag).
 * Returns a release function. Throws if lock cannot be acquired within timeout.
 */
async function acquireTimestampLock(
	logDir: string,
): Promise<() => Promise<void>> {
	const lockPath = path.join(logDir, BLOCK_TIMESTAMPS_LOCK);
	const deadline = Date.now() + LOCK_TIMEOUT_MS;

	while (Date.now() < deadline) {
		try {
			const handle = await fs.open(lockPath, "wx");
			await handle.close();
			return async () => {
				await fs.rm(lockPath, { force: true }).catch(() => {});
			};
		} catch (err: unknown) {
			const code = (err as { code?: string }).code;
			if (code !== "EEXIST") throw err;
			// Lock held by another process — wait and retry
			await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
		}
	}
	// Timeout: another process may legitimately hold the lock — throw
	// so the caller can proceed with the original result safely.
	throw new Error("Could not acquire block-timestamps lock within timeout");
}

/**
 * Check if the log directory contains gate result files (indicating a
 * failed or in-progress run that hasn't been archived).
 *
 * Reuses the same detection logic as `hasExistingLogs()` in shared.ts —
 * looks for .log and .json files, ignoring dot-files, console.* files,
 * and the "previous" directory.
 */
export async function hasFailedRunLogs(logDir: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(logDir);
		return entries.some(
			(f) =>
				(f.endsWith(".log") || f.endsWith(".json")) &&
				f !== "previous" &&
				!f.startsWith("console.") &&
				!f.startsWith("."),
		);
	} catch {
		return false;
	}
}

/**
 * Check if the working tree has changed since the last passing run.
 *
 * Reads the stored `working_tree_ref` from `.execution_state`, creates
 * a new working tree ref via `git stash create`, and compares.
 * Returns true if changes exist (refs differ), false if identical.
 * Returns null if no execution state exists (caller should fall back).
 */
export async function hasChangesSinceLastRun(
	logDir: string,
): Promise<boolean | null> {
	const state = await readExecutionState(logDir);
	if (!state?.working_tree_ref) {
		return null; // No execution state — caller should use fallback
	}

	try {
		const currentRef = await createWorkingTreeRef();
		return currentRef !== state.working_tree_ref;
	} catch {
		// If git fails, assume changes exist so the caller can block safely
		return true;
	}
}

/**
 * Check if the run interval has elapsed since the last gauntlet run.
 * Returns true if the interval has elapsed (should run/block).
 * Returns true if no execution state exists or state is corrupted.
 * Returns true if intervalMinutes is 0 (always run).
 */
export async function checkRunInterval(
	logDir: string,
	intervalMinutes: number,
): Promise<boolean> {
	if (intervalMinutes <= 0) return true;

	const state = await readExecutionState(logDir);
	if (!state) return true;

	const lastRun = new Date(state.last_run_completed_at);
	if (Number.isNaN(lastRun.getTime())) return true;

	const elapsedMinutes = (Date.now() - lastRun.getTime()) / (1000 * 60);
	return elapsedMinutes >= intervalMinutes;
}

/**
 * Check if changes exist vs the base branch.
 * Used as fallback when no execution state exists.
 * Uses `git diff --name-only <baseBranch>...HEAD` to detect changes.
 */
export async function hasChangesVsBaseBranch(
	cwd: string,
	baseBranch: string,
): Promise<boolean> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	try {
		const { stdout } = await execFileAsync(
			"git",
			["diff", "--name-only", `${baseBranch}...HEAD`],
			{ cwd },
		);
		return stdout.trim().length > 0;
	} catch {
		// If the base branch doesn't exist or git fails, assume changes exist
		return true;
	}
}

/**
 * Get the last run status from execution state.
 * Returns the status string if determinable, null otherwise.
 */
export async function getLastRunStatus(logDir: string): Promise<string | null> {
	const state = await readExecutionState(logDir);
	if (!state) return null;
	// ExecutionState has no status field yet — return null until schema is extended
	return null;
}

/**
 * Read block timestamps from the timestamps file.
 * Returns an empty array if the file is missing or corrupt.
 */
export async function readBlockTimestamps(logDir: string): Promise<number[]> {
	try {
		const filePath = path.join(logDir, BLOCK_TIMESTAMPS_FILE);
		const content = await fs.readFile(filePath, "utf-8");
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((ts): ts is number => typeof ts === "number");
	} catch {
		return [];
	}
}

/**
 * Record a block timestamp: read existing timestamps, filter to the
 * detection window, append the current time, and write back.
 * Uses a file-based lock for atomicity under concurrent invocations.
 * Returns the updated (filtered + appended) array.
 */
export async function recordBlockTimestamp(logDir: string): Promise<number[]> {
	const release = await acquireTimestampLock(logDir);
	try {
		const now = Date.now();
		const existing = await readBlockTimestamps(logDir);
		const recent = existing.filter((ts) => now - ts < LOOP_WINDOW_MS);
		recent.push(now);
		const filePath = path.join(logDir, BLOCK_TIMESTAMPS_FILE);
		await fs.writeFile(filePath, JSON.stringify(recent), "utf-8");
		return recent;
	} finally {
		await release();
	}
}

/**
 * Reset (delete) the block timestamps file.
 * Called when a non-blocking result occurs, indicating the loop is resolved.
 */
export async function resetBlockTimestamps(logDir: string): Promise<void> {
	try {
		const filePath = path.join(logDir, BLOCK_TIMESTAMPS_FILE);
		await fs.rm(filePath, { force: true });
	} catch {
		// Best-effort cleanup — ignore errors
	}
}

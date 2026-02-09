import fs from "node:fs/promises";
import {
	createWorkingTreeRef,
	readExecutionState,
} from "../utils/execution-state.js";

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

	const currentRef = await createWorkingTreeRef();
	return currentRef !== state.working_tree_ref;
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
	return "passed";
}

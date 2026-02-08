import fs from "node:fs/promises";
import path from "node:path";
import {
	getDebugLogBackupFilename,
	getDebugLogFilename,
} from "../utils/debug-log.js";
import {
	deleteExecutionState,
	getCurrentBranch,
	getExecutionStateFilename,
	gitObjectExists,
	isCommitInBranch,
	readExecutionState,
} from "../utils/execution-state.js";

const LOCK_FILENAME = ".gauntlet-run.lock";
const SESSION_REF_FILENAME = ".session_ref";

export interface AutoCleanResult {
	clean: boolean;
	reason?: string;
	resetState?: boolean;
}

/**
 * Check if logs should be auto-cleaned based on execution context changes.
 * Returns { clean: true, reason, resetState } if context has changed.
 * Returns { clean: false } if context is unchanged or state file doesn't exist.
 * When resetState is true, the execution state should be deleted (not just logs).
 */
export async function shouldAutoClean(
	logDir: string,
	baseBranch: string,
): Promise<AutoCleanResult> {
	const state = await readExecutionState(logDir);

	// No state file = no auto-clean needed
	if (!state) {
		return { clean: false };
	}

	// Check if branch changed
	try {
		const currentBranch = await getCurrentBranch();
		if (currentBranch !== state.branch) {
			return { clean: true, reason: "branch changed", resetState: true };
		}
	} catch {
		// If we can't get the current branch, don't auto-clean
		return { clean: false };
	}

	// Check if commit was merged into base branch
	try {
		const isMerged = await isCommitInBranch(state.commit, baseBranch);
		if (isMerged) {
			if (state.working_tree_ref) {
				const refValid = await gitObjectExists(state.working_tree_ref);
				if (refValid) {
					return { clean: true, reason: "commit merged", resetState: false };
				}
			}
			return { clean: true, reason: "commit merged", resetState: true };
		}
	} catch {
		// If we can't check merge status, don't auto-clean
	}

	return { clean: false };
}

/**
 * Perform auto-clean with state reset if needed.
 */
export async function performAutoClean(
	logDir: string,
	result: AutoCleanResult,
): Promise<void> {
	await cleanLogs(logDir);

	// Delete execution state if context changed (branch changed or commit merged)
	if (result.resetState) {
		await deleteExecutionState(logDir);
	}
}

/**
 * Get the lock filename constant.
 * Useful for checking lock status from other modules.
 */
export function getLockFilename(): string {
	return LOCK_FILENAME;
}

export async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function acquireLock(logDir: string): Promise<void> {
	await fs.mkdir(logDir, { recursive: true });
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
	} catch (err: unknown) {
		if (
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			(err as { code: string }).code === "EEXIST"
		) {
			console.error(
				`Error: A gauntlet run is already in progress (lock file: ${lockPath}).`,
			);
			console.error(
				"If no run is actually in progress, delete the lock file manually.",
			);
			process.exit(1);
		}
		throw err;
	}
}

export async function releaseLock(logDir: string): Promise<void> {
	const lockPath = path.resolve(logDir, LOCK_FILENAME);
	try {
		await fs.rm(lockPath, { force: true });
	} catch {
		// no-op if missing
	}
}

export async function hasExistingLogs(logDir: string): Promise<boolean> {
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
 * Get the set of persistent files that should never be moved during clean.
 */
/**
 * Marker file used by stop-hook to detect nested invocations.
 * Must match STOP_HOOK_MARKER_FILE in stop-hook.ts.
 */
const STOP_HOOK_MARKER_FILE = ".stop-hook-active";

function getPersistentFiles(): Set<string> {
	return new Set([
		getExecutionStateFilename(),
		getDebugLogFilename(),
		getDebugLogBackupFilename(),
		LOCK_FILENAME,
		SESSION_REF_FILENAME, // Will be deleted, not moved
		STOP_HOOK_MARKER_FILE, // Cleaned up by stop-hook finally block, not cleanLogs
	]);
}

/**
 * Check if there are current logs to archive.
 * Returns true if there are .log or .json files in the log directory root.
 * Excludes persistent files (.execution_state, .debug.log, etc.)
 */
async function hasCurrentLogs(logDir: string): Promise<boolean> {
	try {
		const files = await fs.readdir(logDir);
		const persistentFiles = getPersistentFiles();
		return files.some(
			(f) =>
				(f.endsWith(".log") || f.endsWith(".json")) &&
				f !== "previous" &&
				!persistentFiles.has(f),
		);
	} catch {
		return false;
	}
}

export async function cleanLogs(logDir: string, maxPreviousLogs = 3): Promise<void> {
	try {
		// Guard: Return early if log directory doesn't exist
		if (!(await exists(logDir))) {
			return;
		}

		// Guard: Return early if no current logs to archive
		if (!(await hasCurrentLogs(logDir))) {
			return;
		}

		if (maxPreviousLogs === 0) {
			// No archiving — delete current logs
			const files = await fs.readdir(logDir);
			const persistentFiles = getPersistentFiles();
			await Promise.all(
				files
					.filter((file) => !file.startsWith("previous") && !persistentFiles.has(file))
					.map((file) =>
						fs.rm(path.join(logDir, file), { recursive: true, force: true }),
					),
			);
			return;
		}

		// Logrotate-style rotation: shift from highest to lowest
		// 1. Evict the oldest (previous.{max-1}/)
		const oldestSuffix = maxPreviousLogs - 1;
		const oldestDir = oldestSuffix === 0 ? "previous" : `previous.${oldestSuffix}`;
		const oldestPath = path.join(logDir, oldestDir);
		if (await exists(oldestPath)) {
			await fs.rm(oldestPath, { recursive: true, force: true });
		}

		// 2. Shift from highest to lowest to avoid clobbering
		for (let i = oldestSuffix - 1; i >= 0; i--) {
			const fromName = i === 0 ? "previous" : `previous.${i}`;
			const toName = `previous.${i + 1}`;
			const fromPath = path.join(logDir, fromName);
			const toPath = path.join(logDir, toName);
			if (await exists(fromPath)) {
				await fs.rename(fromPath, toPath);
			}
		}

		// 3. Create fresh previous/
		const previousDir = path.join(logDir, "previous");
		await fs.mkdir(previousDir, { recursive: true });

		// 4. Move current logs into previous/
		const files = await fs.readdir(logDir);
		const persistentFiles = getPersistentFiles();

		await Promise.all(
			files
				.filter((file) => !file.startsWith("previous") && !persistentFiles.has(file))
				.map((file) =>
					fs.rename(path.join(logDir, file), path.join(previousDir, file)),
				),
		);

		// 5. Delete legacy .session_ref if it exists (migration cleanup)
		try {
			const sessionRefPath = path.join(logDir, SESSION_REF_FILENAME);
			await fs.rm(sessionRefPath, { force: true });
		} catch {
			// Ignore errors
		}
	} catch (error) {
		console.warn(
			"Failed to clean logs in",
			logDir,
			":",
			error instanceof Error ? error.message : error,
		);
	}
}

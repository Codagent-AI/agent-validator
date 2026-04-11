import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import {
  getDebugLogBackupFilename,
  getDebugLogFilename,
  getDebugLogger,
} from '../utils/debug-log.js';
import {
  deleteExecutionState,
  getCurrentBranch,
  getExecutionStateFilename,
  hasWorkingTreeChanges,
  isCommitInBranch,
  readExecutionState,
} from '../utils/execution-state.js';

const LOCK_FILENAME = '.validator-run.lock';
const SESSION_REF_FILENAME = '.session_ref';

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
      return { clean: true, reason: 'branch changed', resetState: true };
    }
  } catch {
    // If we can't get the current branch, don't auto-clean
    return { clean: false };
  }

  // Check if commit was merged into base branch.
  // Skip this check when the working tree has uncommitted changes (staged,
  // unstaged, or untracked). In that case, the execution state still holds
  // meaningful context and cleaning would destroy the retry counter and
  // narrowed diff capability.
  // Note: We use `git status --porcelain` instead of comparing working_tree_ref
  // vs commit because `git stash create --include-untracked` returns empty when
  // only untracked files exist, causing working_tree_ref to equal commit even
  // though the tree is dirty.
  const hasChanges = await hasWorkingTreeChanges();
  if (!hasChanges) {
    try {
      const isMerged = await isCommitInBranch(state.commit, baseBranch);
      if (isMerged) {
        return { clean: true, reason: 'commit merged', resetState: true };
      }
    } catch {
      // If we can't check merge status, don't auto-clean
    }
  }

  return { clean: false };
}

/**
 * Perform auto-clean with state reset if needed.
 */
export async function performAutoClean(
  logDir: string,
  result: AutoCleanResult,
  maxPreviousLogs = 3,
): Promise<void> {
  await cleanLogs(logDir, maxPreviousLogs);

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

export async function addToGitignore(
  projectRoot: string,
  entry: string,
): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');

  let content = '';
  if (await exists(gitignorePath)) {
    content = await fs.readFile(gitignorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    if (lines.includes(entry)) return;
  }

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await fs.appendFile(gitignorePath, `${suffix}${entry}\n`);
  console.log(chalk.green(`Added ${entry} to .gitignore`));
}

/**
 * Read a context file from a CLI --context-file path.
 * Exits the process with an error if the file cannot be read.
 */
export async function readContextFile(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  try {
    return await fs.readFile(resolved, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.error(`Error: context file not found: ${resolved}`);
    } else {
      console.error(
        `Error: failed to read context file: ${resolved} (${code ?? (err as Error).message})`,
      );
    }
    process.exit(1);
  }
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
    await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'EEXIST'
    ) {
      console.error(
        `Error: A validator run is already in progress (lock file: ${lockPath}).`,
      );
      console.error(
        'If no run is actually in progress, delete the lock file manually.',
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
        (f.endsWith('.log') || f.endsWith('.json')) &&
        f !== 'previous' &&
        !f.startsWith('console.') &&
        !f.startsWith('.'),
    );
  } catch {
    return false;
  }
}

/**
 * Get the set of persistent files that should never be moved during clean.
 */
function getPersistentFiles(): Set<string> {
  return new Set([
    getExecutionStateFilename(),
    getDebugLogFilename(),
    getDebugLogBackupFilename(),
    LOCK_FILENAME,
    SESSION_REF_FILENAME, // Will be deleted, not moved
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
        (f.endsWith('.log') || f.endsWith('.json')) &&
        f !== 'previous' &&
        !persistentFiles.has(f),
    );
  } catch {
    return false;
  }
}

/** Get current log files (excludes previous dirs and persistent files). */
function getCurrentLogFiles(files: string[]): string[] {
  const persistentFiles = getPersistentFiles();
  return files.filter(
    (file) => !(file.startsWith('previous') || persistentFiles.has(file)),
  );
}

/** Delete current logs without archiving (maxPreviousLogs === 0). */
async function deleteCurrentLogs(logDir: string): Promise<void> {
  const files = await fs.readdir(logDir);
  await Promise.all(
    getCurrentLogFiles(files).map((file) =>
      fs.rm(path.join(logDir, file), { recursive: true, force: true }),
    ),
  );
}

/** Rotate existing previous/ directories to make room for a new archive. */
async function rotatePreviousDirs(
  logDir: string,
  maxPreviousLogs: number,
): Promise<void> {
  const oldestSuffix = maxPreviousLogs - 1;
  const oldestDir =
    oldestSuffix === 0 ? 'previous' : `previous.${oldestSuffix}`;
  const oldestPath = path.join(logDir, oldestDir);
  if (await exists(oldestPath)) {
    await fs.rm(oldestPath, { recursive: true, force: true });
  }

  for (let i = oldestSuffix - 1; i >= 0; i--) {
    const fromName = i === 0 ? 'previous' : `previous.${i}`;
    const toName = `previous.${i + 1}`;
    const fromPath = path.join(logDir, fromName);
    const toPath = path.join(logDir, toName);
    if (await exists(fromPath)) {
      await fs.rename(fromPath, toPath);
    }
  }
}

export async function cleanLogs(
  logDir: string,
  maxPreviousLogs = 3,
): Promise<void> {
  try {
    if (!(await exists(logDir))) return;
    if (!(await hasCurrentLogs(logDir))) return;

    if (maxPreviousLogs === 0) {
      await deleteCurrentLogs(logDir);
      return;
    }

    await rotatePreviousDirs(logDir, maxPreviousLogs);

    const previousDir = path.join(logDir, 'previous');
    await fs.mkdir(previousDir, { recursive: true });

    const files = await fs.readdir(logDir);
    const toMove = getCurrentLogFiles(files);
    const kept = files.filter((f) => !toMove.includes(f));
    await getDebugLogger()?.logCleanDetails(toMove, kept);
    await Promise.all(
      toMove.map((file) =>
        fs.rename(path.join(logDir, file), path.join(previousDir, file)),
      ),
    );

    // Delete legacy .session_ref if it exists (migration cleanup)
    try {
      await fs.rm(path.join(logDir, SESSION_REF_FILENAME), { force: true });
    } catch {
      // Ignore errors
    }

    // Post-clean verification: warn if execution state was lost
    const stateFile = getExecutionStateFilename();
    const stateSurvived = await exists(path.join(logDir, stateFile));
    if (!stateSurvived && kept.includes(stateFile)) {
      console.warn(
        `BUG: ${stateFile} was in kept list but missing after clean`,
      );
      const debugLogger = getDebugLogger();
      await debugLogger?.logCleanDetails(
        ['POST_CLEAN_MISSING'],
        [`${stateFile}_WAS_KEPT_BUT_GONE`],
      );
    }
  } catch (error) {
    console.warn(
      'Failed to clean logs in',
      logDir,
      ':',
      error instanceof Error ? error.message : error,
    );
  }
}

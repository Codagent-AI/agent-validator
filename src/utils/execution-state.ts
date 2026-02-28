import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDebugLogger } from './debug-log.js';

const EXECUTION_STATE_FILENAME = '.execution_state';
const SESSION_REF_FILENAME = '.session_ref';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  // Use loose equality to check both null and undefined in one comparison
  if (value == null) return false;
  if (Array.isArray(value)) return false;
  return typeof value === 'object';
}

function extractUnhealthyAdapters(
  rawData: Record<string, unknown> | null,
): Record<string, UnhealthyAdapter> | undefined {
  const adapters = rawData?.unhealthy_adapters;
  if (!isPlainRecord(adapters)) {
    return undefined;
  }
  return adapters as Record<string, UnhealthyAdapter>;
}

export interface UnhealthyAdapter {
  marked_at: string;
  reason: string;
}

export interface ExecutionState {
  last_run_completed_at: string;
  branch: string;
  commit: string;
  working_tree_ref?: string;
  unhealthy_adapters?: Record<string, UnhealthyAdapter>;
}

/**
 * Read the execution state from the log directory.
 * Returns null if the state file or directory doesn't exist.
 */
function isValidStateData(data: unknown): data is Record<string, unknown> & {
  last_run_completed_at: string;
  branch: string;
  commit: string;
} {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.last_run_completed_at === 'string' &&
    typeof record.branch === 'string' &&
    typeof record.commit === 'string'
  );
}

export async function readExecutionState(
  logDir: string,
): Promise<ExecutionState | null> {
  try {
    const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
    const content = await fs.readFile(statePath, 'utf-8');
    const data = JSON.parse(content) as unknown;

    if (!isValidStateData(data)) return null;

    const state: ExecutionState = {
      last_run_completed_at: data.last_run_completed_at,
      branch: data.branch,
      commit: data.commit,
    };

    if (typeof data.working_tree_ref === 'string') {
      state.working_tree_ref = data.working_tree_ref;
    }

    if (
      data.unhealthy_adapters &&
      typeof data.unhealthy_adapters === 'object'
    ) {
      state.unhealthy_adapters = data.unhealthy_adapters as Record<
        string,
        UnhealthyAdapter
      >;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Create a stash SHA that captures the current working tree state.
 * Uses `git stash push --include-untracked` which creates a proper 3-parent stash,
 * then immediately pops it to restore the working tree.
 * Returns the stash SHA, or HEAD SHA if working tree is clean or on error.
 */
export async function createWorkingTreeRef(): Promise<string> {
  const hasChanges = await hasWorkingTreeChanges();
  if (!hasChanges) {
    return getCurrentCommit();
  }

  const runGit = (args: string[]) =>
    new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('git', args, (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      });
    });

  // Capture the current top-of-stash SHA before pushing, so we can detect
  // whether the push was a no-op (e.g. git decided nothing to stash).
  // If it's a no-op, stash@{0} after push equals prevStashSha — we must NOT
  // pop or we'd discard the user's unrelated stash entry.
  const prevStashSha = await runGit(['rev-parse', '--verify', 'stash@{0}'])
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);

  try {
    await runGit([
      'stash',
      'push',
      '--include-untracked',
      '-m',
      'gauntlet-snapshot',
    ]);
  } catch {
    return getCurrentCommit();
  }

  let stashSha: string;
  try {
    const { stdout } = await runGit(['rev-parse', 'stash@{0}']);
    stashSha = stdout.trim();
    // Push was a no-op — don't pop the user's pre-existing stash
    if (stashSha === prevStashSha) {
      return getCurrentCommit();
    }
  } catch {
    // If there was no pre-existing stash (prevStashSha === null) and rev-parse
    // failed, the push was a no-op — nothing was stashed, nothing to pop.
    if (prevStashSha === null) {
      return getCurrentCommit();
    }
    try {
      await runGit(['stash', 'pop']);
    } catch {
      console.error(
        'gauntlet: stash pop failed — run `git stash pop` manually to restore your working tree',
      );
    }
    return getCurrentCommit();
  }

  try {
    await runGit(['stash', 'pop']);
  } catch {
    console.error(
      'gauntlet: stash pop failed — run `git stash pop` manually to restore your working tree',
    );
  }

  return stashSha;
}

/**
 * Write the execution state to the log directory.
 * Records the current branch, commit SHA, working tree ref, and timestamp.
 * Also cleans up legacy .session_ref file if it exists.
 */
export async function writeExecutionState(logDir: string): Promise<void> {
  const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
  // createWorkingTreeRef runs first (sequentially) to avoid git index lock
  // contention between stash push/pop and the parallel rev-parse calls below.
  const workingTreeRef = await createWorkingTreeRef();
  const [branch, commit, rawState] = await Promise.all([
    getCurrentBranch(),
    getCurrentCommit(),
    readRawState(statePath),
  ]);
  const existingUnhealthy = extractUnhealthyAdapters(rawState);

  const state: ExecutionState = {
    last_run_completed_at: new Date().toISOString(),
    branch,
    commit,
    working_tree_ref: workingTreeRef,
  };

  // Preserve unhealthy_adapters from existing state
  if (existingUnhealthy) {
    state.unhealthy_adapters = existingUnhealthy;
  }

  // Log changed fields (skip last_run_completed_at since every log line is timestamped)
  const changes: Record<string, string> = {};
  const oldState = rawState as Record<string, unknown> | null;
  if (oldState) {
    if (oldState.branch !== branch) changes.branch = branch;
    if (oldState.commit !== commit) changes.commit = commit;
    if (oldState.working_tree_ref !== workingTreeRef)
      changes.working_tree_ref = workingTreeRef;
  } else {
    // First write - log all fields
    changes.branch = branch;
    changes.commit = commit;
    changes.working_tree_ref = workingTreeRef;
  }
  await getDebugLogger()?.logStateWrite(changes);

  // Ensure the log directory exists
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

  // Clean up legacy .session_ref file if it exists
  try {
    const sessionRefPath = path.join(logDir, SESSION_REF_FILENAME);
    await fs.rm(sessionRefPath, { force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Get the current git branch name.
 */
export async function getCurrentBranch(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git rev-parse failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Get the current HEAD commit SHA.
 */
export async function getCurrentCommit(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git rev-parse failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Check if a commit is an ancestor of a branch (i.e., the commit has been merged).
 * Uses `git merge-base --is-ancestor`.
 * Returns true if commit is reachable from branch.
 */
export async function isCommitInBranch(
  commit: string,
  branch: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      ['merge-base', '--is-ancestor', commit, branch],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    child.on('close', (code) => {
      // Exit 0 = is ancestor (merged), exit 1 = not ancestor
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get the execution state filename (for use in clean operations).
 */
export function getExecutionStateFilename(): string {
  return EXECUTION_STATE_FILENAME;
}

/**
 * Check if the working tree has any changes (staged, unstaged, or untracked files).
 * Uses `git status --porcelain` which correctly reports all change types,
 * unlike `git stash create --include-untracked` which returns empty for untracked-only changes.
 */
export async function hasWorkingTreeChanges(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim().length > 0);
      } else {
        // If git status fails, assume changes exist to prevent accidental state deletion
        resolve(true);
      }
    });

    child.on('error', () => {
      resolve(true);
    });
  });
}

/**
 * Check if a git object (commit, tree, blob, etc.) exists in the repository.
 * Uses `git cat-file -t <sha>` to check object type.
 */
export async function gitObjectExists(sha: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['cat-file', '-t', sha], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * When a commit has been merged, check if working_tree_ref still scopes valid changes.
 */
async function resolveFixBaseForMergedCommit(
  working_tree_ref: string | undefined,
): Promise<{ fixBase: string | null; warning?: string }> {
  if (!working_tree_ref) {
    return { fixBase: null };
  }
  const refExists = await gitObjectExists(working_tree_ref);
  if (!refExists) {
    return { fixBase: null };
  }
  return {
    fixBase: working_tree_ref,
    warning:
      'Commit merged into base branch, using working tree ref for diff scope',
  };
}

/**
 * Resolve the fixBase for change detection based on execution state.
 * Used for post-clean runs to scope diffs to changes since the last passing run.
 *
 * Returns:
 * - working_tree_ref if valid (not gc'd) and commit not merged
 * - commit as fallback if working_tree_ref is gc'd
 * - null if state is stale (commit merged) or all refs are invalid
 */
export async function resolveFixBase(
  executionState: ExecutionState,
  baseBranch: string,
): Promise<{ fixBase: string | null; warning?: string }> {
  const { commit, working_tree_ref } = executionState;

  // Check if commit has been merged into base branch (state is stale)
  const commitMerged = await isCommitInBranch(commit, baseBranch);
  if (commitMerged) {
    return resolveFixBaseForMergedCommit(working_tree_ref);
  }

  // Check if working_tree_ref exists
  if (working_tree_ref) {
    const refExists = await gitObjectExists(working_tree_ref);
    if (refExists) {
      // Use working tree ref for precise diff
      return { fixBase: working_tree_ref };
    }
  }

  // working_tree_ref doesn't exist or was gc'd, try commit as fallback
  const commitExists = await gitObjectExists(commit);
  if (commitExists) {
    return {
      fixBase: commit,
      warning: 'Session stash was garbage collected, using commit as fallback',
    };
  }

  // Everything is gone, fall back to base branch
  return { fixBase: null };
}

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if an unhealthy adapter entry is still within the cooldown period.
 * Returns true if marked_at is less than 1 hour ago.
 * Invalid or missing timestamps default to "expired" (returns false).
 */
export function isAdapterCoolingDown(entry: UnhealthyAdapter): boolean {
  const markedAt = new Date(entry.marked_at).getTime();
  if (Number.isNaN(markedAt)) return false;
  return Date.now() - markedAt < COOLDOWN_MS;
}

/**
 * Get the unhealthy adapters map from execution state.
 * Returns an empty object if no unhealthy adapters are recorded.
 */
export async function getUnhealthyAdapters(
  logDir: string,
): Promise<Record<string, UnhealthyAdapter>> {
  const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
  const rawState = await readRawState(statePath);
  return extractUnhealthyAdapters(rawState) ?? {};
}

/**
 * Read raw state data from the state file.
 * Returns null if the file doesn't exist or is invalid.
 */
async function readRawState(
  statePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Mark an adapter as unhealthy in the execution state.
 * Reads the current state, upserts the entry, and writes back.
 */
export async function markAdapterUnhealthy(
  logDir: string,
  adapterName: string,
  reason: string,
): Promise<void> {
  await getDebugLogger()?.logAdapterHealthChange(adapterName, false, reason);

  const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
  const rawData = (await readRawState(statePath)) ?? {};

  const adapters =
    (rawData.unhealthy_adapters as Record<string, UnhealthyAdapter>) ?? {};
  adapters[adapterName] = {
    marked_at: new Date().toISOString(),
    reason,
  };
  rawData.unhealthy_adapters = adapters;

  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(rawData, null, 2), 'utf-8');
}

/**
 * Mark an adapter as healthy by removing it from the unhealthy list.
 * Reads the current state, removes the entry, and writes back.
 */
export async function markAdapterHealthy(
  logDir: string,
  adapterName: string,
): Promise<void> {
  await getDebugLogger()?.logAdapterHealthChange(adapterName, true);

  const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
  const rawData = await readRawState(statePath);
  if (!rawData) return;

  const adapters = rawData.unhealthy_adapters as
    | Record<string, UnhealthyAdapter>
    | undefined;
  if (!(adapters && adapterName in adapters)) return;

  delete adapters[adapterName];
  if (Object.keys(adapters).length === 0) {
    delete rawData.unhealthy_adapters;
  } else {
    rawData.unhealthy_adapters = adapters;
  }

  await fs.writeFile(statePath, JSON.stringify(rawData, null, 2), 'utf-8');
}

/**
 * Delete the execution state file.
 * Used when auto-clean resets state due to context change.
 */
export async function deleteExecutionState(logDir: string): Promise<void> {
  try {
    await getDebugLogger()?.logStateDelete();
    const statePath = path.join(logDir, EXECUTION_STATE_FILENAME);
    await fs.rm(statePath, { force: true });
  } catch {
    // Ignore errors
  }
}

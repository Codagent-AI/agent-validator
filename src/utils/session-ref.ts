/**
 * @deprecated This module is deprecated.
 * Session reference is now stored in .execution_state as working_tree_ref.
 * See src/utils/execution-state.ts for the new implementation.
 * This file is kept for backward compatibility cleanup only.
 */

import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getCategoryLogger } from '../output/app-logger.js';

const log = getCategoryLogger('session-ref');

const SESSION_REF_FILENAME = '.session_ref';

// Exported for testing - allows injection of mock exec
export let execFn: (
  cmd: string,
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/**
 * Set the exec function (for testing)
 */
export function setExecFn(
  fn: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
): void {
  execFn = fn;
}

/**
 * Reset the exec function to the real implementation
 */
export function resetExecFn(): void {
  execFn = promisify(exec);
}

/**
 * Captures the current git state (working tree) as a commit SHA
 * and writes it to the log directory.
 * Uses `git stash create --include-untracked` to capture the state without modifying it.
 */
export async function writeSessionRef(logDir: string): Promise<void> {
  try {
    // Create a stash of the current state (including untracked files)
    // This returns a commit SHA but doesn't modify the working tree
    const { stdout } = await execFn('git stash create --include-untracked');
    let sha = stdout.trim();

    if (!sha) {
      // If no changes to stash (clean working tree), use HEAD
      const { stdout: headSha } = await execFn('git rev-parse HEAD');
      sha = headSha.trim();
    }

    // Ensure log directory exists
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(logDir, SESSION_REF_FILENAME), sha);
  } catch (error) {
    log.warn(
      `Failed to create session reference: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reads the stored session reference SHA from the log directory.
 * Returns null if the file doesn't exist.
 */
export async function readSessionRef(logDir: string): Promise<string | null> {
  try {
    const refPath = path.join(logDir, SESSION_REF_FILENAME);
    const content = await fs.readFile(refPath, 'utf-8');
    return content.trim();
  } catch {
    return null;
  }
}

/**
 * Removes the session reference file from the log directory.
 */
export async function clearSessionRef(logDir: string): Promise<void> {
  try {
    const refPath = path.join(logDir, SESSION_REF_FILENAME);
    await fs.rm(refPath, { force: true });
  } catch {
    // Ignore errors
  }
}

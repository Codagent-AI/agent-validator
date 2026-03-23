import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getCategoryLogger } from '../output/app-logger.js';

const log = getCategoryLogger('gate', 'review');

const execAsync = promisify(exec);

import { MAX_BUFFER_BYTES } from '../constants.js';
import { getStashUntrackedFiles } from '../core/diff-stats.js';

// ── Diff Utilities ──────────────────────────────────────────────────

export function parseLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function pathArg(entryPointPath: string): string {
  return ` -- ${quoteArg(entryPointPath)}`;
}

export function quoteArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

export async function execDiff(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, {
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string };
    if (typeof err.code === 'number' && err.stdout) {
      return err.stdout;
    }
    throw error;
  }
}

export async function untrackedDiff(entryPointPath: string): Promise<string> {
  const pArg = pathArg(entryPointPath);
  const { stdout } = await execAsync(
    `git ls-files --others --exclude-standard${pArg}`,
    { maxBuffer: MAX_BUFFER_BYTES },
  );
  const files = parseLines(stdout);
  const diffs: string[] = [];

  for (const file of files) {
    try {
      const diff = await execDiff(
        `git diff --no-index -- /dev/null ${quoteArg(file)}`,
      );
      if (diff.trim()) diffs.push(diff);
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };
      const msg = [err.message, err.stderr].filter(Boolean).join('\n');
      if (
        msg.includes('Could not access') ||
        msg.includes('ENOENT') ||
        msg.includes('No such file')
      ) {
        continue;
      }
      throw error;
    }
  }

  return diffs.join('\n');
}

// ── Top-level getDiff ───────────────────────────────────────────────

export async function getDiff(
  entryPointPath: string,
  baseBranch: string,
  options?: { commit?: string; uncommitted?: boolean; fixBase?: string },
): Promise<string> {
  log.debug(
    `getDiff: entryPoint=${entryPointPath}, fixBase=${options?.fixBase ?? 'none'}, uncommitted=${options?.uncommitted ?? false}, commit=${options?.commit ?? 'none'}`,
  );

  if (options?.fixBase) {
    const result = await getFixBaseDiff(entryPointPath, options.fixBase);
    if (result !== null) return result;
  }

  if (options?.uncommitted) {
    return getUncommittedDiff(entryPointPath);
  }

  if (options?.commit) {
    return getCommitDiff(entryPointPath, options.commit);
  }

  const isCI =
    process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  return isCI
    ? getCIDiff(entryPointPath, baseBranch)
    : getLocalDiff(entryPointPath, baseBranch);
}

// ── Fix-base diff ───────────────────────────────────────────────────

/** Check if a file's content has changed compared to a stash's untracked tree. */
async function hasFileChangedSinceStash(
  file: string,
  fixBase: string,
): Promise<boolean> {
  const [{ stdout: oldHashOut }, { stdout: newHashOut }] = await Promise.all([
    execAsync(`git rev-parse ${quoteArg(`${fixBase}^3:${file}`)}`, {
      maxBuffer: MAX_BUFFER_BYTES,
    }),
    execAsync(`git hash-object -- ${quoteArg(file)}`, {
      maxBuffer: MAX_BUFFER_BYTES,
    }),
  ]);
  return oldHashOut.trim() !== newHashOut.trim();
}

/** Write the old stash version of a file to a temp path for diffing. */
async function writeStashFileToTemp(
  file: string,
  fixBase: string,
  tmpDir: string,
  counter: number,
): Promise<string> {
  // Use encoding: 'buffer' to preserve binary file integrity
  const { stdout: oldContent } = await execAsync(
    `git show ${quoteArg(`${fixBase}^3:${file}`)}`,
    { maxBuffer: MAX_BUFFER_BYTES, encoding: 'buffer' },
  );
  const tmpFile = path.join(tmpDir, `${counter}-${path.basename(file)}`);
  await fs.writeFile(tmpFile, oldContent);
  return tmpFile;
}

/** Generate a placeholder diff entry when all diff strategies fail for a file. */
function placeholderDiff(file: string): string {
  return `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+[validator: diff unavailable for this file]`;
}

/**
 * Compute diffs for untracked files that existed in a stash's untracked tree.
 * Compares each file against its version in the stash, showing only changes.
 * Files that are unchanged produce no diff and are excluded.
 */
export async function collectStashUntrackedDiffs(
  files: string[],
  fixBase: string,
): Promise<string[]> {
  if (files.length === 0) return [];

  const diffs: string[] = [];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-'));

  try {
    let counter = 0;
    for (const file of files) {
      const d = await diffSingleStashFile(file, fixBase, tmpDir, counter++);
      if (d) diffs.push(d);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return diffs;
}

/** Compute diff for a single file against its stash version, with fallbacks. */
async function diffSingleStashFile(
  file: string,
  fixBase: string,
  tmpDir: string,
  counter: number,
): Promise<string | null> {
  try {
    if (!(await hasFileChangedSinceStash(file, fixBase))) {
      return null; // File unchanged since stash, exclude from diff
    }
    const tmpFile = await writeStashFileToTemp(file, fixBase, tmpDir, counter);
    const d = await execDiff(
      `git diff --no-index -- ${quoteArg(tmpFile)} ${quoteArg(file)}`,
    );
    return d.trim() || null;
  } catch (outerErr) {
    log.debug(
      `Stash diff failed for ${file}, falling back to full diff: ${outerErr instanceof Error ? outerErr.message : outerErr}`,
    );
    return diffFallbackToDevNull(file);
  }
}

/** Fall back to diffing a file against /dev/null (full content). */
async function diffFallbackToDevNull(file: string): Promise<string | null> {
  try {
    const d = await execDiff(
      `git diff --no-index -- /dev/null ${quoteArg(file)}`,
    );
    return d.trim() || null;
  } catch (innerErr) {
    log.warn(
      `Failed to compute any diff for ${file}: ${innerErr instanceof Error ? innerErr.message : innerErr}`,
    );
    return placeholderDiff(file);
  }
}

/**
 * Filter a unified diff string to exclude patches for specific file paths.
 * Parses `diff --git a/<file> b/<file>` headers and drops entire patch hunks
 * for files in the exclude set.
 */
function filterDiffByExcludeSet(
  diff: string,
  excludeFiles: Set<string>,
): string {
  if (excludeFiles.size === 0) return diff;

  const lines = diff.split('\n');
  const kept: string[] = [];
  let skip = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Extract filename — handles both plain and quoted paths
      const match =
        /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/.*?"|b\/\S+)$/.exec(line);
      const file = match?.[1] ?? match?.[2];
      skip = file !== undefined && excludeFiles.has(file);
    }
    if (!skip) {
      kept.push(line);
    }
  }

  // Remove trailing empty lines introduced by exclusion
  while (kept.length > 0 && kept[kept.length - 1] === '') {
    kept.pop();
  }

  return kept.join('\n');
}

/**
 * Identify files that were in a stash's ^3 parent and have since been committed
 * without content changes. These appear spuriously in `git diff <fixBase>` as added files.
 */
async function getUnchangedCommittedFromStashForDiff(
  snapshotUntrackedFiles: Set<string>,
  currentUntracked: Set<string>,
  fixBase: string,
): Promise<Set<string>> {
  // Files that were in stash ^3 but are no longer untracked (they were committed)
  const committedFromStash = [...snapshotUntrackedFiles].filter(
    (f) => !currentUntracked.has(f),
  );

  if (committedFromStash.length === 0) {
    return new Set();
  }

  const unchanged = new Set<string>();
  for (const file of committedFromStash) {
    try {
      const unchanged_ = !(await hasFileChangedSinceStash(file, fixBase));
      if (unchanged_) {
        unchanged.add(file);
      }
    } catch {
      // If comparison fails, include the file (conservative — it may have changed)
    }
  }
  return unchanged;
}

async function getFixBaseDiff(
  entryPointPath: string,
  fixBase: string,
): Promise<string | null> {
  if (!/^[a-f0-9]+$/.test(fixBase)) {
    throw new Error(`Invalid session ref: ${fixBase}`);
  }

  const pArg = pathArg(entryPointPath);
  try {
    // Tracked file changes since fixBase
    const rawDiff = await execDiff(`git diff ${fixBase}${pArg}`);

    // Current untracked files
    const { stdout: untrackedStdout } = await execAsync(
      `git ls-files --others --exclude-standard${pArg}`,
      { maxBuffer: MAX_BUFFER_BYTES },
    );
    const currentUntracked = new Set(parseLines(untrackedStdout));

    // Files in fixBase's main tree (tracked files)
    const { stdout: snapshotFilesStdout } = await execAsync(
      `git ls-tree -r --name-only ${fixBase}${pArg}`,
      { maxBuffer: MAX_BUFFER_BYTES },
    );
    const snapshotTrackedFiles = new Set(parseLines(snapshotFilesStdout));

    // Files in fixBase's untracked tree (stash ^3 parent)
    const snapshotUntrackedFiles = await getStashUntrackedFiles(
      fixBase,
      entryPointPath,
    );

    // Identify files committed from stash without content changes — exclude from tracked diff
    const unchangedCommittedFromStash =
      await getUnchangedCommittedFromStashForDiff(
        snapshotUntrackedFiles,
        currentUntracked,
        fixBase,
      );

    // Filter the tracked diff to remove spurious entries for unchanged committed-from-stash files
    const diff = filterDiffByExcludeSet(rawDiff, unchangedCommittedFromStash);

    // Combine all snapshot files
    const allSnapshotFiles = new Set([
      ...snapshotTrackedFiles,
      ...snapshotUntrackedFiles,
    ]);

    // Truly new files: not in any snapshot tree
    const newUntracked = [...currentUntracked].filter(
      (f) => !allSnapshotFiles.has(f),
    );

    // Known untracked: existed in stash's untracked tree and still untracked
    const knownUntracked = [...currentUntracked].filter((f) =>
      snapshotUntrackedFiles.has(f),
    );

    // Diffs for truly new files (full content against /dev/null)
    const newUntrackedDiffs = await collectUntrackedDiffs(newUntracked);

    // Diffs for known untracked files (only changes since stash)
    const knownUntrackedDiffs = await collectStashUntrackedDiffs(
      knownUntracked,
      fixBase,
    );

    const scopedDiff = [diff, ...newUntrackedDiffs, ...knownUntrackedDiffs]
      .filter(Boolean)
      .join('\n');
    log.debug(
      `Scoped diff via fixBase: ${scopedDiff.split('\n').length} lines (${newUntracked.length} new, ${knownUntracked.length} known untracked, ${unchangedCommittedFromStash.size} committed-from-stash excluded)`,
    );
    return scopedDiff;
  } catch (error) {
    log.warn(
      `Failed to compute diff against fixBase ${fixBase}, falling back to full uncommitted diff. ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

async function collectUntrackedDiffs(files: string[]): Promise<string[]> {
  const diffs: string[] = [];
  for (const file of files) {
    try {
      const d = await execDiff(
        `git diff --no-index -- /dev/null ${quoteArg(file)}`,
      );
      if (d.trim()) diffs.push(d);
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };
      const msg = [err.message, err.stderr].filter(Boolean).join('\n');
      if (
        !(
          msg.includes('Could not access') ||
          msg.includes('ENOENT') ||
          msg.includes('No such file')
        )
      ) {
        throw error;
      }
    }
  }
  return diffs;
}

// ── Uncommitted / commit / CI / local diff modes ────────────────────

async function getUncommittedDiff(entryPointPath: string): Promise<string> {
  log.debug(`Using full uncommitted diff (no fixBase)`);
  const pArg = pathArg(entryPointPath);
  const staged = await execDiff(`git diff --cached${pArg}`);
  const unstaged = await execDiff(`git diff${pArg}`);
  const untracked = await untrackedDiff(entryPointPath);
  return [staged, unstaged, untracked].filter(Boolean).join('\n');
}

async function getCommitDiff(
  entryPointPath: string,
  commit: string,
): Promise<string> {
  if (!/^[a-f0-9]+$/i.test(commit)) {
    throw new Error(`Invalid commit ref: ${commit}`);
  }
  const pArg = pathArg(entryPointPath);
  try {
    return await execDiff(`git diff ${commit}^..${commit}${pArg}`);
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    if (
      err.message?.includes('unknown revision') ||
      err.stderr?.includes('unknown revision')
    ) {
      return await execDiff(`git diff --root ${commit}${pArg}`);
    }
    throw error;
  }
}

export async function getCIDiff(
  entryPointPath: string,
  baseBranch: string,
): Promise<string> {
  const baseRef = quoteArg(baseBranch);
  const headRef = process.env.GITHUB_SHA || 'HEAD';
  const pArg = pathArg(entryPointPath);

  try {
    return await execDiff(`git diff ${baseRef}...${quoteArg(headRef)}${pArg}`);
  } catch (_error) {
    return await execDiff(`git diff HEAD^...HEAD${pArg}`);
  }
}

export async function getLocalDiff(
  entryPointPath: string,
  baseBranch: string,
): Promise<string> {
  const pArg = pathArg(entryPointPath);
  const committed = await execDiff(
    `git diff ${quoteArg(baseBranch)}...HEAD${pArg}`,
  );
  const uncommitted = await execDiff(`git diff HEAD${pArg}`);
  const untracked = await untrackedDiff(entryPointPath);

  return [committed, uncommitted, untracked].filter(Boolean).join('\n');
}

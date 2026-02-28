import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_BUFFER_BYTES } from '../constants.js';

const execFileAsyncOriginal = promisify(execFile);
export let execFileAsync = execFileAsyncOriginal;

export function setExecFileAsync(fn: typeof execFileAsyncOriginal) {
  execFileAsync = fn;
}

/**
 * Run a git command safely using execFile (no shell interpolation).
 */
async function gitExec(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return stdout;
}

export interface DiffStats {
  baseRef: string; // e.g., "origin/main", "abc123", "uncommitted"
  total: number; // Total files changed
  newFiles: number; // Files added
  modifiedFiles: number; // Files modified
  deletedFiles: number; // Files deleted
  linesAdded: number; // Total lines added
  linesRemoved: number; // Total lines removed
}

export interface DiffStatsOptions {
  commit?: string; // If provided, get diff for this commit vs its parent
  uncommitted?: boolean; // If true, only get uncommitted changes
  fixBase?: string; // If provided, get diff from this ref to current working tree
}

/**
 * Compute diff statistics for changed files.
 */
export async function computeDiffStats(
  baseBranch: string,
  options: DiffStatsOptions = {},
): Promise<DiffStats> {
  // Determine what we're diffing
  if (options.commit) {
    return computeCommitDiffStats(options.commit);
  }

  // If fixBase is provided, compute diff from that ref to current working tree
  // This is used in verification mode to show only NEW changes since the snapshot
  if (options.fixBase) {
    return computeFixBaseDiffStats(options.fixBase);
  }

  if (options.uncommitted) {
    return computeUncommittedDiffStats();
  }

  const isCI =
    process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

  if (isCI) {
    return computeCIDiffStats(baseBranch);
  }

  return computeLocalDiffStats(baseBranch);
}

/**
 * Compute diff stats for a specific commit vs its parent.
 */
async function computeCommitDiffStats(commit: string): Promise<DiffStats> {
  try {
    // Get numstat for line counts
    const numstat = await gitExec([
      'diff',
      '--numstat',
      `${commit}^..${commit}`,
    ]);
    const lineStats = parseNumstat(numstat);

    // Get name-status for file categorization
    const nameStatus = await gitExec([
      'diff',
      '--name-status',
      `${commit}^..${commit}`,
    ]);
    const fileStats = parseNameStatus(nameStatus);

    return {
      baseRef: `${commit}^`,
      ...fileStats,
      ...lineStats,
    };
  } catch {
    // If commit has no parent (initial commit), try --root
    try {
      const numstat = await gitExec(['diff', '--numstat', '--root', commit]);
      const lineStats = parseNumstat(numstat);

      const nameStatus = await gitExec([
        'diff',
        '--name-status',
        '--root',
        commit,
      ]);
      const fileStats = parseNameStatus(nameStatus);

      return {
        baseRef: 'root',
        ...fileStats,
        ...lineStats,
      };
    } catch {
      return emptyDiffStats(commit);
    }
  }
}

/**
 * Compute diff stats for uncommitted changes (staged + unstaged + untracked).
 */
async function computeUncommittedDiffStats(): Promise<DiffStats> {
  // Get stats for staged changes
  const stagedNumstat = await gitExec(['diff', '--numstat', '--cached']);
  const stagedLines = parseNumstat(stagedNumstat);

  const stagedStatus = await gitExec(['diff', '--name-status', '--cached']);
  const stagedFiles = parseNameStatus(stagedStatus);

  // Get stats for unstaged changes
  const unstagedNumstat = await gitExec(['diff', '--numstat']);
  const unstagedLines = parseNumstat(unstagedNumstat);

  const unstagedStatus = await gitExec(['diff', '--name-status']);
  const unstagedFiles = parseNameStatus(unstagedStatus);

  // Get untracked files (all count as new, lines unknown)
  const untrackedList = await gitExec([
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  const untrackedFiles = untrackedList
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  return {
    baseRef: 'uncommitted',
    total:
      stagedFiles.total +
      unstagedFiles.total +
      untrackedFiles.length -
      countOverlap(stagedStatus, unstagedStatus),
    newFiles:
      stagedFiles.newFiles + unstagedFiles.newFiles + untrackedFiles.length,
    modifiedFiles: stagedFiles.modifiedFiles + unstagedFiles.modifiedFiles,
    deletedFiles: stagedFiles.deletedFiles + unstagedFiles.deletedFiles,
    linesAdded: stagedLines.linesAdded + unstagedLines.linesAdded,
    linesRemoved: stagedLines.linesRemoved + unstagedLines.linesRemoved,
  };
}

/**
 * Get untracked files from a stash commit's ^3 parent.
 * `git stash create --include-untracked` stores untracked files in the 3rd parent.
 * Returns empty set if fixBase is not a stash or has no untracked tree.
 *
 * @param pathFilter — optional path prefix to scope results (e.g. "src/")
 */
export async function getStashUntrackedFiles(
  fixBase: string,
  pathFilter?: string,
): Promise<Set<string>> {
  try {
    const args = ['ls-tree', '-r', '--name-only', `${fixBase}^3`];
    if (pathFilter) {
      args.push('--', pathFilter);
    }
    const treeFiles = await gitExec(args);
    return new Set(
      treeFiles
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0),
    );
  } catch {
    return new Set();
  }
}

/**
 * Count how many known-untracked files have actually changed since the stash.
 * Compares blob hashes between stash ^3 tree and current working tree.
 */
async function countChangedStashUntracked(
  files: string[],
  fixBase: string,
): Promise<number> {
  let changed = 0;
  for (const file of files) {
    try {
      const [oldHash, newHash] = await Promise.all([
        gitExec(['rev-parse', `${fixBase}^3:${file}`]),
        gitExec(['hash-object', file]),
      ]);
      if (oldHash.trim() !== newHash.trim()) {
        changed++;
      }
    } catch {
      // If comparison fails, count as changed (conservative)
      changed++;
    }
  }
  return changed;
}

/**
 * Compute diff stats from a fixBase ref (stash or commit) to current working tree.
 * Used in verification mode to show only NEW changes since the snapshot.
 * This includes staged changes, unstaged changes, and new untracked files.
 * For stash refs, also checks the ^3 parent to properly handle files that were
 * untracked when the stash was created.
 */
async function computeFixBaseDiffStats(fixBase: string): Promise<DiffStats> {
  try {
    // Get line stats for tracked file changes since fixBase
    const numstat = await gitExec(['diff', '--numstat', fixBase]);
    const lineStats = parseNumstat(numstat);

    // Get file categorization for tracked file changes
    const nameStatus = await gitExec(['diff', '--name-status', fixBase]);
    const fileStats = parseNameStatus(nameStatus);

    // Current untracked files
    const currentUntracked = (
      await gitExec(['ls-files', '--others', '--exclude-standard'])
    )
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // Files in fixBase's main tree (tracked files)
    let fixBaseTrackedFiles: Set<string>;
    try {
      const treeFiles = await gitExec([
        'ls-tree',
        '-r',
        '--name-only',
        fixBase,
      ]);
      fixBaseTrackedFiles = new Set(
        treeFiles
          .split('\n')
          .map((f) => f.trim())
          .filter((f) => f.length > 0),
      );
    } catch {
      fixBaseTrackedFiles = new Set();
    }

    // Files in fixBase's untracked tree (stash ^3 parent)
    const fixBaseUntrackedFiles = await getStashUntrackedFiles(fixBase);

    // Combine all snapshot files
    const allSnapshotFiles = new Set([
      ...fixBaseTrackedFiles,
      ...fixBaseUntrackedFiles,
    ]);

    // Truly new untracked files (not in any snapshot tree)
    const newUntrackedFiles = currentUntracked.filter(
      (f) => !allSnapshotFiles.has(f),
    );

    // Known untracked: existed in stash's untracked tree and still untracked
    const knownUntrackedFiles = currentUntracked.filter((f) =>
      fixBaseUntrackedFiles.has(f),
    );

    // Count how many known-untracked files actually changed
    const changedKnownUntracked = await countChangedStashUntracked(
      knownUntrackedFiles,
      fixBase,
    );

    return {
      baseRef: fixBase,
      total: fileStats.total + newUntrackedFiles.length + changedKnownUntracked,
      newFiles: fileStats.newFiles + newUntrackedFiles.length,
      modifiedFiles: fileStats.modifiedFiles + changedKnownUntracked,
      deletedFiles: fileStats.deletedFiles,
      linesAdded: lineStats.linesAdded,
      linesRemoved: lineStats.linesRemoved,
    };
  } catch {
    return emptyDiffStats(fixBase);
  }
}

/**
 * Compute diff stats in CI environment.
 */
async function computeCIDiffStats(baseBranch: string): Promise<DiffStats> {
  const headRef = process.env.GITHUB_SHA || 'HEAD';

  try {
    const numstat = await gitExec([
      'diff',
      '--numstat',
      `${baseBranch}...${headRef}`,
    ]);
    const lineStats = parseNumstat(numstat);

    const nameStatus = await gitExec([
      'diff',
      '--name-status',
      `${baseBranch}...${headRef}`,
    ]);
    const fileStats = parseNameStatus(nameStatus);

    return {
      baseRef: baseBranch,
      ...fileStats,
      ...lineStats,
    };
  } catch {
    // Fallback for push events
    try {
      const numstat = await gitExec(['diff', '--numstat', 'HEAD^...HEAD']);
      const lineStats = parseNumstat(numstat);

      const nameStatus = await gitExec([
        'diff',
        '--name-status',
        'HEAD^...HEAD',
      ]);
      const fileStats = parseNameStatus(nameStatus);

      return {
        baseRef: 'HEAD^',
        ...fileStats,
        ...lineStats,
      };
    } catch {
      return emptyDiffStats(baseBranch);
    }
  }
}

/**
 * Compute diff stats for local development.
 */
async function computeLocalDiffStats(baseBranch: string): Promise<DiffStats> {
  // 1. Committed changes relative to base branch
  const committedNumstat = await gitExec([
    'diff',
    '--numstat',
    `${baseBranch}...HEAD`,
  ]);
  const committedLines = parseNumstat(committedNumstat);

  const committedStatus = await gitExec([
    'diff',
    '--name-status',
    `${baseBranch}...HEAD`,
  ]);
  const committedFiles = parseNameStatus(committedStatus);

  // 2. Uncommitted changes (staged and unstaged)
  const uncommittedNumstat = await gitExec(['diff', '--numstat', 'HEAD']);
  const uncommittedLines = parseNumstat(uncommittedNumstat);

  const uncommittedStatus = await gitExec(['diff', '--name-status', 'HEAD']);
  const uncommittedFiles = parseNameStatus(uncommittedStatus);

  // 3. Untracked files
  const untrackedList = await gitExec([
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  const untrackedFiles = untrackedList
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  // Combine counts (with overlap detection)
  const totalNew =
    committedFiles.newFiles + uncommittedFiles.newFiles + untrackedFiles.length;
  const totalModified =
    committedFiles.modifiedFiles + uncommittedFiles.modifiedFiles;
  const totalDeleted =
    committedFiles.deletedFiles + uncommittedFiles.deletedFiles;

  return {
    baseRef: baseBranch,
    total: totalNew + totalModified + totalDeleted,
    newFiles: totalNew,
    modifiedFiles: totalModified,
    deletedFiles: totalDeleted,
    linesAdded: committedLines.linesAdded + uncommittedLines.linesAdded,
    linesRemoved: committedLines.linesRemoved + uncommittedLines.linesRemoved,
  };
}

/**
 * Parse git diff --numstat output for line counts.
 * Format: <added>\t<removed>\t<file>
 * Binary files show as "-\t-\t<file>"
 */
function parseNumstat(output: string): {
  linesAdded: number;
  linesRemoved: number;
} {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const added = parts[0];
    const removed = parts[1];
    // Binary files show as "-"
    if (added && added !== '-') {
      linesAdded += parseInt(added, 10) || 0;
    }
    if (removed && removed !== '-') {
      linesRemoved += parseInt(removed, 10) || 0;
    }
  }

  return { linesAdded, linesRemoved };
}

/**
 * Parse git diff --name-status output for file categorization.
 * Format: <status>\t<file> (and optionally \t<new-file> for renames)
 * Status codes: A=added, M=modified, D=deleted, R=renamed, C=copied, T=type-change
 */
function parseNameStatus(output: string): {
  total: number;
  newFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
} {
  let newFiles = 0;
  let modifiedFiles = 0;
  let deletedFiles = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const status = line[0];

    switch (status) {
      case 'A':
        newFiles++;
        break;
      case 'M':
      case 'R':
      case 'C':
      case 'T':
        modifiedFiles++;
        break;
      case 'D':
        deletedFiles++;
        break;
    }
  }

  return {
    total: newFiles + modifiedFiles + deletedFiles,
    newFiles,
    modifiedFiles,
    deletedFiles,
  };
}

/**
 * Count overlapping files between two name-status outputs.
 * Used to avoid double-counting files that appear in both staged and unstaged.
 */
function countOverlap(status1: string, status2: string): number {
  const files1 = new Set<string>();
  for (const line of status1.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const file = parts[1];
    if (parts.length >= 2 && file) {
      files1.add(file);
    }
  }

  let overlap = 0;
  for (const line of status2.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const file = parts[1];
    if (parts.length >= 2 && file && files1.has(file)) {
      overlap++;
    }
  }

  return overlap;
}

/**
 * Return empty diff stats with the given base ref.
 */
function emptyDiffStats(baseRef: string): DiffStats {
  return {
    baseRef,
    total: 0,
    newFiles: 0,
    modifiedFiles: 0,
    deletedFiles: 0,
    linesAdded: 0,
    linesRemoved: 0,
  };
}

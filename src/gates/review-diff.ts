import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getCategoryLogger } from '../output/app-logger.js';

const log = getCategoryLogger('gate', 'review');

const execAsync = promisify(exec);

import { MAX_BUFFER_BYTES } from '../constants.js';

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

async function getFixBaseDiff(
  entryPointPath: string,
  fixBase: string,
): Promise<string | null> {
  if (!/^[a-f0-9]+$/.test(fixBase)) {
    throw new Error(`Invalid session ref: ${fixBase}`);
  }

  const pArg = pathArg(entryPointPath);
  try {
    const diff = await execDiff(`git diff ${fixBase}${pArg}`);

    const { stdout: untrackedStdout } = await execAsync(
      `git ls-files --others --exclude-standard${pArg}`,
      { maxBuffer: MAX_BUFFER_BYTES },
    );
    const currentUntracked = new Set(parseLines(untrackedStdout));

    const { stdout: snapshotFilesStdout } = await execAsync(
      `git ls-tree -r --name-only ${fixBase}${pArg}`,
      { maxBuffer: MAX_BUFFER_BYTES },
    );
    const snapshotFiles = new Set(parseLines(snapshotFilesStdout));

    const newUntracked = [...currentUntracked].filter(
      (f) => !snapshotFiles.has(f),
    );
    const newUntrackedDiffs = await collectUntrackedDiffs(newUntracked);

    const scopedDiff = [diff, ...newUntrackedDiffs].filter(Boolean).join('\n');
    log.debug(
      `Scoped diff via fixBase: ${scopedDiff.split('\n').length} lines`,
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

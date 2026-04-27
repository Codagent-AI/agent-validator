import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { gitStdoutWithInput } from '../utils/git.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Validate that a string is a safe git ref (hex SHA or branch-like name). */
function isValidGitRef(ref: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(ref);
}

export interface ChangeDetectorOptions {
  commit?: string; // If provided, get diff for this commit vs its parent
  uncommitted?: boolean; // If true, only get uncommitted changes (staged + unstaged)
  fixBase?: string; // If provided, get diff from this ref to current working tree
}

export class ChangeDetector {
  constructor(
    private baseBranch: string = 'origin/main',
    private options: ChangeDetectorOptions = {},
  ) {}

  async getChangedFiles(): Promise<string[]> {
    // Validate base branch before any shell interpolation
    if (!isValidGitRef(this.baseBranch)) {
      throw new Error(`Invalid base branch ref: ${this.baseBranch}`);
    }

    // Priority 1: If commit option is provided, use that
    if (this.options.commit) {
      if (!isValidGitRef(this.options.commit)) {
        throw new Error(`Invalid commit ref: ${this.options.commit}`);
      }
      return this.getCommitChangedFiles(this.options.commit);
    }

    // Priority 2: If fixBase is provided, diff against it
    if (this.options.fixBase) {
      if (!isValidGitRef(this.options.fixBase)) {
        throw new Error(`Invalid fixBase ref: ${this.options.fixBase}`);
      }
      return this.getFixBaseChangedFiles(this.options.fixBase);
    }

    // Priority 3: If uncommitted option is provided, only get uncommitted changes
    if (this.options.uncommitted) {
      return this.getUncommittedChangedFiles();
    }

    // Priority 4: CI detection / local base branch diff
    const isCI =
      process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

    if (isCI) {
      return this.getCIChangedFiles();
    }
    return this.getLocalChangedFiles();
  }

  private async getCIChangedFiles(): Promise<string[]> {
    // In GitHub Actions, GITHUB_SHA is the commit being built
    // Base branch priority is already resolved by caller
    const baseRef = this.baseBranch;
    const headRef = process.env.GITHUB_SHA || 'HEAD';

    if (!isValidGitRef(baseRef)) {
      throw new Error(`Invalid base ref: ${baseRef}`);
    }
    if (!isValidGitRef(headRef)) {
      throw new Error(`Invalid head ref: ${headRef}`);
    }

    // We might need to fetch first in some shallow clones, but assuming strictly for now
    // git diff --name-only base...head
    try {
      const { stdout } = await execAsync(
        `git diff --name-only ${baseRef}...${headRef}`,
      );
      return this.parseOutput(stdout);
    } catch (error) {
      console.warn(
        'Failed to detect changes via git diff in CI, falling back to HEAD^...HEAD',
        error,
      );
      // Fallback for push events where base ref might not be available
      const { stdout } = await execAsync('git diff --name-only HEAD^...HEAD');
      return this.parseOutput(stdout);
    }
  }

  /** Collect uncommitted (staged + unstaged) and untracked file paths. */
  private async getWorkingTreeFiles(): Promise<string[]> {
    const { stdout: staged } = await execAsync('git diff --name-only --cached');
    const { stdout: unstaged } = await execAsync('git diff --name-only');
    const { stdout: untracked } = await execAsync(
      'git ls-files --others --exclude-standard',
    );
    return [
      ...this.parseOutput(staged),
      ...this.parseOutput(unstaged),
      ...this.parseOutput(untracked),
    ];
  }

  /** Combine committed diff (against a base ref) with working tree changes. */
  private async getDiffWithWorkingTree(baseRef: string): Promise<string[]> {
    const { stdout: committed } = await execAsync(
      `git diff --name-only ${baseRef}...HEAD`,
    );
    const files = new Set([
      ...this.parseOutput(committed),
      ...(await this.getWorkingTreeFiles()),
    ]);
    return Array.from(files);
  }

  /**
   * Resolve base branch to whichever of local or origin/<branch> is more up-to-date.
   * Uses commit-ahead counts to pick the ref with more recent history.
   */
  private async resolveLocalBaseBranch(): Promise<string> {
    const base = this.baseBranch;
    if (base.startsWith('origin/')) return base;
    const remoteRef = `origin/${base}`;

    const [localExists, remoteExists] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--verify', base]).then(
        () => true,
        () => false,
      ),
      execFileAsync('git', ['rev-parse', '--verify', remoteRef]).then(
        () => true,
        () => false,
      ),
    ]);

    if (!remoteExists) return base;
    if (!localExists) return remoteRef;

    try {
      const [{ stdout: remoteAhead }, { stdout: localAhead }] =
        await Promise.all([
          execFileAsync('git', [
            'rev-list',
            '--count',
            `${base}..${remoteRef}`,
          ]),
          execFileAsync('git', [
            'rev-list',
            '--count',
            `${remoteRef}..${base}`,
          ]),
        ]);

      return parseInt(localAhead.trim(), 10) > parseInt(remoteAhead.trim(), 10)
        ? base
        : remoteRef;
    } catch {
      // Shallow clone or unreachable history — fall back to remote ref
      return remoteRef;
    }
  }

  private async getLocalChangedFiles(): Promise<string[]> {
    const resolvedBase = await this.resolveLocalBaseBranch();
    return this.getDiffWithWorkingTree(resolvedBase);
  }

  private async getCommitChangedFiles(commit: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `git diff --name-only ${commit}^..${commit}`,
      );
      return this.parseOutput(stdout);
    } catch (_error) {
      try {
        const { stdout } = await execAsync(
          `git diff --name-only --root ${commit}`,
        );
        return this.parseOutput(stdout);
      } catch {
        throw new Error(`Failed to get changes for commit ${commit}`);
      }
    }
  }

  private async getFixBaseChangedFiles(fixBase: string): Promise<string[]> {
    // Compare the fixBase snapshot directly against the current working tree.
    // For stash refs, untracked files live in the ^3 parent and are invisible to
    // git diff, so handle that tree explicitly below.
    const { stdout: tracked } = await execFileAsync('git', [
      'diff',
      '--name-only',
      fixBase,
    ]);
    const files = new Set(this.parseOutput(tracked));
    const snapshotUntracked = await this.getStashUntrackedFileHashes(fixBase);
    const currentUntracked = new Set(
      await this.getCurrentUntrackedChangedFiles(),
    );
    const currentFilesToHash = new Set([
      ...currentUntracked,
      ...snapshotUntracked.keys(),
    ]);
    const currentHashes = await this.getCurrentFileHashes(currentFilesToHash);

    for (const file of currentUntracked) {
      if (!snapshotUntracked.has(file)) {
        files.add(file);
        continue;
      }

      if (snapshotUntracked.get(file) !== currentHashes.get(file)) {
        files.add(file);
      } else {
        files.delete(file);
      }
    }

    for (const file of snapshotUntracked.keys()) {
      if (currentUntracked.has(file)) continue;

      if (snapshotUntracked.get(file) !== currentHashes.get(file)) {
        files.add(file);
      } else {
        files.delete(file);
      }
    }

    return Array.from(files);
  }

  private async getCurrentUntrackedChangedFiles(): Promise<string[]> {
    const { stdout } = await execFileAsync('git', [
      'ls-files',
      '--others',
      '--exclude-standard',
    ]);
    return this.parseOutput(stdout);
  }

  private async getStashUntrackedFileHashes(
    fixBase: string,
  ): Promise<Map<string, string>> {
    try {
      const { stdout: hashesStdout } = await execFileAsync('git', [
        'ls-tree',
        '-r',
        '-z',
        `${fixBase}^3`,
      ]);
      const entries = hashesStdout.split('\0').filter(Boolean);
      const hashes = new Map<string, string>();
      for (const entry of entries) {
        const match = /^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/.exec(entry);
        const hash = match?.[1];
        const file = match?.[2];
        if (hash && file) hashes.set(file, hash);
      }
      return hashes;
    } catch {
      return new Map();
    }
  }

  private async getCurrentFileHashes(
    files: Iterable<string>,
  ): Promise<Map<string, string>> {
    const existingFiles: string[] = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        if (stat.isFile()) existingFiles.push(file);
      } catch {
        // Missing files stay absent from the map and compare as changed.
      }
    }

    if (existingFiles.length === 0) return new Map();

    const stdout = await gitStdoutWithInput(
      ['hash-object', '--stdin-paths'],
      `${existingFiles.join('\n')}\n`,
    );
    const hashes = this.parseOutput(stdout);
    const result = new Map<string, string>();
    for (const [index, file] of existingFiles.entries()) {
      const hash = hashes[index];
      if (hash) result.set(file, hash);
    }
    return result;
  }

  private async getUncommittedChangedFiles(): Promise<string[]> {
    const files = new Set(await this.getWorkingTreeFiles());
    return Array.from(files);
  }

  private parseOutput(stdout: string): string[] {
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

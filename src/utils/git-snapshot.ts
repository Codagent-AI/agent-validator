import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const runGit = (
  args: string[],
  indexFile?: string,
  input?: string,
  cwd?: string,
) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          // Synthetic snapshot commits must also work in unconfigured CI repos.
          GIT_AUTHOR_NAME: 'validator-snapshot',
          GIT_AUTHOR_EMAIL: 'validator@snapshot',
          GIT_COMMITTER_NAME: 'validator-snapshot',
          GIT_COMMITTER_EMAIL: 'validator@snapshot',
          GIT_OPTIONAL_LOCKS: '0',
          ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
        },
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      },
    );
    // Preserve NUL-delimited filenames verbatim, including leading/trailing whitespace.
    // Git can reject a path before consuming all input. Let its exit status and
    // stderr report the failure instead of an unhandled stdin EPIPE event.
    child.stdin?.on('error', () => {});
    if (input !== undefined) child.stdin?.end(input);
  });

async function copyIndex(source: string, destination: string): Promise<void> {
  try {
    await fs.copyFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A missing index represents an empty staging area; keep the real one absent.
    await runGit(['read-tree', '--empty'], destination);
  }
}

/** Build an unreachable stash-format commit without writing checkout state. */
export async function captureWorkingTree(branch: string): Promise<string> {
  let tempDir: string | undefined;
  try {
    const head = (await runGit(['rev-parse', 'HEAD'])).trim();
    const root = (await runGit(['rev-parse', '--show-toplevel'])).trim();
    const indexPath = path.resolve(
      (await runGit(['rev-parse', '--git-path', 'index'])).trim(),
    );
    tempDir = await fs.mkdtemp(`${indexPath}.validator-`);
    const workingIndex = path.join(tempDir, 'working');
    const untrackedIndex = path.join(tempDir, 'untracked');
    // Even write-tree can update the index's cache-tree extension. Use a copy
    // for the index parent too, keeping the user's index byte-for-byte intact.
    await copyIndex(indexPath, workingIndex);
    const indexTree = (await runGit(['write-tree'], workingIndex)).trim();
    const indexCommit = (
      await runGit([
        'commit-tree',
        indexTree,
        '-p',
        head,
        '-m',
        `index on ${branch}: validator-snapshot`,
      ])
    ).trim();

    const untracked = await runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      undefined,
      undefined,
      root,
    );
    await runGit(['read-tree', '--empty'], untrackedIndex);
    if (untracked) {
      await runGit(
        ['update-index', '--add', '-z', '--stdin'],
        untrackedIndex,
        untracked,
        root,
      );
    }
    const untrackedTree = (await runGit(['write-tree'], untrackedIndex)).trim();
    const untrackedCommit = (
      await runGit([
        'commit-tree',
        untrackedTree,
        '-m',
        `untracked files on ${branch}: validator-snapshot`,
      ])
    ).trim();

    await runGit(['add', '-u'], workingIndex, undefined, root);
    const workingTree = (await runGit(['write-tree'], workingIndex)).trim();
    return (
      await runGit([
        'commit-tree',
        workingTree,
        '-p',
        head,
        '-p',
        indexCommit,
        '-p',
        untrackedCommit,
        '-m',
        `On ${branch}: validator-snapshot`,
      ])
    ).trim();
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  }
}

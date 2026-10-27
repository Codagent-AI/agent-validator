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
        env: {
          ...process.env,
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
    if (input !== undefined) child.stdin?.end(input);
  });

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
    await fs.copyFile(indexPath, workingIndex);
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

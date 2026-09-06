import fs from 'node:fs/promises';
import path from 'node:path';

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function invalidPath(message: string): Error {
  return new Error(`invalid closure journal: ${message}`);
}

function pathWithin(root: string, target: string, allowRoot = false): boolean {
  return (
    (allowRoot && root === target) || target.startsWith(`${root}${path.sep}`)
  );
}

export function operationPath(
  logDir: string,
  staging: string,
  value: string,
): string {
  const root = value.startsWith('evicted/') ? staging : logDir;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, value);
  if (!pathWithin(resolvedRoot, resolved))
    throw invalidPath('archive path escapes its root');
  return resolved;
}

export async function ensureSafeDirectory(
  root: string,
  directory: string,
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  if (!pathWithin(resolvedRoot, resolvedDirectory, true))
    throw invalidPath('archive path escapes its root');
  if (!(await fs.stat(resolvedRoot)).isDirectory())
    throw invalidPath('archive root is not a directory');
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  let current = resolvedRoot;
  for (const component of relative ? relative.split(path.sep) : []) {
    current = path.join(current, component);
    const stats = await fs.lstat(current).catch(async (error) => {
      if (!isMissing(error)) throw error;
      await fs.mkdir(current);
      return fs.lstat(current);
    });
    if (stats.isSymbolicLink() || !stats.isDirectory())
      throw invalidPath('archive destination contains a symbolic link');
  }
  const [canonicalRoot, canonicalDirectory] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(resolvedDirectory),
  ]);
  if (!pathWithin(canonicalRoot, canonicalDirectory, true))
    throw invalidPath('archive path escapes its root');
}

async function exists(target: string): Promise<boolean> {
  return fs
    .lstat(target)
    .then(() => true)
    .catch(() => false);
}

export async function moveArchiveDirectory(
  source: string,
  destination: string,
  destinationRoot: string,
  sourceName: string,
  destinationName: string,
): Promise<void> {
  const [sourceExists, destinationExists] = await Promise.all([
    exists(source),
    exists(destination),
  ]);
  if (sourceExists && !destinationExists) {
    await ensureSafeDirectory(destinationRoot, path.dirname(destination));
    await fs.rename(source, destination);
    return;
  }
  if (!(sourceExists || destinationExists))
    throw new Error(`closure archive conflict: missing ${sourceName}`);
  if (sourceExists)
    throw new Error(`closure archive conflict: ${destinationName}`);
}

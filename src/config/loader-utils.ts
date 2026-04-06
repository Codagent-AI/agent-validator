import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadPromptFile(
  filePath: string,
  configDir: string,
  source: string,
): Promise<string> {
  let resolvedPath: string;
  if (path.isAbsolute(filePath)) {
    console.warn(
      `Warning: ${source} uses absolute path "${filePath}". Prefer relative paths for portability.`,
    );
    resolvedPath = filePath;
  } else {
    resolvedPath = path.resolve(configDir, filePath);
  }
  // Warn if resolved path escapes the config directory (including via relative traversal)
  const normalizedConfigDir = path.resolve(configDir);
  const relativeToConfigDir = path.relative(normalizedConfigDir, resolvedPath);
  if (
    relativeToConfigDir.startsWith('..') ||
    path.isAbsolute(relativeToConfigDir)
  ) {
    console.warn(
      `Warning: ${source} references file outside config directory: "${filePath}" (resolves to ${resolvedPath}). Review config changes carefully in PRs.`,
    );
  }
  if (!(await fileExists(resolvedPath))) {
    throw new Error(
      `File not found: ${resolvedPath} (referenced by ${source})`,
    );
  }
  return fs.readFile(resolvedPath, 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

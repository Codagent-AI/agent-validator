import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { EntryPointConfig } from '../config/types.js';

export interface ExpandedEntryPoint {
  path: string; // The specific directory (e.g., "engines/billing")
  config: EntryPointConfig; // The config that generated this (e.g., "engines/*")
}

export class EntryPointExpander {
  async expand(
    entryPoints: EntryPointConfig[],
    changedFiles: string[],
  ): Promise<ExpandedEntryPoint[]> {
    const results: ExpandedEntryPoint[] = [];

    this.expandRootEntryPoint(entryPoints, changedFiles, results);

    for (const ep of entryPoints) {
      if (ep.path === '.') continue;
      await this.expandNonRootEntry(ep, changedFiles, results);
    }

    return results;
  }

  private expandRootEntryPoint(
    entryPoints: EntryPointConfig[],
    changedFiles: string[],
    results: ExpandedEntryPoint[],
  ): void {
    if (changedFiles.length === 0) return;

    const rootConfig = entryPoints.find((ep) => ep.path === '.') ?? {
      path: '.',
    };
    const filteredRootChanges = this.filterExcludedFiles(
      changedFiles,
      rootConfig.exclude,
    );

    if (filteredRootChanges.length > 0) {
      results.push({ path: '.', config: rootConfig });
    }
  }

  private async expandNonRootEntry(
    ep: EntryPointConfig,
    changedFiles: string[],
    results: ExpandedEntryPoint[],
  ): Promise<void> {
    const filteredChanges = this.filterExcludedFiles(changedFiles, ep.exclude);
    if (filteredChanges.length === 0) return;

    if (ep.path.endsWith('*') && !ep.path.includes('**')) {
      const parentDir = ep.path.slice(0, -2);
      const expandedPaths = await this.expandWildcard(
        parentDir,
        filteredChanges,
      );
      for (const subDir of expandedPaths) {
        results.push({ path: subDir, config: ep });
      }
    } else if (this.isGlobPattern(ep.path)) {
      if (this.hasMatchingFiles(ep.path, filteredChanges)) {
        results.push({ path: ep.path, config: ep });
      }
    } else if (this.hasChangesInDir(ep.path, filteredChanges)) {
      results.push({ path: ep.path, config: ep });
    }
  }

  async expandAll(
    entryPoints: EntryPointConfig[],
  ): Promise<ExpandedEntryPoint[]> {
    const results: ExpandedEntryPoint[] = [];

    for (const ep of entryPoints) {
      if (ep.path === '.') {
        results.push({ path: '.', config: ep });
        continue;
      }

      if (ep.path.endsWith('*') && !ep.path.includes('**')) {
        // Single-level wildcard directory (e.g., "engines/*")
        const parentDir = ep.path.slice(0, -2);
        const subDirs = await this.listSubDirectories(parentDir);
        for (const subDir of subDirs) {
          results.push({ path: subDir, config: ep });
        }
      } else if (this.isGlobPattern(ep.path)) {
        // Glob pattern (e.g., "openspec/changes/**/spec.md")
        // Include as-is for expandAll since it's a virtual entry point
        results.push({ path: ep.path, config: ep });
      } else {
        results.push({ path: ep.path, config: ep });
      }
    }

    return results;
  }

  private filterExcludedFiles(files: string[], patterns?: string[]): string[] {
    if (!patterns || patterns.length === 0) {
      return files;
    }

    // Pre-compile matchers
    const matchers: picomatch.Matcher[] = [];
    const prefixes: string[] = [];

    for (const pattern of patterns) {
      if (pattern.match(/[*?[{]/)) {
        matchers.push(picomatch(pattern));
      } else {
        prefixes.push(pattern);
      }
    }

    return files.filter((file) => {
      // If matches ANY pattern, exclude it
      const isExcluded =
        prefixes.some((p) => file === p || file.startsWith(`${p}/`)) ||
        matchers.some((m) => m(file));

      return !isExcluded;
    });
  }

  private async expandWildcard(
    parentDir: string,
    changedFiles: string[],
  ): Promise<string[]> {
    const affectedSubDirs = new Set<string>();

    // Filter changes that are inside this parent directory
    const relevantChanges = changedFiles.filter((f) =>
      f.startsWith(`${parentDir}/`),
    );

    for (const file of relevantChanges) {
      // file: "engines/billing/src/foo.ts", parentDir: "engines"
      // relPath: "billing/src/foo.ts"
      const relPath = file.slice(parentDir.length + 1);
      const subDirName = relPath.split('/')[0];

      if (subDirName) {
        affectedSubDirs.add(path.join(parentDir, subDirName));
      }
    }

    return Array.from(affectedSubDirs);
  }

  private async listSubDirectories(parentDir: string): Promise<string[]> {
    try {
      const dirents = await fs.readdir(parentDir, { withFileTypes: true });
      return dirents
        .filter((d) => d.isDirectory())
        .map((d) => path.join(parentDir, d.name));
    } catch {
      return [];
    }
  }

  private hasChangesInDir(dirPath: string, changedFiles: string[]): boolean {
    // Check if any changed file starts with the dirPath
    // Need to ensure exact match or subdirectory (e.g. "app" should not match "apple")
    const dirPrefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    return changedFiles.some((f) => f === dirPath || f.startsWith(dirPrefix));
  }

  private isGlobPattern(pattern: string): boolean {
    // Check if the pattern contains glob characters
    return /[*?[{]/.test(pattern);
  }

  private hasMatchingFiles(pattern: string, changedFiles: string[]): boolean {
    const matcher = picomatch(pattern);
    return changedFiles.some((file) => matcher(file));
  }
}

import { realpathSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import {
  listPlugins,
  updateMarketplace,
  updatePlugin,
} from '../plugin/claude-cli.js';
import { computeSkillChecksum } from './init-checksums.js';
import { exists } from './shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// After bundling, __dirname is `dist/` (one level below package root).
// In dev, __dirname is `src/commands/` (two levels below package root).
const SKILLS_SOURCE_DIR = (() => {
  const bundled = path.join(__dirname, '..', 'skills');
  const dev = path.join(__dirname, '..', '..', 'skills');
  try {
    statSync(bundled);
    return bundled;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return dev;
    throw err;
  }
})();

interface PluginEntry {
  name?: unknown;
  id?: unknown;
  scope?: unknown;
  projectPath?: unknown;
}

export interface PluginUpdateOptions {
  skipPrompts?: boolean;
}

async function getSkillDirNames(): Promise<string[]> {
  const entries = await fs.readdir(SKILLS_SOURCE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function copyDirRecursive(opts: {
  src: string;
  dest: string;
}): Promise<void> {
  await fs.mkdir(opts.dest, { recursive: true });
  const entries = await fs.readdir(opts.src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(opts.src, entry.name);
    const destPath = path.join(opts.dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive({ src: srcPath, dest: destPath });
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function isInProjectScope(cwd: string, projectPath: string): boolean {
  const absoluteCwd = path.resolve(cwd);
  const absoluteProjectPath = path.resolve(projectPath);
  const normalizedCwd = normalizePathForMatch(absoluteCwd);
  const normalizedProjectPath = normalizePathForMatch(absoluteProjectPath);
  return (
    normalizedCwd === normalizedProjectPath ||
    normalizedCwd.startsWith(`${normalizedProjectPath}${path.sep}`)
  );
}

function normalizePathForMatch(inputPath: string): string {
  try {
    return realpathSync.native(inputPath);
  } catch {
    return inputPath;
  }
}

function detectInstalledScope(
  entries: PluginEntry[],
  cwd: string,
): 'project' | 'user' | null {
  const pluginEntries = entries.filter((entry) => {
    const name = entry.name ?? entry.id;
    return (
      name === 'agent-gauntlet' ||
      (typeof name === 'string' && name.startsWith('agent-gauntlet@'))
    );
  });

  const projectEntries = pluginEntries.filter(
    (entry) =>
      entry.scope === 'project' &&
      typeof entry.projectPath === 'string' &&
      isInProjectScope(cwd, entry.projectPath),
  );
  if (projectEntries.length > 0) {
    return 'project';
  }

  const hasUserInstall = pluginEntries.some((entry) => entry.scope === 'user');
  if (hasUserInstall) {
    return 'user';
  }

  return null;
}

function printManualUpdateInstructions(): void {
  console.error('Run these commands manually:');
  console.error('  claude plugin marketplace update agent-gauntlet');
  console.error('  claude plugin update agent-gauntlet@pcaplan/agent-gauntlet');
}

async function refreshCodexSkills(cwd: string): Promise<void> {
  const localBase = path.join(cwd, '.agents', 'skills');
  const localMarker = path.join(localBase, 'gauntlet-run');

  const homeDir = process.env.HOME?.trim() || os.homedir();
  const globalBase = path.join(homeDir, '.agents', 'skills');
  const globalMarker = path.join(globalBase, 'gauntlet-run');

  let targetBase: string | null = null;
  if (await exists(localMarker)) {
    targetBase = localBase;
  } else if (await exists(globalMarker)) {
    targetBase = globalBase;
  }

  if (!targetBase) {
    return;
  }

  for (const dirName of await getSkillDirNames()) {
    const sourceDir = path.join(SKILLS_SOURCE_DIR, dirName);
    const targetDir = path.join(targetBase, dirName);
    if (!(await exists(targetDir))) {
      await copyDirRecursive({ src: sourceDir, dest: targetDir });
      continue;
    }

    const sourceChecksum = await computeSkillChecksum(sourceDir);
    const targetChecksum = await computeSkillChecksum(targetDir);
    if (sourceChecksum === targetChecksum) {
      continue;
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await copyDirRecursive({ src: sourceDir, dest: targetDir });
  }
}

export async function runPluginUpdate(
  options?: PluginUpdateOptions,
): Promise<void> {
  void options?.skipPrompts;

  const cwd = process.cwd();
  let scope: 'project' | 'user' | null = null;

  try {
    const parsedPlugins = (await listPlugins()) as PluginEntry[];
    scope = detectInstalledScope(parsedPlugins, cwd);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to detect plugin installation: ${message}`);
  }

  if (!scope) {
    throw new Error(
      'agent-gauntlet Claude plugin is not installed for this project. Please run `agent-gauntlet init` first.',
    );
  }

  console.log(
    chalk.cyan(`Updating agent-gauntlet Claude plugin (${scope} scope)...`),
  );

  const marketplaceResult = await updateMarketplace();
  if (!marketplaceResult.success) {
    console.error(chalk.red('Plugin update failed.'));
    if (marketplaceResult.stderr) {
      console.error(chalk.red(marketplaceResult.stderr.trim()));
    }
    printManualUpdateInstructions();
    throw new Error(
      marketplaceResult.stderr ?? 'Failed to update plugin marketplace entry',
    );
  }

  const pluginResult = await updatePlugin();
  if (!pluginResult.success) {
    console.error(chalk.red('Plugin update failed.'));
    if (pluginResult.stderr) {
      console.error(chalk.red(pluginResult.stderr.trim()));
    }
    printManualUpdateInstructions();
    throw new Error(pluginResult.stderr ?? 'Failed to update plugin');
  }

  await refreshCodexSkills(cwd);

  console.log(chalk.green('Plugin update completed successfully.'));
  console.log(
    chalk.yellow('Restart any open agent sessions to use the updated plugin.'),
  );
}

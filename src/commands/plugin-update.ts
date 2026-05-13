import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { CursorAdapter } from '../cli-adapters/cursor.js';
import { updateAgentPluginForAgents as realUpdateAgentPluginForAgents } from '../plugin/agent-plugin-cli.js';
import {
  addMarketplace,
  installPlugin,
  listPlugins,
  updateMarketplace,
  updatePlugin,
} from '../plugin/claude-cli.js';
import { addToGitignore, exists } from './shared.js';

interface PluginEntry {
  name?: unknown;
  id?: unknown;
  scope?: unknown;
  projectPath?: unknown;
}

export interface PluginUpdateOptions {
  skipPrompts?: boolean;
}

export interface PluginUpdateDependencies {
  updateAgentPluginForAgents?: typeof realUpdateAgentPluginForAgents;
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

function isPluginEntry(entry: PluginEntry): boolean {
  const name = entry.name ?? entry.id;
  return (
    name === 'agent-validator' ||
    (typeof name === 'string' && name.startsWith('agent-validator@')) ||
    // Legacy: also detect old installs so we can update them
    name === 'agent-gauntlet' ||
    (typeof name === 'string' && name.startsWith('agent-gauntlet@'))
  );
}

interface DetectedPlugin {
  scope: 'project' | 'user';
  installedName: string;
}

function extractPluginBaseName(entry: PluginEntry): string {
  // Prefer `name` over `id` — `id` may be a marketplace slug like "agent-validator@org/repo"
  const raw =
    typeof entry.name === 'string' ? entry.name : String(entry.id ?? '');
  // Strip version/source suffix: "agent-validator@org/repo" → "agent-validator"
  const atIdx = raw.indexOf('@');
  const base = atIdx > 0 ? raw.slice(0, atIdx) : raw;
  // Reject slugs containing "/" — fall back to the canonical name
  return base && !base.includes('/') ? base : 'agent-validator';
}

function detectInstalledScope(
  entries: PluginEntry[],
  cwd: string,
): DetectedPlugin | null {
  const pluginEntries = entries.filter(isPluginEntry);

  const projectEntries = pluginEntries.filter(
    (entry) =>
      entry.scope === 'project' &&
      typeof entry.projectPath === 'string' &&
      isInProjectScope(cwd, entry.projectPath),
  );
  const firstProject = projectEntries[0];
  if (firstProject) {
    return {
      scope: 'project',
      installedName: extractPluginBaseName(firstProject),
    };
  }

  const userEntry = pluginEntries.find((entry) => entry.scope === 'user');
  if (userEntry) {
    return {
      scope: 'user',
      installedName: extractPluginBaseName(userEntry),
    };
  }

  return null;
}

function printManualUpdateInstructions(installedName: string): void {
  console.error('Run these commands manually:');
  console.error(`  claude plugin marketplace update ${installedName}`);
  console.error(
    `  claude plugin update ${installedName}@Codagent-AI/agent-validator`,
  );
}

async function detectCodexSkillScope(
  cwd: string,
): Promise<'project' | 'user' | null> {
  const localBase = path.join(cwd, '.agents', 'skills');
  // Check for new name first, then legacy name
  const localMarker = (await exists(path.join(localBase, 'validator-run')))
    ? path.join(localBase, 'validator-run')
    : path.join(localBase, 'gauntlet-run');

  const homeDir = process.env.HOME?.trim() || os.homedir();
  const globalBase = path.join(homeDir, '.agents', 'skills');
  const globalMarker = (await exists(path.join(globalBase, 'validator-run')))
    ? path.join(globalBase, 'validator-run')
    : path.join(globalBase, 'gauntlet-run');

  if (await exists(localMarker)) {
    return 'project';
  }
  if (await exists(globalMarker)) {
    return 'user';
  }
  return null;
}

function isCliUnavailableError(err: unknown): boolean {
  if (err != null && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (code === 'ENOENT') {
      return true;
    }
  }
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return msg.includes('command not found') || msg.includes('not installed');
}

async function detectClaudePlugin(cwd: string): Promise<DetectedPlugin | null> {
  try {
    const parsedPlugins = (await listPlugins()) as PluginEntry[];
    return detectInstalledScope(parsedPlugins, cwd);
  } catch (error: unknown) {
    if (isCliUnavailableError(error)) {
      // Claude CLI is not installed — treat as not found so Cursor-only
      // setups can still update successfully.
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to detect Claude plugin installation: ${message}`);
  }
}

async function updateClaudePlugin(detected: DetectedPlugin): Promise<void> {
  console.log(
    chalk.cyan(
      `Updating agent-validator Claude plugin (${detected.scope} scope)...`,
    ),
  );

  let marketplaceResult = await updateMarketplace(detected.installedName);
  if (!marketplaceResult.success) {
    // Marketplace entry may be missing (removed, renamed, or new machine) — re-add it
    console.log(chalk.yellow('Marketplace entry not found, re-adding...'));
    const addResult = await addMarketplace();
    if (addResult.success) {
      marketplaceResult = await updateMarketplace(detected.installedName);
    }
  }
  if (!marketplaceResult.success) {
    console.error(chalk.red('Plugin update failed.'));
    if (marketplaceResult.stderr) {
      console.error(chalk.red(marketplaceResult.stderr.trim()));
    }
    printManualUpdateInstructions(detected.installedName);
    throw new Error(
      marketplaceResult.stderr ?? 'Failed to update plugin marketplace entry',
    );
  }

  let pluginResult = await updatePlugin(detected.installedName);
  if (!pluginResult.success) {
    // Plugin entry may be missing or under a different name — reinstall it
    console.log(chalk.yellow('Plugin not found, reinstalling...'));
    pluginResult = await installPlugin(detected.scope);
  }
  if (!pluginResult.success) {
    console.error(chalk.red('Plugin update failed.'));
    if (pluginResult.stderr) {
      console.error(chalk.red(pluginResult.stderr.trim()));
    }
    printManualUpdateInstructions(detected.installedName);
    throw new Error(pluginResult.stderr ?? 'Failed to update plugin');
  }
}

async function updateCursorPlugin(
  adapter: CursorAdapter,
  scope: 'project' | 'user',
  cwd: string,
): Promise<void> {
  console.log(
    chalk.cyan(`Updating agent-validator Cursor plugin (${scope} scope)...`),
  );

  const cursorResult = await adapter.updatePlugin(scope, cwd);
  if (cursorResult.success) {
    console.log(chalk.green('Cursor plugin updated successfully.'));
    console.log(
      chalk.yellow(
        'Restart any open Cursor sessions to use the updated plugin.',
      ),
    );
  } else {
    console.error(
      chalk.yellow(
        `Cursor plugin update failed: ${cursorResult.error ?? 'unknown error'}`,
      ),
    );
  }
}

export async function runPluginUpdate(
  options?: PluginUpdateOptions,
  dependencies: PluginUpdateDependencies = {},
): Promise<void> {
  void options?.skipPrompts;
  const updateAgentPluginForAgents =
    dependencies.updateAgentPluginForAgents ?? realUpdateAgentPluginForAgents;

  const cwd = process.cwd();
  const claudeDetected = await detectClaudePlugin(cwd);

  // Detect Cursor plugin installation
  const cursorAdapter = new CursorAdapter();
  const cursorScope = await cursorAdapter.detectPlugin(cwd);
  const codexScope = await detectCodexSkillScope(cwd);

  // Error if nothing is installed at all
  if (!(claudeDetected || cursorScope || codexScope)) {
    throw new Error(
      'No agent-validator plugin is installed for this project. Please run `agent-validate init` first.',
    );
  }

  if (claudeDetected) {
    await updateClaudePlugin(claudeDetected);
  }

  if (cursorScope) {
    await updateCursorPlugin(cursorAdapter, cursorScope, cwd);
  }

  const agentPluginTargets = [
    ...(claudeDetected ? ['claude'] : []),
    ...(cursorScope ? ['cursor'] : []),
    ...(codexScope ? ['codex'] : []),
  ];
  if (agentPluginTargets.length > 0) {
    const agentPluginScope: 'project' | 'user' = [
      claudeDetected?.scope,
      cursorScope,
      codexScope,
    ].includes('project')
      ? 'project'
      : 'user';

    updateAgentPluginForAgents({
      agents: agentPluginTargets,
      scope: agentPluginScope,
      yes: true,
    });
  }

  // Ensure validator_logs is in .gitignore (backwards compat: log dir was renamed)
  await addToGitignore(cwd, 'validator_logs');

  console.log(chalk.green('Plugin update completed successfully.'));
  console.log(
    chalk.yellow('Restart any open agent sessions to use the updated plugin.'),
  );
}

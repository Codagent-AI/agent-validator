import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import {
  addMarketplace,
  installPlugin,
  listPlugins,
} from '../plugin/claude-cli.js';

export function getCodexSkillsBaseDir(scope: 'user' | 'project'): string {
  if (scope === 'project') {
    return path.join('.agents', 'skills');
  }
  const homeDir = process.env.HOME?.trim() || os.homedir();
  return path.join(homeDir, '.agents', 'skills');
}

export async function detectInstalledPlugin(
  projectRoot: string,
): Promise<'user' | 'project' | null> {
  try {
    const entries = await listPlugins();
    const pluginEntries = entries.filter((entry) => {
      const name = (entry as { name?: unknown })?.name;
      return name === 'agent-gauntlet';
    });
    const resolved = path.resolve(projectRoot);
    if (
      pluginEntries.some((entry) => {
        const e = entry as { scope?: unknown; projectPath?: unknown };
        return (
          e.scope === 'project' &&
          typeof e.projectPath === 'string' &&
          path.resolve(e.projectPath) === resolved
        );
      })
    ) {
      return 'project';
    }
    if (
      pluginEntries.some(
        (entry) => (entry as { scope?: unknown }).scope === 'user',
      )
    ) {
      return 'user';
    }
  } catch {
    // Claude CLI not available or plugin list failed
  }
  return null;
}

export function detectClaudePluginScope(): 'user' | 'project' {
  try {
    const output = execFileSync('claude', ['plugin', 'list', '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as string;
    const parsed = JSON.parse(output) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : ((parsed as { plugins?: unknown[] })?.plugins ?? []);
    const pluginEntries = entries.filter((entry) => {
      const name = (entry as { name?: unknown })?.name;
      return name === 'agent-gauntlet';
    });
    if (
      pluginEntries.some(
        (entry) => (entry as { scope?: unknown }).scope === 'project',
      )
    ) {
      return 'project';
    }
    if (
      pluginEntries.some(
        (entry) => (entry as { scope?: unknown }).scope === 'user',
      )
    ) {
      return 'user';
    }
  } catch {
    // Fall back to user scope for reruns when list output is unavailable.
  }
  return 'user';
}

export async function installClaudePluginWithFallback(
  installScope: 'user' | 'project',
): Promise<void> {
  const addResult = await addMarketplace();
  if (!addResult.success) {
    warnClaudePluginInstallFailure(installScope, addResult.stderr);
    return;
  }

  const installResult = await installPlugin(installScope);
  if (!installResult.success) {
    warnClaudePluginInstallFailure(installScope, installResult.stderr);
  }
}

function warnClaudePluginInstallFailure(
  installScope: 'user' | 'project',
  stderr?: string,
): void {
  console.warn(chalk.yellow('Plugin installation failed. Continuing init.'));
  if (stderr) {
    console.warn(chalk.yellow(stderr.trim()));
  }
  console.warn('Run these commands manually:');
  console.warn('  claude plugin marketplace add pcaplan/agent-gauntlet');
  console.warn(
    `  claude plugin install agent-gauntlet --scope ${installScope}`,
  );
}

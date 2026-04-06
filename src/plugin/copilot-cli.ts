import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CopilotCliResult {
  success: boolean;
  stderr?: string;
}

export async function installPlugin(): Promise<CopilotCliResult> {
  try {
    execFileSync(
      'copilot',
      ['plugin', 'install', 'Codagent-AI/agent-validator'],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
      },
    );
    return { success: true };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
    let stderr = err.message;
    if (typeof err.stderr === 'string') {
      stderr = err.stderr;
    } else if (err.stderr instanceof Buffer) {
      stderr = err.stderr.toString('utf-8');
    }
    return { success: false, stderr: stderr.trim() };
  }
}

/**
 * Detect if the agent-validator or agent-gauntlet plugin is installed
 * by reading ~/.copilot/config.json.
 *
 * @param homeDir - Override for the home directory (defaults to os.homedir()).
 *                  Used for testing with isolated temp directories.
 * @returns 'user' if found, null otherwise. Copilot only supports user scope.
 */
export async function detectPlugin(homeDir?: string): Promise<'user' | null> {
  try {
    const home = homeDir ?? os.homedir();
    const configPath = path.join(home, '.copilot', 'config.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as {
      installed_plugins?: Array<{ name?: string }>;
    };
    const plugins = config.installed_plugins ?? [];
    const found = plugins.some(
      (p) => p.name === 'agent-validator' || p.name === 'agent-gauntlet',
    );
    return found ? 'user' : null;
  } catch {
    return null;
  }
}

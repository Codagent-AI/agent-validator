import { execFileSync } from 'node:child_process';

export interface ClaudeCliResult {
  success: boolean;
  stderr?: string;
}

interface ClaudeCommandResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
}

function runClaudeCommand(args: string[]): ClaudeCommandResult {
  try {
    const stdout = execFileSync('claude', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as string;
    return { success: true, stdout };
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

function runClaudePluginCommand(args: string[]): ClaudeCliResult {
  const result = runClaudeCommand(args);
  return {
    success: result.success,
    stderr: result.stderr,
  };
}

export async function addMarketplace(): Promise<ClaudeCliResult> {
  return runClaudePluginCommand([
    'plugin',
    'marketplace',
    'add',
    'pcaplan/agent-gauntlet',
  ]);
}

export async function installPlugin(
  scope: 'user' | 'project',
): Promise<ClaudeCliResult> {
  return runClaudePluginCommand([
    'plugin',
    'install',
    'agent-gauntlet',
    '--scope',
    scope,
  ]);
}

export async function listPlugins(): Promise<unknown[]> {
  const result = runClaudeCommand(['plugin', 'list', '--json']);
  if (!result.success) {
    throw new Error(result.stderr ?? 'Failed to list Claude plugins');
  }

  try {
    const parsed = JSON.parse(result.stdout ?? '') as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return ((parsed as { plugins?: unknown[] })?.plugins ?? []) as unknown[];
  } catch {
    throw new Error('Failed to parse `claude plugin list --json` output');
  }
}

export async function updateMarketplace(): Promise<ClaudeCliResult> {
  return runClaudePluginCommand([
    'plugin',
    'marketplace',
    'update',
    'agent-gauntlet',
  ]);
}

export async function updatePlugin(): Promise<ClaudeCliResult> {
  return runClaudePluginCommand([
    'plugin',
    'update',
    'agent-gauntlet@pcaplan/agent-gauntlet',
  ]);
}

import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_BUFFER_BYTES } from '../constants.js';
import {
  addMarketplace,
  installPlugin as installPluginCli,
  listPlugins,
} from '../plugin/claude-cli.js';
import { buildOtelEnv, safeExtractOtelMetrics } from './claude-otel.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';
import { CLAUDE_THINKING_TOKENS } from './thinking-budget.js';

const execAsync = promisify(exec);

// Re-export OTel functions for consumers that import from claude.ts
export {
  classifyBlock,
  countBraceChange,
  extractOtelMetrics,
  type ScanResult,
  scanOtelBlocks,
} from './claude-otel.js';

const POST_PROCESS_BUFFER_MS = 30_000;

export class ClaudeAdapter implements CLIAdapter {
  name = 'claude';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which claude');
      return true;
    } catch {
      return false;
    }
  }

  async checkHealth(): Promise<{
    available: boolean;
    status: 'healthy' | 'missing' | 'unhealthy';
    message?: string;
  }> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        available: false,
        status: 'missing',
        message: 'Command not found',
      };
    }

    return { available: true, status: 'healthy', message: 'Ready' };
  }

  getProjectCommandDir(): string | null {
    return '.claude/commands';
  }

  getUserCommandDir(): string | null {
    return path.join(os.homedir(), '.claude', 'commands');
  }

  getProjectSkillDir(): string | null {
    return '.claude/skills';
  }

  getUserSkillDir(): string | null {
    return path.join(os.homedir(), '.claude', 'skills');
  }

  getCommandExtension(): string {
    return '.md';
  }

  canUseSymlink(): boolean {
    return true;
  }

  transformCommand(markdownContent: string): string {
    return markdownContent;
  }

  supportsHooks(): boolean {
    return true;
  }

  async detectPlugin(projectRoot: string): Promise<'user' | 'project' | null> {
    try {
      const entries = await listPlugins();
      const pluginEntries = entries.filter((entry) => {
        const e = entry as { name?: unknown; id?: unknown };
        const name = e.name ?? e.id;
        return (
          name === 'agent-validator' ||
          name === 'agent-gauntlet' ||
          (typeof name === 'string' &&
            (name.startsWith('agent-validator@') ||
              name.startsWith('agent-gauntlet@')))
        );
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

  async installPlugin(
    scope: 'user' | 'project',
    _projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const addResult = await addMarketplace();
    if (!addResult.success) {
      return { success: false, error: addResult.stderr };
    }

    const installResult = await installPluginCli(scope);
    if (!installResult.success) {
      return { success: false, error: installResult.stderr };
    }

    return { success: true };
  }

  getManualInstallInstructions(scope: 'user' | 'project'): string[] {
    return [
      'claude plugin marketplace add pacaplan/agent-validator',
      `claude plugin install agent-validator --scope ${scope}`,
    ];
  }

  async execute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
    allowToolUse?: boolean;
    thinkingBudget?: string;
  }): Promise<string> {
    const totalTimeout = (opts.timeoutMs ?? 300_000) + POST_PROCESS_BUFFER_MS;
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      this.doExecute(opts).finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'Adapter execution timed out (post-processing exceeded limit)',
              ),
            ),
          totalTimeout,
        );
      }),
    ]);
  }

  private async doExecute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
    allowToolUse?: boolean;
    thinkingBudget?: string;
  }): Promise<string> {
    const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

    const tmpFile = path.join(
      os.tmpdir(),
      `validator-claude-${process.pid}-${Date.now()}.txt`,
    );
    await fs.writeFile(tmpFile, fullContent);

    const args = ['-p'];
    // Task is always allowed so Claude can dispatch pr-review-toolkit
    // subagents. allow_tool_use only controls file-reading tools
    // (Read, Glob, Grep) which increase token usage without improving
    // review quality.
    if (opts.allowToolUse === false) {
      args.push('--allowedTools', 'Task');
    } else {
      args.push('--allowedTools', 'Read,Glob,Grep,Task');
    }
    args.push('--max-turns', '25');

    const otelEnv = buildOtelEnv();
    const thinkingEnv: Record<string, string> = {};
    if (opts.thinkingBudget && opts.thinkingBudget in CLAUDE_THINKING_TOKENS) {
      thinkingEnv.MAX_THINKING_TOKENS = String(
        CLAUDE_THINKING_TOKENS[opts.thinkingBudget],
      );
    }

    const cleanup = () => fs.unlink(tmpFile).catch(() => {});
    // Exclude CLAUDECODE so the child doesn't hit the nesting guard
    const { CLAUDECODE: _, ...parentEnv } = process.env;
    const execEnv = {
      ...parentEnv,
      ...otelEnv,
      ...thinkingEnv,
    };

    if (opts.onOutput) {
      const raw = await runStreamingCommand({
        command: 'claude',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        cleanup,
        env: execEnv,
      });
      const cleaned = safeExtractOtelMetrics(raw, opts.onOutput);
      opts.onOutput(cleaned);
      return cleaned;
    }

    try {
      const cmd = `cat "${tmpFile}" | claude ${args.map((a) => (a === '' ? '""' : a)).join(' ')}`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: execEnv,
      });
      return safeExtractOtelMetrics(stdout);
    } finally {
      await cleanup();
    }
  }
}

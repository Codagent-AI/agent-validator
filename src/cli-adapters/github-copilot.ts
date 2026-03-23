import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_BUFFER_BYTES } from '../constants.js';
import {
  detectPlugin as detectCopilotPlugin,
  installPlugin as installCopilotPlugin,
} from '../plugin/copilot-cli.js';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';

// Module-level counter for unique tmp file names across parallel invocations
let _tmpCounter = 0;

/** Effort levels supported by `gh copilot -- --effort`. */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high']);

export class GitHubCopilotAdapter implements CLIAdapter {
  name = 'github-copilot';

  async isAvailable(): Promise<boolean> {
    try {
      await new Promise<string>((resolve, reject) => {
        exec('gh copilot -- --help', { timeout: 10_000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
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
    // GitHub Copilot CLI does not support custom commands
    return null;
  }

  getUserCommandDir(): string | null {
    // GitHub Copilot CLI does not support custom commands
    return null;
  }

  getProjectSkillDir(): string | null {
    return '.github/skills';
  }

  getUserSkillDir(): string | null {
    return path.join(os.homedir(), '.copilot', 'skills');
  }

  getCommandExtension(): string {
    return '.md';
  }

  canUseSymlink(): boolean {
    // Not applicable - no command directory support
    return false;
  }

  transformCommand(markdownContent: string): string {
    // Not applicable - no command directory support
    return markdownContent;
  }

  supportsHooks(): boolean {
    return true;
  }

  async detectPlugin(_projectRoot: string): Promise<'user' | 'project' | null> {
    return detectCopilotPlugin();
  }

  async installPlugin(
    _scope: 'user' | 'project',
    _projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await installCopilotPlugin();
    if (!result.success) {
      return { success: false, error: result.stderr };
    }
    return { success: true };
  }

  async updatePlugin(
    scope: 'user' | 'project',
    projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.installPlugin(scope, projectRoot);
  }

  getManualInstallInstructions(_scope: 'user' | 'project'): string[] {
    return ['gh copilot -- plugin install Codagent-AI/agent-validator'];
  }

  /** Build CLI args: -s, optional --allow-tool, --model, --effort flags. */
  private buildArgs(opts: {
    allowToolUse?: boolean;
    model?: string;
    thinkingBudget?: string;
  }): string[] {
    // The -s (silent) flag suppresses UI output and returns only the agent response.
    const args = ['-s'];

    // Tool whitelist: cat/grep/ls/find/head/tail are read-only tools for code review.
    if (opts.allowToolUse !== false) {
      args.push(
        '--allow-tool',
        'shell(cat)',
        '--allow-tool',
        'shell(grep)',
        '--allow-tool',
        'shell(ls)',
        '--allow-tool',
        'shell(find)',
        '--allow-tool',
        'shell(head)',
        '--allow-tool',
        'shell(tail)',
      );
    }

    if (opts.model && SAFE_MODEL_ID_PATTERN.test(opts.model)) {
      args.push('--model', opts.model);
    }
    if (opts.thinkingBudget && EFFORT_LEVELS.has(opts.thinkingBudget)) {
      args.push('--effort', opts.thinkingBudget);
    }
    return args;
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
    const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

    const tmpDir = os.tmpdir();
    // Include process.pid and a counter for uniqueness across concurrent invocations
    const tmpFile = path.join(
      tmpDir,
      `validator-copilot-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`,
    );
    await fs.writeFile(tmpFile, fullContent);

    const args = this.buildArgs(opts);
    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    if (opts.onOutput) {
      return runStreamingCommand({
        command: 'gh',
        args: ['copilot', '--', ...args],
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
        cleanup,
      });
    }

    // Uses exec() directly (instead of promisify) so that
    // spyOn(childProcess, "exec") can intercept calls in tests.
    try {
      const argsStr = args
        .map((a) => (a.includes('(') ? `"${a}"` : a))
        .join(' ');
      const cmd = `cat "${tmpFile}" | gh copilot -- ${argsStr}`;
      const stdout = await new Promise<string>((resolve, reject) => {
        exec(
          cmd,
          { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES },
          (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
          },
        );
      });
      return stdout;
    } finally {
      await cleanup();
    }
  }
}

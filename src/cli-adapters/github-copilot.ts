import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { getCategoryLogger } from '../output/app-logger.js';
import {
  resolveModelFromList,
  SAFE_MODEL_ID_PATTERN,
} from './model-resolution.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';

const execAsync = promisify(exec);

// Module-level counter for unique tmp file names across parallel invocations
let _tmpCounter = 0;

const log = getCategoryLogger('github-copilot');

/**
 * Parse `copilot --help` output to extract model choices.
 * The help output includes a section like:
 *   --model <model>  Choose a model (choices: "gpt-5.3-codex", "gpt-5.2-codex", "opus-4.6")
 */
function parseCopilotModels(helpOutput: string): string[] {
  const match = helpOutput.match(/choices:\s*(.+?)\)/);
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
}

export class GitHubCopilotAdapter implements CLIAdapter {
  name = 'github-copilot';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which copilot');
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
    // GitHub Copilot CLI does not support custom commands (feature request #618)
    return null;
  }

  getUserCommandDir(): string | null {
    // GitHub Copilot CLI does not support custom commands (feature request #618)
    return null;
  }

  getProjectSkillDir(): string | null {
    return null;
  }

  getUserSkillDir(): string | null {
    return null;
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
    return false;
  }

  /**
   * Resolve a base model name to a specific model ID using `copilot --help`.
   * Returns undefined if resolution fails or no matching model is found.
   *
   * Uses exec() directly (instead of the module-level execAsync) so that
   * spyOn(childProcess, "exec") can intercept calls in tests.
   */
  private async resolveModel(
    baseName: string,
    _thinkingBudget?: string,
  ): Promise<string | undefined> {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        exec('copilot --help', { timeout: 10000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const models = parseCopilotModels(stdout);
      // Copilot has NO thinking variants, so always pass preferThinking: false
      const resolved = resolveModelFromList(models, {
        baseName,
        preferThinking: false,
      });
      if (resolved === undefined) {
        log.warn(`No matching model found for "${baseName}"`);
        return undefined;
      }
      if (!SAFE_MODEL_ID_PATTERN.test(resolved)) {
        log.warn(`Resolved model "${resolved}" contains unsafe characters`);
        return undefined;
      }
      return resolved;
    } catch (err) {
      log.warn(
        `Failed to resolve model "${baseName}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  async execute(opts: {
    prompt: string;
    diff: string;
    model?: string;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
    thinkingBudget?: string;
  }): Promise<string> {
    const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

    const tmpDir = os.tmpdir();
    // Include process.pid and a counter for uniqueness across concurrent invocations
    // in the same process (parallel review gates can call execute() within the same
    // millisecond, causing Date.now() collisions and tmp file overwrites).
    const tmpFile = path.join(
      tmpDir,
      `gauntlet-copilot-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`,
    );
    await fs.writeFile(tmpFile, fullContent);

    // Copilot reads from stdin when no -p flag is provided
    // Tool whitelist: cat/grep/ls/find/head/tail are required for the AI to read
    // and analyze code files during review. While these tools can access files,
    // they are read-only and necessary for code review functionality.
    // The copilot CLI is scoped to the repo directory by default.
    // git is excluded to prevent access to commit history (review should only see diff).

    // Resolve model if a base name is provided
    let resolvedModel: string | undefined;
    if (opts.model) {
      resolvedModel = await this.resolveModel(opts.model, opts.thinkingBudget);
    }

    const args = [
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
    ];
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    // If onOutput callback is provided, use spawn for real-time streaming
    if (opts.onOutput) {
      return runStreamingCommand({
        command: 'copilot',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
        cleanup,
      });
    }

    // Otherwise use exec for buffered output
    // Shell command construction: We use exec() with shell piping instead of execFile()
    // because copilot requires stdin input. The tmpFile path is system-controlled
    // (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
    // Double quotes handle paths with spaces. This pattern matches claude.ts:131.
    try {
      const argsStr = args
        .map((a) => (a.includes('(') ? `"${a}"` : a))
        .join(' ');
      const cmd = `cat "${tmpFile}" | copilot ${argsStr}`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return stdout;
    } finally {
      // Cleanup errors are intentionally ignored - the tmp file will be cleaned up by OS
      await cleanup();
    }
  }
}

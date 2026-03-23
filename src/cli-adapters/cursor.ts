import { exec } from 'node:child_process';
import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const log = getCategoryLogger('cursor');

/**
 * Parse `agent --list-models` output into an array of model IDs.
 * Each line has the format: "model-id - Display Name"
 */
function parseModelList(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const dashIndex = line.indexOf(' - ');
      return dashIndex >= 0 ? line.substring(0, dashIndex).trim() : line.trim();
    })
    .filter((id) => id.length > 0);
}

export class CursorAdapter implements CLIAdapter {
  name = 'cursor';

  async isAvailable(): Promise<boolean> {
    try {
      // Note: Cursor's CLI binary is named "agent", not "cursor"
      await execAsync('which agent');
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
    // Cursor does not support custom commands
    return null;
  }

  getUserCommandDir(): string | null {
    // Cursor does not support custom commands
    return null;
  }

  getProjectSkillDir(): string | null {
    return '.cursor/skills';
  }

  getUserSkillDir(): string | null {
    return path.join(os.homedir(), '.cursor', 'skills');
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

  /**
   * Resolve a base model name to a specific model ID using `agent --list-models`.
   * Returns undefined if resolution fails or no matching model is found.
   *
   * Uses exec() directly (instead of the module-level execAsync) so that
   * spyOn(childProcess, "exec") can intercept calls in tests.
   */
  private async resolveModel(
    baseName: string,
    thinkingBudget?: string,
  ): Promise<string | undefined> {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        exec('agent --list-models', { timeout: 10000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const models = parseModelList(stdout);
      const preferThinking =
        thinkingBudget !== undefined && thinkingBudget !== 'off';
      const resolved = resolveModelFromList(models, {
        baseName,
        preferThinking,
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
      `validator-cursor-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`,
    );
    await fs.writeFile(tmpFile, fullContent);

    // Cursor agent command reads from stdin
    // Note: As of the current version, the Cursor 'agent' CLI does not expose
    // flags for restricting tools or enforcing read-only mode (unlike claude's --allowedTools
    // or codex's --sandbox read-only). The agent is assumed to be repo-scoped and
    // safe for code review use. If Cursor adds such flags in the future, they should
    // be added here for defense-in-depth.

    // Resolve model if a base name is provided
    let resolvedModel: string | undefined;
    if (opts.model) {
      resolvedModel = await this.resolveModel(opts.model, opts.thinkingBudget);
    }

    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    // Build args with optional --model flag
    const args = ['--trust'];
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    // If onOutput callback is provided, use spawn for real-time streaming
    if (opts.onOutput) {
      return runStreamingCommand({
        command: 'agent',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
        cleanup,
      });
    }

    // Otherwise use exec for buffered output
    // Shell command construction: We use exec() with shell piping
    // because the agent requires stdin input. The tmpFile path is system-controlled
    // (os.tmpdir() + Date.now() + process.pid), not user-supplied, eliminating injection risk.
    // Double quotes handle paths with spaces.
    try {
      const modelFlag = resolvedModel ? ` --model ${resolvedModel}` : '';
      const cmd = `cat "${tmpFile}" | agent --trust${modelFlag}`;
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

  async detectPlugin(projectRoot: string): Promise<'user' | 'project' | null> {
    // Check project scope — new and legacy plugin directory names
    for (const pluginName of ['agent-validator', 'agent-gauntlet']) {
      const projectPluginPath = path.join(
        projectRoot,
        '.cursor',
        'plugins',
        pluginName,
        '.cursor-plugin',
        'plugin.json',
      );
      try {
        await fs.access(projectPluginPath);
        return 'project';
      } catch {}
    }

    // Check user scope — new and legacy plugin directory names
    for (const pluginName of ['agent-validator', 'agent-gauntlet']) {
      const userPluginPath = path.join(
        os.homedir(),
        '.cursor',
        'plugins',
        pluginName,
        '.cursor-plugin',
        'plugin.json',
      );
      try {
        await fs.access(userPluginPath);
        return 'user';
      } catch {}
    }

    return null;
  }

  async installPlugin(
    scope: 'user' | 'project',
    projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const baseDir =
        scope === 'user'
          ? path.join(os.homedir(), '.cursor', 'plugins', 'agent-validator')
          : path.join(
              projectRoot ?? '.',
              '.cursor',
              'plugins',
              'agent-validator',
            );

      // Find package root (where .cursor-plugin/ lives)
      const packageRoot = this.findPackageRoot();

      // Copy plugin assets: .cursor-plugin/, skills/, hooks/cursor-hooks.json
      await this.copyPluginAssets(packageRoot, baseDir);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async updatePlugin(
    scope: 'user' | 'project',
    projectRoot?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.installPlugin(scope, projectRoot);
  }

  getManualInstallInstructions(scope: 'user' | 'project'): string[] {
    const targetDir =
      scope === 'user'
        ? '~/.cursor/plugins/agent-validator/'
        : '.cursor/plugins/agent-validator/';
    return [
      `Copy plugin files to ${targetDir}`,
      'Or install via /add-plugin in Cursor or at the Cursor marketplace',
    ];
  }

  private findPackageRoot(): string {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    // Bundled: moduleDir is dist/ (one level below root)
    const bundled = path.join(moduleDir, '..');
    // Dev: moduleDir is src/cli-adapters/ (two levels below root)
    const dev = path.join(moduleDir, '..', '..');

    try {
      statSync(path.join(bundled, '.cursor-plugin', 'plugin.json'));
      return bundled;
    } catch {
      return dev;
    }
  }

  private async copyPluginAssets(
    packageRoot: string,
    targetDir: string,
  ): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });

    // Copy .cursor-plugin/
    const pluginSrc = path.join(packageRoot, '.cursor-plugin');
    const pluginDest = path.join(targetDir, '.cursor-plugin');
    await this.copyDirRecursive(pluginSrc, pluginDest);

    // Copy skills/
    const skillsSrc = path.join(packageRoot, 'skills');
    const skillsDest = path.join(targetDir, 'skills');
    await this.copyDirRecursive(skillsSrc, skillsDest);

    // Copy hooks/cursor-hooks.json
    const hooksSrc = path.join(packageRoot, 'hooks', 'cursor-hooks.json');
    const hooksDest = path.join(targetDir, 'hooks');
    await fs.mkdir(hooksDest, { recursive: true });
    await fs.copyFile(hooksSrc, path.join(hooksDest, 'hooks.json'));
  }

  private async copyDirRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

import { exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCategoryLogger } from '../output/app-logger.js';
import {
  detectPlugin as detectCopilotPlugin,
  installPlugin as installCopilotPlugin,
} from '../plugin/copilot-cli.js';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';
import type { CLIAdapter } from './shared.js';

let tmpCounter = 0;

const log = getCategoryLogger('github-copilot');

/** Effort levels supported by `copilot --effort`. */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high']);

/**
 * Parse the copilot session summary printed to stdout after the response.
 * Returns a structured telemetry line or undefined if no summary is found.
 *
 * Example summary block:
 *   Total usage est:        2 Premium requests
 *   Breakdown by AI model:
 *    gpt-5.4                  17.7k in, 45 out, 1.5k cached (Est. 1 Premium request)
 *    claude-haiku-4.5         41.4k in, 123 out, 0 cached (Est. 1 Premium request)
 */
export function parseCopilotSessionSummary(
  output: string,
): { telemetryLine: string; model: string } | undefined {
  const premiumMatch = output.match(
    /Total usage est:\s+(\d+)\s+Premium request/i,
  );
  if (!premiumMatch) return undefined;

  const premiumRequests = Number(premiumMatch[1]);

  // Parse per-model token lines: " <model>  <N>k in, <N> out, <N>k cached"
  const modelLines = [
    ...output.matchAll(
      /^\s+(\S+)\s+([\d.]+)k? in,\s*([\d.]+)k? out(?:,\s*([\d.]+)k? cached)?/gm,
    ),
  ];

  let totalIn = 0;
  let totalOut = 0;
  let totalCached = 0;
  const models: string[] = [];

  for (const m of modelLines) {
    const [fullMatch, model, inRaw, outRaw, cachedRaw] = m;
    if (!(model && inRaw && outRaw)) continue;
    const toTokens = (val: string) =>
      fullMatch.includes(`${val}k`)
        ? Math.round(Number(val) * 1000)
        : Number(val);
    totalIn += toTokens(inRaw);
    totalOut += toTokens(outRaw);
    if (cachedRaw) totalCached += toTokens(cachedRaw);
    models.push(model);
  }

  const model = models.join(',') || 'unknown';
  const telemetryLine = `[copilot-telemetry] model=${model} in=${totalIn} out=${totalOut} cache=${totalCached} premium_requests=${premiumRequests}`;
  return { telemetryLine, model };
}

/**
 * Throws if a specific model was requested but the session summary shows a
 * different model was actually used. Prevents silent fallback to a default
 * model when the requested model is unavailable.
 */
function assertModelUsed(requested: string | undefined, actual: string): void {
  if (!requested) return;
  // actual may be a comma-separated list when multiple models were used in one session
  const actualModels = actual.split(',').map((m) => m.trim().toLowerCase());
  const req = requested.toLowerCase();
  if (!actualModels.some((m) => m.includes(req) || req.includes(m))) {
    throw new Error(
      `Model mismatch: requested "${requested}" but copilot used "${actual}". ` +
        `The requested model may not be available on this account.`,
    );
  }
}

/**
 * Verify the model from a parsed copilot session summary.
 * Throws if a model was requested but cannot be verified.
 * Logs debug when model is unknown and no specific model was requested.
 */
function verifySessionModel(
  summary: { telemetryLine: string; model: string },
  requestedModel: string | undefined,
): void {
  if (summary.model === 'unknown') {
    if (requestedModel) {
      throw new Error(
        'Unable to verify Copilot model from session summary — cannot confirm the requested model was used',
      );
    }
    log.debug(
      'copilot session summary found but no model lines parsed — skipping model assertion',
    );
  } else {
    assertModelUsed(requestedModel, summary.model);
  }
}

function isMissingCommandError(error: unknown): boolean {
  const err = error as {
    code?: string;
    stderr?: string;
    stdout?: string;
    message?: string;
  };
  const detail = `${err.stderr ?? ''}\n${err.stdout ?? ''}\n${err.message ?? ''}`;
  return (
    err.code === 'ENOENT' ||
    /command not found|not recognized|no such file|not found/i.test(detail)
  );
}

export class GitHubCopilotAdapter implements CLIAdapter {
  name = 'github-copilot';

  private execCopilot(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 10_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stdout,
              stderr,
            }),
          );
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.execCopilot('copilot --help');
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
    try {
      await this.execCopilot('copilot --help');
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      if (isMissingCommandError(error)) {
        return {
          available: false,
          status: 'missing',
          message: 'Command not found',
        };
      }
      return {
        available: true,
        status: 'unhealthy',
        message: (err.stderr || err.message || 'Unhealthy').trim(),
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
    return ['copilot plugin install Codagent-AI/agent-validator'];
  }

  /** Build CLI args: prompt-file handoff plus optional reviewer tools, model, and effort flags. */
  private buildArgs(opts: {
    allowToolUse?: boolean;
    model?: string;
    promptFile: string;
    thinkingBudget?: string;
  }): string[] {
    const args: string[] = [];
    const allowedTools = new Set<string>(['shell(cat)']);

    // Tool whitelist: cat/grep/ls/find/head/tail are read-only tools for code review.
    // shell(cat) is also the transport used for Copilot's non-interactive mode:
    // the CLI does not accept stdin as a prompt, so --prompt points it at the
    // secure temp file instead of embedding the full diff in argv.
    if (opts.allowToolUse !== false) {
      for (const tool of [
        'shell(grep)',
        'shell(ls)',
        'shell(find)',
        'shell(head)',
        'shell(tail)',
      ]) {
        allowedTools.add(tool);
      }
    }

    for (const tool of allowedTools) {
      args.push('--allow-tool', tool);
    }

    if (opts.model && SAFE_MODEL_ID_PATTERN.test(opts.model)) {
      args.push('--model', opts.model);
    }
    if (opts.thinkingBudget && EFFORT_LEVELS.has(opts.thinkingBudget)) {
      args.push('--effort', opts.thinkingBudget);
    }
    args.push('--add-dir', path.dirname(opts.promptFile));
    args.push('--prompt', this.buildPromptFileInstruction(opts.promptFile));
    return args;
  }

  private buildPromptFileInstruction(promptFile: string): string {
    return [
      'Read the complete review request from this exact file using shell(cat):',
      promptFile,
      'Then follow the instructions in that file exactly. Do not answer until you have read it.',
    ].join('\n');
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
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'validator-copilot-'),
    );
    const tmpFile = path.join(tmpDir, `prompt-${tmpCounter++}.txt`);
    await fs.writeFile(tmpFile, fullContent, { flag: 'wx', mode: 0o600 });

    const args = this.buildArgs({
      ...opts,
      model: opts.model,
      promptFile: tmpFile,
    });
    const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });

    log.debug(`copilot args: ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await this.runCopilot({
        args,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
      });
      const summary = parseCopilotSessionSummary(stderr);
      if (summary) {
        opts.onOutput?.(summary.telemetryLine);
        log.debug(`copilot session: ${summary.telemetryLine}`);
        verifySessionModel(summary, opts.model);
      }
      return stdout;
    } finally {
      await cleanup();
    }
  }

  private async runCopilot(opts: {
    args: string[];
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
  }): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const child = spawn('copilot', opts.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      const settle = async (
        callback: () => void,
        timeoutId?: ReturnType<typeof setTimeout>,
      ) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        callback();
      };

      const timeoutId = opts.timeoutMs
        ? setTimeout(() => {
            child.kill('SIGTERM');
            void settle(() => reject(new Error('Command timed out')));
          }, opts.timeoutMs)
        : undefined;

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdoutChunks.push(chunk);
        opts.onOutput?.(chunk);
      });
      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderrChunks.push(chunk);
        opts.onOutput?.(chunk);
      });
      child.on('close', (code, signal) => {
        void settle(() => {
          const stdout = stdoutChunks.join('');
          const stderr = stderrChunks.join('');
          if (signal) {
            reject(new Error(`Process terminated by signal ${signal}`));
          } else if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(
              new Error(
                `Process exited with code ${code}${stderr ? `\n${stderr}` : ''}`,
              ),
            );
          }
        }, timeoutId);
      });
      child.on('error', (error) => {
        void settle(() => reject(error), timeoutId);
      });
    });
  }
}

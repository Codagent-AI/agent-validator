import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { getCategoryLogger } from '../output/app-logger.js';
import {
  detectPlugin as detectCopilotPlugin,
  installPlugin as installCopilotPlugin,
} from '../plugin/copilot-cli.js';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';

// Module-level counter for unique tmp file names across parallel invocations
let _tmpCounter = 0;

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

export class GitHubCopilotAdapter implements CLIAdapter {
  name = 'github-copilot';

  async isAvailable(): Promise<boolean> {
    try {
      await new Promise<string>((resolve, reject) => {
        exec('copilot --help', { timeout: 10_000 }, (error, stdout) => {
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
    return ['copilot plugin install Codagent-AI/agent-validator'];
  }

  /** Build CLI args: -s, optional --allow-tool, --model, --effort flags. */
  private buildArgs(opts: {
    allowToolUse?: boolean;
    model?: string;
    thinkingBudget?: string;
  }): string[] {
    const args: string[] = [];

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

    const args = this.buildArgs({
      ...opts,
      model: opts.model,
    });
    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    log.debug(`copilot args: ${args.join(' ')}`);

    if (opts.onOutput) {
      // Collect stderr separately to parse the session summary (printed to stderr by copilot).
      // stderr is also forwarded to onOutput by runStreamingCommand via collectStderr.
      const stderrChunks: string[] = [];
      const wrappedOnOutput = (chunk: string) => {
        stderrChunks.push(chunk);
        opts.onOutput?.(chunk);
      };
      const raw = await runStreamingCommand({
        command: 'copilot',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: wrappedOnOutput,
        cleanup,
      });
      const summary = parseCopilotSessionSummary(stderrChunks.join(''));
      if (summary) {
        opts.onOutput(summary.telemetryLine);
        log.debug(`copilot session: ${summary.telemetryLine}`);
        if (summary.model !== 'unknown') {
          assertModelUsed(opts.model, summary.model);
        } else {
          log.debug('copilot session summary found but no model lines parsed — skipping model assertion');
        }
      }
      return raw;
    }

    // Uses exec() directly (instead of promisify) so that
    // spyOn(childProcess, "exec") can intercept calls in tests.
    try {
      const argsStr = args
        .map((a) => (a.includes('(') ? `"${a}"` : a))
        .join(' ');
      const cmd = `cat "${tmpFile}" | copilot ${argsStr}`;
      const { stdout, stderr } = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        exec(
          cmd,
          { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES },
          (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
          },
        );
      });
      const summary = parseCopilotSessionSummary(stderr);
      if (summary) {
        log.debug(`copilot session: ${summary.telemetryLine}`);
        if (summary.model !== 'unknown') {
          assertModelUsed(opts.model, summary.model);
        } else {
          log.debug('copilot session summary found but no model lines parsed — skipping model assertion');
        }
      }
      return stdout;
    } finally {
      await cleanup();
    }
  }
}

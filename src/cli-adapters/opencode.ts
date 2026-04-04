import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { getDebugLogger } from '../utils/debug-log.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';
import { OPENCODE_VARIANT } from './thinking-budget.js';

const execAsync = promisify(exec);

// Well-known install path used by the opencode installer script
const OPENCODE_DEFAULT_BIN = path.join(
  os.homedir(),
  '.opencode',
  'bin',
  'opencode',
);

// Module-level counter for unique tmp file names across parallel invocations
let _tmpCounter = 0;

/** Resolve the opencode binary path: check PATH first, then the well-known install location. */
async function resolveOpenCodeBin(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('which opencode');
    return stdout.trim();
  } catch {
    // Not on PATH — check the default install location
  }
  try {
    await fs.access(OPENCODE_DEFAULT_BIN, 0x1 /* fs.constants.X_OK */);
    return OPENCODE_DEFAULT_BIN;
  } catch {
    return null;
  }
}

interface OpenCodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  toolCalls?: number;
  apiRequests?: number;
}

/** Parse a single JSONL line into a typed event, or undefined on failure. */
function parseJsonlLine(
  line: string,
): { type: string; [key: string]: unknown } | undefined {
  try {
    const obj = JSON.parse(line);
    if (obj && typeof obj.type === 'string') return obj;
  } catch {
    /* skip malformed lines */
  }
  return undefined;
}

/** Accumulate a step_finish event's token usage into totals. */
function accumulateStepUsage(
  event: { type: string; [key: string]: unknown },
  usage: OpenCodeUsage,
): void {
  const part = event.part as
    | { tokens?: Record<string, number | Record<string, number>> }
    | undefined;
  const tokens = part?.tokens;
  if (!tokens) return;

  usage.apiRequests = (usage.apiRequests || 0) + 1;

  if (typeof tokens.input === 'number') {
    usage.inputTokens = (usage.inputTokens || 0) + tokens.input;
  }
  if (typeof tokens.output === 'number') {
    usage.outputTokens = (usage.outputTokens || 0) + tokens.output;
  }
  if (typeof tokens.reasoning === 'number') {
    usage.reasoningTokens = (usage.reasoningTokens || 0) + tokens.reasoning;
  }
  const cache = tokens.cache as Record<string, number> | undefined;
  if (cache) {
    if (typeof cache.write === 'number') {
      usage.cacheWriteTokens = (usage.cacheWriteTokens || 0) + cache.write;
    }
    if (typeof cache.read === 'number') {
      usage.cacheReadTokens = (usage.cacheReadTokens || 0) + cache.read;
    }
  }
}

/** Check if an event represents a tool call. */
function isToolCallEvent(event: {
  type: string;
  [key: string]: unknown;
}): boolean {
  return event.type === 'tool_start' || event.type === 'tool_use';
}

/** Extract text content from a text event. */
function extractText(event: {
  type: string;
  [key: string]: unknown;
}): string | undefined {
  if (event.type !== 'text') return undefined;
  const part = event.part as { text?: string } | undefined;
  return typeof part?.text === 'string' ? part.text : undefined;
}

const SUMMARY_FIELDS: Array<[keyof OpenCodeUsage, string]> = [
  ['inputTokens', 'in'],
  ['outputTokens', 'out'],
  ['reasoningTokens', 'reasoning'],
  ['cacheWriteTokens', 'cache_write'],
  ['cacheReadTokens', 'cache_read'],
  ['toolCalls', 'tool_calls'],
  ['apiRequests', 'api_requests'],
];

function formatOpenCodeSummary(usage: OpenCodeUsage): string | null {
  const parts = SUMMARY_FIELDS.filter(([key]) => usage[key] !== undefined).map(
    ([key, label]) => `${label}=${usage[key]}`,
  );
  return parts.length > 0 ? `[opencode-telemetry] ${parts.join(' ')}` : null;
}

/** Route a parsed JSONL event to the appropriate handler, returning any text content. */
function processOpenCodeEvent(
  event: { type: string; [key: string]: unknown },
  usage: OpenCodeUsage,
): string | undefined {
  if (event.type === 'step_finish') {
    accumulateStepUsage(event, usage);
    return undefined;
  }
  if (isToolCallEvent(event)) {
    usage.toolCalls = (usage.toolCalls || 0) + 1;
    return undefined;
  }
  return extractText(event);
}

/** Emit a telemetry summary to logs and debug log. */
function emitOpenCodeSummary(
  usage: OpenCodeUsage,
  onLog?: (msg: string) => void,
): void {
  const summary = formatOpenCodeSummary(usage);
  if (!summary) return;
  onLog?.(`\n${summary}\n`);
  process.stderr.write(`${summary}\n`);
  getDebugLogger()?.logTelemetry({ adapter: 'opencode', summary });
}

/**
 * Parse JSONL output from `opencode run --format json`, extracting text
 * content, token usage, and tool call counts.
 */
function parseOpenCodeJsonl(
  raw: string,
  onLog?: (msg: string) => void,
): { text: string; usage: OpenCodeUsage } {
  const usage: OpenCodeUsage = {};
  const textParts: string[] = [];

  for (const line of raw.split('\n')) {
    const event = parseJsonlLine(line.trim());
    if (!event) continue;
    const text = processOpenCodeEvent(event, usage);
    if (text !== undefined) textParts.push(text);
  }

  emitOpenCodeSummary(usage, onLog);
  return { text: textParts.join(''), usage };
}

export class OpenCodeAdapter implements CLIAdapter {
  name = 'opencode';

  /** Cached resolved binary path (null = not yet resolved, empty string = not found). */
  private resolvedBin: string | null = null;

  private async getBin(): Promise<string | null> {
    if (this.resolvedBin === null) {
      this.resolvedBin = (await resolveOpenCodeBin()) ?? '';
    }
    return this.resolvedBin || null;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getBin()) !== null;
  }

  async checkHealth(): Promise<{
    available: boolean;
    status: 'healthy' | 'missing' | 'unhealthy';
    message?: string;
  }> {
    const bin = await this.getBin();
    if (!bin) {
      return {
        available: false,
        status: 'missing',
        message: 'Command not found',
      };
    }

    return { available: true, status: 'healthy', message: 'Installed' };
  }

  getProjectCommandDir(): string | null {
    return null;
  }

  getUserCommandDir(): string | null {
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
    return false;
  }

  transformCommand(markdownContent: string): string {
    return markdownContent;
  }

  supportsHooks(): boolean {
    return false;
  }

  private buildArgs(
    opts: {
      model?: string;
      allowToolUse?: boolean;
      thinkingBudget?: string;
    } = {},
  ): string[] {
    const args = ['run', '--format', 'json'];
    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.allowToolUse === false) {
      // OpenCode CLI does not currently expose a flag to disable tool use.
      // Log a warning so the policy mismatch is visible in stderr.
      process.stderr.write(
        '[opencode] warning: allowToolUse=false requested but OpenCode CLI has no flag to disable tools\n',
      );
    }
    if (opts.thinkingBudget && opts.thinkingBudget in OPENCODE_VARIANT) {
      args.push('--variant', OPENCODE_VARIANT[opts.thinkingBudget] as string);
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
    const bin = await this.getBin();
    if (!bin) {
      throw new Error('opencode binary not found');
    }

    const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(
      tmpDir,
      `validator-opencode-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`,
    );
    await fs.writeFile(tmpFile, fullContent);

    const args = this.buildArgs({
      model: opts.model,
      allowToolUse: opts.allowToolUse,
      thinkingBudget: opts.thinkingBudget,
    });

    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    if (opts.onOutput) {
      // Buffer partial lines so we only forward parsed text content,
      // not raw JSONL protocol events.
      let lineBuf = '';
      const streamingUsage: OpenCodeUsage = {};
      const raw = await runStreamingCommand({
        command: bin,
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: (chunk: string) => {
          lineBuf += chunk;
          const lines = lineBuf.split('\n');
          // Keep the last (possibly incomplete) segment in the buffer
          lineBuf = lines.pop() ?? '';
          for (const line of lines) {
            const event = parseJsonlLine(line.trim());
            if (!event) continue;
            const text = processOpenCodeEvent(event, streamingUsage);
            if (text !== undefined) opts.onOutput?.(text);
          }
        },
        cleanup,
      });

      // Flush any remaining buffered line
      if (lineBuf.trim()) {
        const event = parseJsonlLine(lineBuf.trim());
        if (event) {
          const text = processOpenCodeEvent(event, streamingUsage);
          if (text !== undefined) opts.onOutput?.(text);
        }
      }

      emitOpenCodeSummary(streamingUsage, opts.onOutput);
      const { text } = parseOpenCodeJsonl(raw);
      return text || raw.trimEnd();
    }

    try {
      const quoteArg = (a: string) => `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
      const cmd = `cat "${tmpFile}" | ${quoteArg(bin)} ${args.map(quoteArg).join(' ')}`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      const { text } = parseOpenCodeJsonl(stdout);
      return text || stdout.trimEnd();
    } finally {
      await cleanup();
    }
  }
}

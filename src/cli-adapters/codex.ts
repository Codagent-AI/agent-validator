import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getDebugLogger } from '../utils/debug-log.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';
import { CODEX_REASONING_EFFORT } from './thinking-budget.js';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface CodexUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
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

/** Maps Codex turn usage JSON fields to CodexUsage fields. */
const TURN_USAGE_MAP: Array<[string, keyof CodexUsage]> = [
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['output_tokens', 'outputTokens'],
];

/** Accumulate a turn.completed event's usage into totals. */
function accumulateTurnUsage(
  event: { type: string; [key: string]: unknown },
  usage: CodexUsage,
): void {
  const u = event.usage as Record<string, number | undefined> | undefined;
  if (!u) return;
  usage.apiRequests = (usage.apiRequests || 0) + 1;
  for (const [jsonKey, usageKey] of TURN_USAGE_MAP) {
    if (u[jsonKey] !== undefined) {
      usage[usageKey] = (usage[usageKey] || 0) + (u[jsonKey] ?? 0);
    }
  }
}

/** Check if an item.completed event represents a tool call (command, file, mcp). */
function isToolCallItem(event: {
  type: string;
  [key: string]: unknown;
}): boolean {
  const item = event.item as { type?: string } | undefined;
  if (!item?.type) return false;
  return (
    item.type === 'command_execution' ||
    item.type === 'file_change' ||
    item.type === 'mcp_tool_call'
  );
}

/** Extract the final agent message text from a completed item. */
function extractAgentMessage(event: {
  type: string;
  [key: string]: unknown;
}): string | undefined {
  const item = event.item as { type?: string; text?: string } | undefined;
  if (item?.type === 'agent_message' && typeof item.text === 'string') {
    return item.text;
  }
  return undefined;
}

const SUMMARY_FIELDS: Array<[keyof CodexUsage, string]> = [
  ['inputTokens', 'in'],
  ['cachedInputTokens', 'cache'],
  ['outputTokens', 'out'],
  ['toolCalls', 'tool_calls'],
  ['apiRequests', 'api_requests'],
];

function formatCodexSummary(usage: CodexUsage): string | null {
  const parts = SUMMARY_FIELDS.filter(([key]) => usage[key] !== undefined).map(
    ([key, label]) => `${label}=${usage[key]}`,
  );
  return parts.length > 0 ? `[codex-telemetry] ${parts.join(' ')}` : null;
}

/** Process a single item.completed event, updating usage and returning any agent message. */
function processItemCompleted(
  event: { type: string; [key: string]: unknown },
  usage: CodexUsage,
): string | undefined {
  if (isToolCallItem(event)) {
    usage.toolCalls = (usage.toolCalls || 0) + 1;
  }
  return extractAgentMessage(event);
}

/** Route a parsed JSONL event to the appropriate handler, returning any agent message. */
function processCodexEvent(
  event: { type: string; [key: string]: unknown },
  usage: CodexUsage,
): string | undefined {
  if (event.type === 'turn.completed') {
    accumulateTurnUsage(event, usage);
    return undefined;
  }
  if (event.type === 'item.completed') {
    return processItemCompleted(event, usage);
  }
  return undefined;
}

/** Emit a telemetry summary to logs and debug log. */
function emitCodexSummary(
  usage: CodexUsage,
  onLog?: (msg: string) => void,
): void {
  const summary = formatCodexSummary(usage);
  if (!summary) return;
  onLog?.(`\n${summary}\n`);
  process.stderr.write(`${summary}\n`);
  getDebugLogger()?.logTelemetry({ adapter: 'codex', summary });
}

/**
 * Parse JSONL output from `codex exec --json`, extracting the final agent
 * message, token usage, and tool call counts.
 */
function parseCodexJsonl(
  raw: string,
  onLog?: (msg: string) => void,
): { text: string; usage: CodexUsage } {
  const usage: CodexUsage = {};
  let lastAgentMessage = '';

  for (const line of raw.split('\n')) {
    const event = parseJsonlLine(line.trim());
    if (!event) continue;
    const msg = processCodexEvent(event, usage);
    if (msg !== undefined) lastAgentMessage = msg;
  }

  emitCodexSummary(usage, onLog);
  return { text: lastAgentMessage, usage };
}

export class CodexAdapter implements CLIAdapter {
  name = 'codex';

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which codex');
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

    return { available: true, status: 'healthy', message: 'Installed' };
  }

  getProjectCommandDir(): string | null {
    // Codex only supports user-level prompts at ~/.codex/prompts/
    // No project-scoped commands available
    return null;
  }

  getUserCommandDir(): string | null {
    // Codex uses user-level prompts at ~/.codex/prompts/
    return path.join(os.homedir(), '.codex', 'prompts');
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
    // Codex uses the same Markdown format as our canonical file
    return true;
  }

  transformCommand(markdownContent: string): string {
    // Codex uses the same Markdown format as Claude, no transformation needed
    return markdownContent;
  }

  supportsHooks(): boolean {
    return false;
  }

  private buildArgs(allowToolUse?: boolean, thinkingBudget?: string): string[] {
    const args = [
      'exec',
      '--cd',
      process.cwd(),
      '--sandbox',
      'read-only',
      '-c',
      'ask_for_approval="never"',
    ];
    if (allowToolUse === false) {
      args.push('--disable', 'shell_tool');
    }
    if (thinkingBudget && thinkingBudget in CODEX_REASONING_EFFORT) {
      const effort = CODEX_REASONING_EFFORT[thinkingBudget];
      args.push('-c', `model_reasoning_effort="${effort}"`);
    }
    args.push('--json', '-');
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
    const tmpFile = path.join(tmpDir, `gauntlet-codex-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, fullContent);

    const args = this.buildArgs(opts.allowToolUse, opts.thinkingBudget);

    const cleanup = () => fs.unlink(tmpFile).catch(() => {});

    // If onOutput callback is provided, use spawn for real-time streaming
    if (opts.onOutput) {
      const raw = await runStreamingCommand({
        command: 'codex',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: (chunk: string) => {
          opts.onOutput?.(chunk);
        },
        cleanup,
      });

      const { text } = parseCodexJsonl(raw, opts.onOutput);
      return text || raw.trimEnd();
    }

    // Otherwise use exec for buffered output
    try {
      const quoteArg = (a: string) => `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
      const cmd = `cat "${tmpFile}" | codex ${args.map(quoteArg).join(' ')}`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      const { text } = parseCodexJsonl(stdout);
      return text || stdout.trimEnd();
    } finally {
      await cleanup();
    }
  }
}

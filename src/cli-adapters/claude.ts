import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GAUNTLET_STOP_HOOK_ACTIVE_ENV } from '../commands/stop-hook.js';
import { getDebugLogger } from '../utils/debug-log.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';
import { CLAUDE_THINKING_TOKENS } from './thinking-budget.js';

const execAsync = promisify(exec);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

// Matches OTel console exporter metric blocks dumped to stdout at process exit.
// Requires `descriptor`, `dataPointType`, and `dataPoints` fields which are
// unique to OTel SDK output and won't appear in normal code review content.
// Optionally matches [otel] prefix that some exporters add.
const OTEL_METRIC_BLOCK_RE =
  /(?:\[otel\]\s*)?\{\s*\n\s*descriptor:\s*\{[\s\S]*?dataPointType:\s*\d+[\s\S]*?dataPoints:\s*\[[\s\S]*?\]\s*,?\s*\n\}/g;

interface OtelUsage {
  cost?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
  toolCalls?: number;
  toolContentBytes?: number;
  apiRequests?: number;
}

const TOKEN_TYPES = ['input', 'output', 'cacheRead', 'cacheCreation'] as const;

function parseCostBlock(block: string): number | undefined {
  const match = block.match(/value:\s*([\d.]+)/);
  return match?.[1] ? Number.parseFloat(match[1]) : undefined;
}

function parseTokenBlock(block: string): Partial<OtelUsage> {
  const result: Partial<OtelUsage> = {};
  const re = /type:\s*"(\w+)"[\s\S]*?value:\s*(\d+)(?:,|\s*\})/g;
  for (const match of block.matchAll(re)) {
    const type = match[1] as (typeof TOKEN_TYPES)[number] | undefined;
    const value = match[2];
    if (!(type && value)) continue;
    if (TOKEN_TYPES.includes(type)) {
      result[type] = Number.parseInt(value, 10);
    }
  }
  return result;
}

function parseOtelMetrics(blocks: string[]): OtelUsage {
  const usage: OtelUsage = {};
  for (const block of blocks) {
    const nameMatch = block.match(/name:\s*"([^"]+)"/);
    if (!nameMatch) continue;

    if (nameMatch[1] === 'claude_code.cost.usage') {
      usage.cost = parseCostBlock(block);
    } else if (nameMatch[1] === 'claude_code.token.usage') {
      Object.assign(usage, parseTokenBlock(block));
    }
  }
  return usage;
}

// Matches OTel console log exporter event records emitted by Claude Code.
// The Node.js SDK console exporter uses util.inspect() format with unquoted keys
// and single-quoted strings. Blocks start with `resource:` and contain a `body:`
// field with the event name (e.g. 'claude_code.tool_result').
const OTEL_LOG_BLOCK_RE =
  /\{\s*\n\s*resource:\s*\{[\s\S]*?body:\s*'claude_code\.\w+'[\s\S]*?\n\}/g;

/** Pre-compiled regexes for extracting single-quoted attribute values from OTel log blocks. */
const OTEL_ATTR_RE = {
  body: /body:\s*'([^']*)'/,
  tool_result_size_bytes: /tool_result_size_bytes:\s*'([^']*)'/,
  input_tokens: /input_tokens:\s*'([^']*)'/,
  output_tokens: /output_tokens:\s*'([^']*)'/,
  cache_read_tokens: /cache_read_tokens:\s*'([^']*)'/,
  cache_creation_tokens: /cache_creation_tokens:\s*'([^']*)'/,
  cost_usd: /cost_usd:\s*'([^']*)'/,
} as const;

/** Maps OTel api_request attribute regexes to OtelUsage fields. */
const API_REQUEST_FIELDS: Array<[RegExp, keyof OtelUsage]> = [
  [OTEL_ATTR_RE.input_tokens, 'input'],
  [OTEL_ATTR_RE.output_tokens, 'output'],
  [OTEL_ATTR_RE.cache_read_tokens, 'cacheRead'],
  [OTEL_ATTR_RE.cache_creation_tokens, 'cacheCreation'],
  [OTEL_ATTR_RE.cost_usd, 'cost'],
];

/** Accumulate a tool_result log block into usage. */
function accumulateToolResult(block: string, usage: OtelUsage): void {
  usage.toolCalls = (usage.toolCalls || 0) + 1;
  const bytes = block.match(OTEL_ATTR_RE.tool_result_size_bytes)?.[1];
  if (bytes !== undefined) {
    usage.toolContentBytes = (usage.toolContentBytes || 0) + Number(bytes);
  }
}

/** Accumulate an api_request log block into usage. */
function accumulateApiRequest(block: string, usage: OtelUsage): void {
  usage.apiRequests = (usage.apiRequests || 0) + 1;
  for (const [re, field] of API_REQUEST_FIELDS) {
    const val = block.match(re)?.[1];
    if (val !== undefined) {
      usage[field] = (usage[field] || 0) + Number(val);
    }
  }
}

/** Accumulate tool_result and api_request event data from OTel log blocks. */
function parseOtelLogEvents(raw: string, usage: OtelUsage): void {
  const blocks = raw.match(OTEL_LOG_BLOCK_RE);
  if (!blocks) return;
  for (const block of blocks) {
    const body = block.match(OTEL_ATTR_RE.body)?.[1];
    if (body === 'claude_code.tool_result') {
      accumulateToolResult(block, usage);
    } else if (body === 'claude_code.api_request') {
      accumulateApiRequest(block, usage);
    }
  }
}

const OTEL_SUMMARY_FIELDS: Array<[keyof OtelUsage, string]> = [
  ['input', 'in'],
  ['output', 'out'],
  ['cacheRead', 'cacheRead'],
  ['cacheCreation', 'cacheWrite'],
  ['toolCalls', 'tool_calls'],
  ['toolContentBytes', 'tool_content_bytes'],
  ['apiRequests', 'api_requests'],
];

function formatOtelSummary(usage: OtelUsage): string | null {
  if (usage.cost === undefined && usage.input === undefined) return null;

  const parts: string[] = [];
  if (usage.cost !== undefined) parts.push(`cost=$${usage.cost.toFixed(4)}`);
  for (const [key, label] of OTEL_SUMMARY_FIELDS) {
    if (usage[key] !== undefined) parts.push(`${label}=${usage[key]}`);
  }

  return `[otel] ${parts.join(' ')}`;
}

function extractOtelMetrics(
  raw: string,
  onLog?: (msg: string) => void,
): string {
  const metricBlocks = raw.match(OTEL_METRIC_BLOCK_RE);
  const usage = metricBlocks ? parseOtelMetrics(metricBlocks) : {};

  // Also parse log events for tool call and API request counts
  parseOtelLogEvents(raw, usage);

  const summary = formatOtelSummary(usage);
  if (summary) {
    onLog?.(`\n${summary}\n`);
    process.stderr.write(`${summary}\n`);
    getDebugLogger()?.logTelemetry({ adapter: 'claude', summary });
  }

  return raw
    .replace(OTEL_METRIC_BLOCK_RE, '')
    .replace(OTEL_LOG_BLOCK_RE, '')
    .trimEnd();
}

/** Build OTel environment overrides for console export. */
function buildOtelEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
    env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
  }
  if (!process.env.OTEL_METRICS_EXPORTER) {
    env.OTEL_METRICS_EXPORTER = 'console';
  }
  if (!process.env.OTEL_LOGS_EXPORTER) {
    env.OTEL_LOGS_EXPORTER = 'console';
  }
  return env;
}

/** Strip OTel metric and log blocks from raw output. */
function stripOtelBlocks(raw: string): string {
  return raw
    .replace(OTEL_METRIC_BLOCK_RE, '')
    .replace(OTEL_LOG_BLOCK_RE, '')
    .trimEnd();
}

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
    const tmpFile = path.join(
      tmpDir,
      `gauntlet-claude-${process.pid}-${Date.now()}.txt`,
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
    const execEnv = {
      ...process.env,
      [GAUNTLET_STOP_HOOK_ACTIVE_ENV]: '1',
      ...otelEnv,
      ...thinkingEnv,
    };

    if (opts.onOutput) {
      const outputBuffer: string[] = [];
      const raw = await runStreamingCommand({
        command: 'claude',
        args,
        tmpFile,
        timeoutMs: opts.timeoutMs,
        onOutput: (chunk: string) => {
          outputBuffer.push(chunk);
        },
        cleanup,
        env: execEnv,
      });
      const cleanedOutput = extractOtelMetrics(
        outputBuffer.join(''),
        opts.onOutput,
      );
      opts.onOutput(cleanedOutput);
      return stripOtelBlocks(raw);
    }

    try {
      const cmd = `cat "${tmpFile}" | claude ${args.map((a) => (a === '' ? '""' : a)).join(' ')}`;
      const { stdout } = await execAsync(cmd, {
        timeout: opts.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: execEnv,
      });
      return extractOtelMetrics(stdout);
    } finally {
      await cleanup();
    }
  }
}

import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GAUNTLET_STOP_HOOK_ACTIVE_ENV } from '../commands/stop-hook.js';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { getDebugLogger } from '../utils/debug-log.js';
import { type CLIAdapter, runStreamingCommand } from './shared.js';
import { CLAUDE_THINKING_TOKENS } from './thinking-budget.js';

const execAsync = promisify(exec);

// ─── OTel Usage Types ────────────────────────────────────────────────────────

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

// ─── O(n) Line-Based OTel Block Scanner ──────────────────────────────────────
// Replaces regex-based block detection to avoid catastrophic backtracking
// on large outputs (~400KB+). Single-pass, string-aware brace tracking.

export interface ScanResult {
  metricBlocks: string[];
  logBlocks: string[];
  cleaned: string;
}

/** Strip backslash-escaped characters and quoted strings, then count net brace depth. */
export function countBraceChange(line: string): number {
  // Remove escaped characters, then quoted strings, leaving only structural chars
  const stripped = line
    .replace(/\\./g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

/** Classify a captured block as metric, log, or neither. */
export function classifyBlock(block: string): 'metric' | 'log' | 'other' {
  if (
    block.includes('descriptor:') &&
    block.includes('dataPointType:') &&
    block.includes('dataPoints:')
  ) {
    return 'metric';
  }
  if (block.includes('resource:') && /body:\s*'claude_code\.\w+'/.test(block)) {
    return 'log';
  }
  return 'other';
}

/** Check if a line starts a brace block (standalone `{` or `[otel] {`). */
function isBlockStart(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed === '{' || (trimmed.startsWith('[otel]') && trimmed.includes('{'))
  );
}

/** Route a completed block into the correct bucket. */
function routeBlock(
  blockLines: string[],
  metricBlocks: string[],
  logBlocks: string[],
  cleanedLines: string[],
): void {
  const block = blockLines.join('\n');
  const kind = classifyBlock(block);
  if (kind === 'metric') metricBlocks.push(block);
  else if (kind === 'log') logBlocks.push(block);
  else cleanedLines.push(...blockLines);
}

/**
 * Single-pass line scanner that extracts OTel metric and log blocks from raw output.
 * Returns classified blocks and cleaned output with OTel blocks removed.
 */
export function scanOtelBlocks(raw: string): ScanResult {
  const lines = raw.split('\n');
  const metricBlocks: string[] = [];
  const logBlocks: string[] = [];
  const cleanedLines: string[] = [];

  let blockLines: string[] | null = null;
  let depth = 0;

  for (const line of lines) {
    if (blockLines === null) {
      if (!isBlockStart(line)) {
        cleanedLines.push(line);
        continue;
      }
      blockLines = [line];
      depth = countBraceChange(line);
    } else {
      blockLines.push(line);
      depth += countBraceChange(line);
    }

    if (depth <= 0) {
      routeBlock(blockLines, metricBlocks, logBlocks, cleanedLines);
      blockLines = null;
      depth = 0;
    }
  }

  // If block never closed, restore lines to avoid data loss
  if (blockLines !== null) {
    cleanedLines.push(...blockLines);
  }

  return { metricBlocks, logBlocks, cleaned: cleanedLines.join('\n') };
}

// ─── Metric Parsing (unchanged) ─────────────────────────────────────────────

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

// ─── Log Event Parsing ──────────────────────────────────────────────────────

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

// ─── OTel Summary Formatting ────────────────────────────────────────────────

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

// ─── Main Extraction (uses scanner instead of regexes) ──────────────────────

export function extractOtelMetrics(
  raw: string,
  onLog?: (msg: string) => void,
): string {
  const { metricBlocks, logBlocks, cleaned } = scanOtelBlocks(raw);

  const usage = metricBlocks.length > 0 ? parseOtelMetrics(metricBlocks) : {};

  // Process log blocks for tool call and API request counts
  for (const block of logBlocks) {
    const body = block.match(OTEL_ATTR_RE.body)?.[1];
    if (body === 'claude_code.tool_result') {
      accumulateToolResult(block, usage);
    } else if (body === 'claude_code.api_request') {
      accumulateApiRequest(block, usage);
    }
  }

  const summary = formatOtelSummary(usage);
  if (summary) {
    onLog?.(`\n${summary}\n`);
    process.stderr.write(`${summary}\n`);
    getDebugLogger()?.logTelemetry({ adapter: 'claude', summary });
  }

  return cleaned.trimEnd();
}

/** Safety wrapper: catches exceptions and returns raw output with a warning. */
function safeExtractOtelMetrics(
  raw: string,
  onLog?: (msg: string) => void,
): string {
  try {
    return extractOtelMetrics(raw, onLog);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[gauntlet] OTel extraction failed: ${msg}\n`);
    return raw;
  }
}

// ─── OTel Environment ───────────────────────────────────────────────────────

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

// ─── Adapter ────────────────────────────────────────────────────────────────

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
    return Promise.race([
      this.doExecute(opts),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Adapter execution timed out (post-processing exceeded limit)',
              ),
            ),
          totalTimeout,
        ),
      ),
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
    // Exclude CLAUDECODE so the child doesn't hit the nesting guard
    const { CLAUDECODE: _, ...parentEnv } = process.env;
    const execEnv = {
      ...parentEnv,
      [GAUNTLET_STOP_HOOK_ACTIVE_ENV]: '1',
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

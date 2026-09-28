import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_BUFFER_BYTES } from '../constants.js';
import { getDebugLogger } from '../utils/debug-log.js';
import { createBoundedLineCollector } from './bounded-lines.js';
import {
  type CodexLaunchIdentity,
  resolveCodexLaunchIdentity,
} from './codex-config.js';
import {
  type CodexObservedIdentity,
  extractCodexThreadId,
  readCodexObservedIdentity,
} from './codex-rollout.js';
import { type CodexUsage, codexUsageTelemetry } from './codex-usage.js';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';
import {
  AdapterExecutionFailure,
  type AdapterTelemetry,
  type CLIAdapter,
  createUnavailableTelemetry,
  runStreamingCommand,
} from './shared.js';
import { CODEX_REASONING_EFFORT } from './thinking-budget.js';

const execAsync = promisify(exec);

// Module-level counter for unique tmp file names across parallel invocations
let _tmpCounter = 0;

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
  emitSummary = true,
): { text: string; usage: CodexUsage } {
  const usage: CodexUsage = {};
  let lastAgentMessage = '';

  for (const line of raw.split('\n')) {
    const event = parseJsonlLine(line.trim());
    if (!event) continue;
    const msg = processCodexEvent(event, usage);
    if (msg !== undefined) lastAgentMessage = msg;
  }

  if (emitSummary) emitCodexSummary(usage, onLog);
  return { text: lastAgentMessage, usage };
}

/**
 * Maps structured `turn.completed` usage into the canonical measurement fields.
 * Codex reports input as a total that includes cached input; cache-write and
 * reasoning relationships are not established by this event format.
 */
export function parseCodexTelemetry(
  raw: string,
  opts: { requestedModel?: string; thinkingBudget?: string } = {},
  launchIdentity?: CodexLaunchIdentity,
): AdapterTelemetry {
  return codexUsageTelemetry(
    parseCodexJsonl(raw, undefined, false).usage,
    opts,
    launchIdentity,
  );
}

function createCodexTelemetryCollector(
  opts: { model?: string; thinkingBudget?: string },
  onTelemetry: (telemetry: AdapterTelemetry) => void,
  launchIdentity?: CodexLaunchIdentity,
) {
  const usage: CodexUsage = {};
  let previous = '';
  return createBoundedLineCollector((line) => {
    const event = parseJsonlLine(line);
    if (event?.type !== 'turn.completed') return;
    accumulateTurnUsage(event, usage);
    const telemetry = codexUsageTelemetry(
      usage,
      {
        requestedModel: opts.model,
        thinkingBudget: opts.thinkingBudget,
      },
      launchIdentity,
    );
    if (telemetry.provider_native_usage.length === 0) return;
    telemetry.completeness.collection = 'partial';
    const serialized = JSON.stringify(telemetry);
    if (serialized === previous) return;
    previous = serialized;
    onTelemetry(telemetry);
  });
}

function createCodexFallbackTelemetry(
  opts: { model?: string; thinkingBudget?: string },
  launchIdentity: CodexLaunchIdentity,
): AdapterTelemetry {
  const telemetry = createUnavailableTelemetry('codex', {
    requestedModel: opts.model,
    resolvedModel: launchIdentity.model,
    resolvedProvider: launchIdentity.provider ?? undefined,
    requestedEffort: opts.thinkingBudget,
  });
  if (launchIdentity.reason) telemetry.diagnostics.push(launchIdentity.reason);
  return telemetry;
}

function addCodexObservedEntry(
  telemetry: AdapterTelemetry,
  observed: CodexObservedIdentity & { model: string },
): void {
  telemetry.observed_identities.push({
    identity_id: `codex-model-${createHash('sha256')
      .update(`${observed.provider ?? ''}\0${observed.model}`)
      .digest('hex')}`,
    model: observed.model,
    provider: observed.provider
      ? { availability: 'available', value: observed.provider, reason: null }
      : {
          availability: 'unavailable',
          value: null,
          reason: observed.reason ?? 'not_reported',
        },
    effort: {
      availability: 'unavailable',
      value: null,
      reason: 'not_reported',
    },
    provenance: 'telemetry',
  });
  telemetry.observed_identity_availability = {
    availability: 'available',
    reason: null,
  };
}

function applyCodexObservedIdentity(
  telemetry: AdapterTelemetry,
  launchIdentity: CodexLaunchIdentity,
  observed: CodexObservedIdentity,
): AdapterTelemetry {
  if (observed.reason) telemetry.diagnostics.push(observed.reason);
  if (!observed.model) return telemetry;
  addCodexObservedEntry(
    telemetry,
    observed as CodexObservedIdentity & { model: string },
  );
  const modelMismatch = launchIdentity.model !== observed.model;
  const providerMismatch =
    !!observed.provider && launchIdentity.provider !== observed.provider;
  if (modelMismatch || providerMismatch) {
    telemetry.resolved_identity.model = observed.model;
    telemetry.resolved_identity.provider = observed.provider;
    telemetry.resolved_identity.provenance = 'telemetry';
    telemetry.diagnostics = telemetry.diagnostics.filter(
      (reason) =>
        reason !== 'codex_config_not_found' &&
        reason !== 'codex_config_model_unset',
    );
    if (modelMismatch)
      telemetry.diagnostics.push(
        launchIdentity.model
          ? 'codex_observed_model_mismatch'
          : 'codex_identity_observed_from_rollout',
      );
    if (providerMismatch)
      telemetry.diagnostics.push('codex_observed_provider_mismatch');
  }
  return telemetry;
}

async function codexExecutionResult(
  raw: string,
  opts: {
    model?: string;
    thinkingBudget?: string;
    onOutput?: (chunk: string) => void;
  },
  launchIdentity: CodexLaunchIdentity,
): Promise<{ text: string; telemetry: AdapterTelemetry }> {
  const { text } = parseCodexJsonl(raw, opts.onOutput);
  const observed = await readCodexObservedIdentity({
    threadId: extractCodexThreadId(raw),
  });
  return {
    text: text || raw.trimEnd(),
    telemetry: applyCodexObservedIdentity(
      parseCodexTelemetry(
        raw,
        { requestedModel: opts.model, thinkingBudget: opts.thinkingBudget },
        launchIdentity,
      ),
      launchIdentity,
      observed,
    ),
  };
}

export class CodexAdapter implements CLIAdapter {
  name = 'codex';
  constructor(private readonly streamCommand = runStreamingCommand) {}

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
    return '.agents/skills';
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

  private buildArgs(
    allowToolUse?: boolean,
    thinkingBudget?: string,
    model?: string,
  ): string[] {
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
      // Codex plugins can expose MCP tools from user config. In tools-off
      // mode, ignore that config so the eval/review cannot call them.
      args.push('--disable', 'shell_tool', '--ignore-user-config');
    }
    if (thinkingBudget && thinkingBudget in CODEX_REASONING_EFFORT) {
      const effort = CODEX_REASONING_EFFORT[thinkingBudget];
      args.push('-c', `model_reasoning_effort="${effort}"`);
    }
    if (model && SAFE_MODEL_ID_PATTERN.test(model)) {
      args.push('-m', model);
    }
    args.push('--json', '-');
    return args;
  }

  async execute(
    opts: Parameters<CLIAdapter['execute']>[0],
  ): Promise<{ text: string; telemetry: AdapterTelemetry }> {
    const launchIdentity = resolveCodexLaunchIdentity({
      configuredModel: opts.model,
      ignoreUserConfig: opts.allowToolUse === false,
    });
    let fallbackTelemetry = createCodexFallbackTelemetry(opts, launchIdentity);
    let streamThreadId: string | null = null;
    const threadCollector = createBoundedLineCollector((line) => {
      streamThreadId ??= extractCodexThreadId(line);
    });
    const collect = createCodexTelemetryCollector(
      opts,
      (telemetry) => {
        fallbackTelemetry = telemetry;
        opts.onTelemetry?.(telemetry);
      },
      launchIdentity,
    );
    try {
      const fullContent = `${opts.prompt}\n\n--- DIFF ---\n${opts.diff}`;

      const tmpDir = os.tmpdir();
      // Include process.pid and a counter for uniqueness across concurrent invocations
      // in the same process (parallel review gates can call execute() within the same
      // millisecond, causing Date.now() collisions and tmp file overwrites).
      const tmpFile = path.join(
        tmpDir,
        `validator-codex-${process.pid}-${Date.now()}-${_tmpCounter++}.txt`,
      );
      await fs.writeFile(tmpFile, fullContent);

      const args = this.buildArgs(
        opts.allowToolUse,
        opts.thinkingBudget,
        launchIdentity.launchModel ?? opts.model,
      );

      const cleanup = () => fs.unlink(tmpFile).catch(() => {});

      // If onOutput callback is provided, use spawn for real-time streaming
      if (opts.onOutput || opts.onTelemetry) {
        const raw = await this.streamCommand({
          command: 'codex',
          args,
          tmpFile,
          timeoutMs: opts.timeoutMs,
          onStdout: (chunk) => {
            collect.write(chunk);
            threadCollector.write(chunk);
          },
          onOutput: (chunk: string) => {
            opts.onOutput?.(chunk);
          },
          cleanup,
        });

        return codexExecutionResult(raw, opts, launchIdentity);
      }

      // Otherwise use exec for buffered output
      try {
        const quoteArg = (a: string) => `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
        const cmd = `cat "${tmpFile}" | codex ${args.map(quoteArg).join(' ')}`;
        const { stdout } = await execAsync(cmd, {
          timeout: opts.timeoutMs,
          maxBuffer: MAX_BUFFER_BYTES,
        });
        return codexExecutionResult(stdout, opts, launchIdentity);
      } finally {
        await cleanup();
      }
    } catch (error) {
      collect.flush();
      threadCollector.flush();
      fallbackTelemetry = applyCodexObservedIdentity(
        fallbackTelemetry,
        launchIdentity,
        await readCodexObservedIdentity({ threadId: streamThreadId }),
      );
      throw new AdapterExecutionFailure(
        error instanceof Error ? error : new Error(String(error)),
        fallbackTelemetry,
      );
    }
  }
}

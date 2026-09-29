import { getDebugLogger } from '../utils/debug-log.js';
import { createBoundedLineCollector } from './bounded-lines.js';
import {
  type ClaudeCost,
  type ClaudeCostTally,
  claudeReportedCost,
  createClaudeCostTally,
  isClaudeCostMetric,
  resolveClaudeCost,
  tallyCostMetric,
  tallyRequestCost,
} from './claude-otel-cost.js';
import {
  classifyBlock,
  countBraceChange,
  isBlockStart,
  scanOtelBlocks,
} from './claude-otel-scanner.js';
import {
  type AdapterTelemetry,
  createUnavailableTelemetry,
  observedMeasurement,
  unavailableMeasurement,
} from './shared.js';

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

export {
  classifyBlock,
  countBraceChange,
  type ScanResult,
  scanOtelBlocks,
} from './claude-otel-scanner.js';

// ─── Metric Parsing (unchanged) ─────────────────────────────────────────────

const TOKEN_TYPES = ['input', 'output', 'cacheRead', 'cacheCreation'] as const;

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

    if (nameMatch[1] === 'claude_code.token.usage') {
      Object.assign(usage, parseTokenBlock(block));
    }
  }
  return usage;
}

// ─── Log Event Parsing ──────────────────────────────────────────────────────

/** Pre-compiled regexes for extracting quoted attribute values from OTel log blocks. */
const OTEL_ATTR_RE = {
  body: /body:\s*['"]([^'"]*)['"]/,
  tool_result_size_bytes: /tool_result_size_bytes:\s*['"]([^'"]*)['"]/,
  input_tokens: /\binput_tokens:\s*["']?(\d+)["']?(?=\s*[,}\n])/,
  output_tokens: /\boutput_tokens:\s*["']?(\d+)["']?(?=\s*[,}\n])/,
  cache_read_tokens: /\bcache_read_tokens:\s*["']?(\d+)["']?(?=\s*[,}\n])/,
  cache_creation_tokens:
    /\bcache_creation_tokens:\s*["']?(\d+)["']?(?=\s*[,}\n])/,
} as const;

/** Maps OTel api_request attribute regexes to OtelUsage fields. */
const API_REQUEST_FIELDS: Array<[RegExp, keyof OtelUsage]> = [
  [OTEL_ATTR_RE.input_tokens, 'input'],
  [OTEL_ATTR_RE.output_tokens, 'output'],
  [OTEL_ATTR_RE.cache_read_tokens, 'cacheRead'],
  [OTEL_ATTR_RE.cache_creation_tokens, 'cacheCreation'],
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

/** Tallies cost evidence from classified blocks without double counting. */
function tallyCostBlocks(
  metricBlocks: string[],
  logBlocks: string[],
): ClaudeCostTally {
  const tally = createClaudeCostTally();
  for (const block of metricBlocks) {
    if (isClaudeCostMetric(block)) tallyCostMetric(tally, block);
  }
  for (const block of logBlocks) {
    if (block.match(OTEL_ATTR_RE.body)?.[1] === 'claude_code.api_request')
      tallyRequestCost(tally, block);
  }
  return tally;
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
  usage.cost = resolveClaudeCost(
    tallyCostBlocks(metricBlocks, logBlocks),
  )?.amount;

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
export function safeExtractOtelMetrics(
  raw: string,
  onLog?: (msg: string) => void,
): string {
  try {
    return extractOtelMetrics(raw, onLog);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-validator] OTel extraction failed: ${msg}\n`);
    return raw;
  }
}

/**
 * Converts the allowlisted Claude OTel counters into safe partial evidence.
 * Metric counters take precedence over API-request logs because both may
 * describe the same work and the existing source does not establish a safe
 * way to add them together.
 */
function canonicalClaudeUsage(raw: string): {
  usage: OtelUsage;
  completeRequestInputs: boolean;
  cost?: ClaudeCost;
} {
  const { metricBlocks, logBlocks } = scanOtelBlocks(raw);
  const cost = resolveClaudeCost(tallyCostBlocks(metricBlocks, logBlocks));
  const tokenMetrics = metricBlocks.filter((block) =>
    /name:\s*"claude_code\.token\.usage"/.test(block),
  );
  if (tokenMetrics.length > 0) {
    return {
      usage: parseOtelMetrics(tokenMetrics),
      completeRequestInputs: true,
      cost,
    };
  }
  const usage: OtelUsage = {};
  let completeRequestInputs = true;
  for (const block of logBlocks) {
    if (block.match(OTEL_ATTR_RE.body)?.[1] !== 'claude_code.api_request')
      continue;
    accumulateApiRequest(block, usage);
    completeRequestInputs &&= [
      OTEL_ATTR_RE.input_tokens,
      OTEL_ATTR_RE.cache_read_tokens,
      OTEL_ATTR_RE.cache_creation_tokens,
    ].every((field) => field.test(block));
  }
  return { usage, completeRequestInputs, cost };
}

function claudeInputTotal(
  tokens: AdapterTelemetry['tokens'],
  completeRequestInputs: boolean,
): AdapterTelemetry['tokens']['input_total'] {
  const { input_uncached, cache_read, cache_write } = tokens;
  if (
    !completeRequestInputs ||
    input_uncached.availability !== 'available' ||
    cache_read.availability !== 'available' ||
    cache_write.availability !== 'available'
  ) {
    return unavailableMeasurement('claude_input_breakdown_incomplete');
  }
  const total = observedMeasurement(
    input_uncached.value + cache_read.value + cache_write.value,
    'validator_derivation',
  );
  return total.availability === 'available'
    ? {
        ...total,
        origin: 'derived',
        derivation: 'claude_uncached_plus_cache_read_plus_cache_write',
      }
    : total;
}

export type ClaudeTelemetryOpts = {
  requestedModel?: string;
  thinkingBudget?: string;
  resolvedEffort?: string | null;
};

export function parseClaudeOtelTelemetry(
  raw: string,
  opts: ClaudeTelemetryOpts = {},
): AdapterTelemetry {
  const { usage, completeRequestInputs, cost } = canonicalClaudeUsage(raw);
  return createClaudeTelemetry(usage, completeRequestInputs, opts, cost);
}

function createClaudeTelemetry(
  usage: OtelUsage,
  completeRequestInputs: boolean,
  opts: ClaudeTelemetryOpts,
  cost?: ClaudeCost,
): AdapterTelemetry {
  const telemetry = createUnavailableTelemetry('claude', {
    requestedModel: opts.requestedModel,
    requestedEffort: opts.thinkingBudget,
    resolvedEffort: opts.resolvedEffort,
    reason: 'claude_otel_not_observed',
  });
  const source = 'provider_event' as const;
  const fields: Array<
    [
      keyof OtelUsage,
      'input_uncached' | 'output' | 'cache_read' | 'cache_write',
    ]
  > = [
    ['input', 'input_uncached'],
    ['output', 'output'],
    ['cacheRead', 'cache_read'],
    ['cacheCreation', 'cache_write'],
  ];
  for (const [usageKey, tokenKey] of fields) {
    const value = usage[usageKey];
    if (typeof value !== 'number') continue;
    telemetry.tokens[tokenKey] = observedMeasurement(
      value,
      source,
      'exact',
      tokenKey === 'output' ? null : ['input_total'],
    );
    telemetry.provider_native_usage.push({
      source,
      name: `claude_otel_${usageKey}`,
      value,
    });
  }
  // Anthropic's three input categories are disjoint. Neither a missing cache
  // counter nor an overlapping API-request copy of a metric is an observed zero.
  telemetry.tokens.input_total = claudeInputTotal(
    telemetry.tokens,
    completeRequestInputs,
  );
  if (cost) {
    telemetry.provider_reported_costs.push(claudeReportedCost(cost));
    telemetry.provider_native_usage.push({
      source,
      name: 'reported_cost',
      value: cost.amount,
    });
  }
  if (telemetry.provider_native_usage.length > 0) {
    telemetry.completeness.collection = 'partial';
    telemetry.completeness.canonical_fields = 'partial';
    telemetry.diagnostics = [
      'claude_metric_request_overlap_unresolved',
      'claude_normalized_total_not_established',
    ];
  }
  telemetry.provenance.source_format_version = {
    availability: 'available',
    value: 'claude-otel-console',
    reason: null,
  };
  telemetry.provenance.adapter_mapping_version = 'claude-otel-accounting-v3';
  return telemetry;
}

/** Retain one bounded console block and safe counters, never the output history. */
export function createClaudeTelemetryCollector(
  opts: ClaudeTelemetryOpts,
  onTelemetry: (telemetry: AdapterTelemetry) => void,
) {
  const metrics: OtelUsage = {};
  const requests: OtelUsage = {};
  const costs = createClaudeCostTally();
  let seenMetrics = false;
  let completeRequestInputs = true;
  let block: string[] = [];
  let depth = 0;
  let length = 0;
  let limited = false;
  const abandon = () => {
    limited = true;
    block = [];
  };
  const observeBlock = (raw: string) => {
    const kind = classifyBlock(raw);
    if (kind === 'metric' && /name:\s*"claude_code\.token\.usage"/.test(raw)) {
      seenMetrics = true;
      Object.assign(metrics, parseTokenBlock(raw));
    } else if (kind === 'metric' && isClaudeCostMetric(raw)) {
      tallyCostMetric(costs, raw);
    } else if (
      kind === 'log' &&
      raw.match(OTEL_ATTR_RE.body)?.[1] === 'claude_code.api_request'
    ) {
      accumulateApiRequest(raw, requests);
      tallyRequestCost(costs, raw);
      completeRequestInputs &&= [
        OTEL_ATTR_RE.input_tokens,
        OTEL_ATTR_RE.cache_read_tokens,
        OTEL_ATTR_RE.cache_creation_tokens,
      ].every((field) => field.test(raw));
    } else return;
    onTelemetry(
      createClaudeTelemetry(
        seenMetrics ? metrics : requests,
        seenMetrics || completeRequestInputs,
        opts,
        resolveClaudeCost(costs),
      ),
    );
  };
  const lines = createBoundedLineCollector((line) => {
    if (limited) return;
    if (block.length === 0 && !isBlockStart(line)) return;
    length += line.length + 1;
    if (length > 1024 * 1024) {
      abandon();
      return;
    }
    block.push(line);
    depth += countBraceChange(line);
    if (depth > 0) return;
    observeBlock(block.join('\n'));
    block = [];
    length = 0;
    depth = 0;
  }, abandon);
  return lines;
}

/** Build OTel environment overrides for console export. */
export function buildOtelEnv(): Record<string, string> {
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

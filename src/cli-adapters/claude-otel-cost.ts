import type { ReportedCost } from '../metrics/types.js';

/**
 * Claude Code reports a client-side USD cost estimate in two overlapping
 * places: the cumulative `claude_code.cost.usage` metric and a per-request
 * `cost_usd` attribute on `claude_code.api_request` log events. Both describe
 * the same work, so the metric wins when present and the two are never added.
 */
export interface ClaudeCostTally {
  /** Latest cumulative metric value (sum of its data points). */
  metric?: number;
  requestCost: number;
  requestCount: number;
  pricedRequestCount: number;
}

export interface ClaudeCost {
  amount: number;
  coverage: ReportedCost['coverage'];
}

const COST_METRIC_RE = /name:\s*"claude_code\.cost\.usage"/;
const DATA_POINT_VALUE_RE = /\bvalue:\s*([\d.]+(?:[eE][+-]?\d+)?)/g;
const REQUEST_COST_RE =
  /\bcost_usd:\s*["']?([\d.]+(?:[eE][+-]?\d+)?)["']?(?=\s*[,}\n])/;

export const CLAUDE_COST_EVIDENCE_ID = 'claude-otel-cost';

export function createClaudeCostTally(): ClaudeCostTally {
  return { requestCost: 0, requestCount: 0, pricedRequestCount: 0 };
}

export function isClaudeCostMetric(block: string): boolean {
  return COST_METRIC_RE.test(block);
}

/** Sums every data point of one cost metric export (one point per attribute set). */
export function sumCostMetricBlock(block: string): number | undefined {
  const start = block.indexOf('dataPoints:');
  if (start < 0) return undefined;
  let total: number | undefined;
  for (const match of block.slice(start).matchAll(DATA_POINT_VALUE_RE)) {
    const value = Number.parseFloat(match[1] ?? '');
    if (Number.isFinite(value)) total = (total ?? 0) + value;
  }
  return total;
}

/** Records a cumulative cost metric export; later exports replace earlier ones. */
export function tallyCostMetric(tally: ClaudeCostTally, block: string): void {
  const value = sumCostMetricBlock(block);
  if (value !== undefined) tally.metric = value;
}

/** Records one `claude_code.api_request` log event. */
export function tallyRequestCost(tally: ClaudeCostTally, block: string): void {
  tally.requestCount++;
  const raw = block.match(REQUEST_COST_RE)?.[1];
  const value = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  if (!Number.isFinite(value)) return;
  tally.pricedRequestCount++;
  tally.requestCost += value;
}

export function resolveClaudeCost(
  tally: ClaudeCostTally,
): ClaudeCost | undefined {
  if (tally.metric !== undefined) {
    return { amount: tally.metric, coverage: 'full' };
  }
  if (tally.pricedRequestCount === 0) return undefined;
  return {
    amount: tally.requestCost,
    coverage:
      tally.pricedRequestCount === tally.requestCount ? 'full' : 'partial',
  };
}

/** Pass-through provider evidence; Validator never prices the attempt itself. */
export function claudeReportedCost(cost: ClaudeCost): ReportedCost {
  return {
    cost_evidence_id: CLAUDE_COST_EVIDENCE_ID,
    amount: {
      availability: 'available',
      value: cost.amount,
      reason: null,
      source: 'provider_event',
      origin: 'observed',
      // Claude Code computes this client-side from its own rate table.
      precision: 'approximate',
      derivation: null,
      included_in: null,
    },
    currency: { availability: 'available', value: 'USD', reason: null },
    scope: 'attempt',
    coverage: cost.coverage,
    // Only one cost row is emitted; metric and request sources are never summed.
    overlap: 'established',
    source: 'provider_event',
  };
}

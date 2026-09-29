import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  createClaudeTelemetryCollector,
  parseClaudeOtelTelemetry,
  scanOtelBlocks,
} from '../../src/cli-adapters/claude-otel.js';
import { sumCostMetricBlock } from '../../src/cli-adapters/claude-otel-cost.js';
import type { AdapterTelemetry } from '../../src/cli-adapters/shared.js';
import type { ModelAttempt } from '../../src/metrics/types.js';
import { validateAttempt } from '../../src/metrics/validation.js';

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/native-telemetry/${name}`, import.meta.url), 'utf8');

const costMetric = (...values: number[]) => `{
  descriptor: { name: "claude_code.cost.usage", unit: "USD", valueType: 1 },
  dataPointType: 3,
  dataPoints: [
${values.map((v, i) => `    { attributes: { model: "m${i}" }, startTime: [1, 0], value: ${v} }`).join(',\n')}
  ],
}`;

const apiRequest = (cost?: string) => `{
  resource: { attributes: {} },
  body: "claude_code.api_request",
  attributes: {
    input_tokens: 10,
    output_tokens: 2,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,${cost === undefined ? '' : `\n    cost_usd: ${cost},`}
  },
}`;

function asAttempt(telemetry: AdapterTelemetry): ModelAttempt {
  return {
    record_type: 'model_attempt',
    attempt_id: 'attempt-1',
    revision: 1,
    measurement_schema_version: 1,
    session_id: 'session-1',
    invocation_id: 'invocation-1',
    lifecycle: { state: 'completed', started_at: null, ended_at: null },
    adapter: telemetry.adapter,
    outcome: 'passed',
    requested_identity: telemetry.requested_identity,
    resolved_identity: telemetry.resolved_identity,
    observed_identities: telemetry.observed_identities,
    observed_identity_availability: telemetry.observed_identity_availability,
    tokens: telemetry.tokens,
    provider_native_usage: telemetry.provider_native_usage,
    completeness: { history: 'complete', ...telemetry.completeness },
    allocations: telemetry.allocations,
    unallocated_usage: telemetry.unallocated_usage,
    provider_reported_costs: telemetry.provider_reported_costs,
    provenance: {
      producer_version: 'test',
      build: { availability: 'unavailable', value: null, reason: 'test' },
      ...telemetry.provenance,
    },
    diagnostics: telemetry.diagnostics,
  };
}

describe('Claude provider-reported cost', () => {
  test('recorded API-request cost becomes attempt-scoped USD evidence that validates', async () => {
    const telemetry = parseClaudeOtelTelemetry(await fixture('claude-2.1.261-cache-write.txt'));
    expect(telemetry.provider_reported_costs).toEqual([
      {
        cost_evidence_id: 'claude-otel-cost',
        amount: {
          availability: 'available',
          value: 0.015039,
          reason: null,
          source: 'provider_event',
          origin: 'observed',
          precision: 'approximate',
          derivation: null,
          included_in: null,
        },
        currency: { availability: 'available', value: 'USD', reason: null },
        scope: 'attempt',
        coverage: 'full',
        overlap: 'established',
        source: 'provider_event',
      },
    ]);
    expect(telemetry.provider_native_usage).toContainEqual({ source: 'provider_event', name: 'reported_cost', value: 0.015039 });
    expect(validateAttempt(asAttempt(telemetry)).success).toBe(true);
  });

  test('cumulative cost metric wins over overlapping request costs and sums its data points', () => {
    const raw = [costMetric(0.01), apiRequest('0.5'), costMetric(0.02, 0.03)].join('\n');
    const [cost] = parseClaudeOtelTelemetry(raw).provider_reported_costs;
    expect(cost?.amount.value).toBeCloseTo(0.05, 10);
    expect(cost?.coverage).toBe('full');
  });

  test('request costs sum, and missing request costs mark coverage partial', () => {
    const full = parseClaudeOtelTelemetry([apiRequest('0.25'), apiRequest("'0.5'")].join('\n'));
    expect(full.provider_reported_costs[0]).toMatchObject({ amount: { value: 0.75 }, coverage: 'full' });
    const partial = parseClaudeOtelTelemetry([apiRequest('0.25'), apiRequest()].join('\n'));
    expect(partial.provider_reported_costs[0]).toMatchObject({ amount: { value: 0.25 }, coverage: 'partial' });
    expect(validateAttempt(asAttempt(partial)).success).toBe(true);
  });

  test('no cost evidence leaves provider_reported_costs empty rather than zero', () => {
    expect(parseClaudeOtelTelemetry(apiRequest()).provider_reported_costs).toEqual([]);
    expect(parseClaudeOtelTelemetry('plain output').provider_reported_costs).toEqual([]);
  });

  test('streaming collector reports the same cost as the final parse', async () => {
    const raw = `${costMetric(0.2)}\n${await fixture('claude-2.1.261.txt')}`;
    const costs: Array<number | null | undefined> = [];
    const collector = createClaudeTelemetryCollector({}, t => costs.push(t.provider_reported_costs[0]?.amount.value));
    collector.write(raw);
    collector.flush();
    expect(costs.at(-1)).toBe(0.2);
    expect(parseClaudeOtelTelemetry(raw).provider_reported_costs[0]?.amount.value).toBe(0.2);
  });

  test('sums every data point of a cost metric block and ignores blocks without points', () => {
    const { metricBlocks } = scanOtelBlocks(costMetric(0.1, 0.2));
    expect(sumCostMetricBlock(metricBlocks[0] ?? '')).toBeCloseTo(0.3, 10);
    expect(sumCostMetricBlock('{ descriptor: { name: "claude_code.cost.usage" } }')).toBeUndefined();
  });
});

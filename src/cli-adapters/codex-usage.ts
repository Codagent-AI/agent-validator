import type { CodexLaunchIdentity } from './codex-config.js';
import {
  type AdapterTelemetry,
  createUnavailableTelemetry,
  observedMeasurement,
  unavailableMeasurement,
} from './shared.js';

export interface CodexUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
  apiRequests?: number;
}

function deriveUncachedInput(telemetry: AdapterTelemetry): void {
  const input = telemetry.tokens.input_total;
  const cacheRead = telemetry.tokens.cache_read;
  if (
    input.availability !== 'available' ||
    cacheRead.availability !== 'available'
  )
    return;
  const uncached = input.value - cacheRead.value;
  telemetry.tokens.input_uncached =
    uncached >= 0
      ? {
          availability: 'available',
          value: uncached,
          reason: null,
          source: 'validator_derivation',
          origin: 'derived',
          precision: 'exact',
          derivation: 'codex_input_total_minus_cache_read',
          included_in: ['input_total'],
        }
      : unavailableMeasurement('invalid_provider_measurement');
}

export function codexUsageTelemetry(
  usage: CodexUsage,
  opts: { requestedModel?: string; thinkingBudget?: string },
  launchIdentity?: CodexLaunchIdentity,
): AdapterTelemetry {
  const telemetry = createUnavailableTelemetry('codex', {
    requestedModel: opts.requestedModel,
    resolvedModel: launchIdentity?.model,
    resolvedProvider: launchIdentity?.provider ?? undefined,
    requestedEffort: opts.thinkingBudget,
    reason: 'codex_usage_not_observed',
  });
  if (launchIdentity?.reason) telemetry.diagnostics.push(launchIdentity.reason);
  const source = 'provider_event' as const;
  const input = usage.inputTokens;
  const cacheRead = usage.cachedInputTokens;
  const output = usage.outputTokens;

  if (input !== undefined) {
    telemetry.tokens.input_total = observedMeasurement(input, source);
    telemetry.provider_native_usage.push({
      source,
      name: 'input_tokens',
      value: input,
    });
  }
  if (cacheRead !== undefined) {
    telemetry.tokens.cache_read = observedMeasurement(
      cacheRead,
      source,
      'exact',
      ['input_total'],
    );
    telemetry.provider_native_usage.push({
      source,
      name: 'cached_input_tokens',
      value: cacheRead,
    });
  }
  if (output !== undefined) {
    telemetry.tokens.output = observedMeasurement(output, source);
    telemetry.provider_native_usage.push({
      source,
      name: 'output_tokens',
      value: output,
    });
  }

  deriveUncachedInput(telemetry);

  if (
    telemetry.tokens.input_total.availability === 'available' &&
    telemetry.tokens.output.availability === 'available'
  ) {
    telemetry.tokens.normalized_total = {
      availability: 'available',
      value: telemetry.tokens.input_total.value + telemetry.tokens.output.value,
      reason: null,
      source: 'validator_derivation',
      origin: 'derived',
      precision: 'exact',
      derivation: 'codex_input_total_plus_output',
      included_in: null,
    };
    telemetry.completeness.normalized_total = 'complete';
  }
  if (telemetry.provider_native_usage.length > 0) {
    telemetry.completeness.collection = 'complete';
    telemetry.completeness.canonical_fields = 'partial';
    telemetry.diagnostics = telemetry.diagnostics.filter(
      (diagnostic) => diagnostic !== 'codex_usage_not_observed',
    );
  }
  telemetry.provenance.source_format_version = {
    availability: 'available',
    value: 'codex-exec-jsonl-turn.completed',
    reason: null,
  };
  return telemetry;
}

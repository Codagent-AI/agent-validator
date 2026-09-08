import {
  type AdapterTelemetry,
  createUnavailableTelemetry,
  observedMeasurement,
} from './shared.js';

function parseDisplayTokenCount(value: string): number {
  return value.endsWith('k')
    ? Math.round(Number(value.slice(0, -1)) * 1000)
    : Number(value);
}

function summaryUsage(
  models: string[],
  input: number,
  output: number,
  cache: number,
  cacheComplete: boolean,
): Partial<Record<'in' | 'out' | 'cache', number>> {
  if (models.length === 0) return {};
  return { in: input, out: output, ...(cacheComplete ? { cache } : {}) };
}

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
export function parseCopilotSessionSummary(output: string):
  | {
      telemetryLine: string;
      model: string;
      usage: Partial<Record<'in' | 'out' | 'cache', number>>;
    }
  | undefined {
  const premiumMatch = output.match(
    /Total usage est:\s+(\d+)\s+Premium request/i,
  );
  if (!premiumMatch) return undefined;

  const premiumRequests = Number(premiumMatch[1]);
  if (!Number.isSafeInteger(premiumRequests) || premiumRequests < 0)
    return undefined;

  // Parse per-model token lines: " <model>  <N>k in, <N> out, <N>k cached"
  const modelLines = [
    ...output.matchAll(
      /^\s+(\S+)\s+([\d.]+k?) in,\s*([\d.]+k?) out(?:,\s*([\d.]+k?) cached)?/gm,
    ),
  ];

  let totalIn = 0;
  let totalOut = 0;
  let totalCached = 0;
  const models: string[] = [];
  let cacheComplete = true;

  for (const m of modelLines) {
    const [, model, inRaw, outRaw, cachedRaw] = m;
    if (!(model && inRaw && outRaw)) continue;
    const input = parseDisplayTokenCount(inRaw);
    const output = parseDisplayTokenCount(outRaw);
    const cached = cachedRaw ? parseDisplayTokenCount(cachedRaw) : 0;
    cacheComplete &&= cachedRaw !== undefined;
    if (
      ![input, output, cached].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      return undefined;
    totalIn += input;
    totalOut += output;
    totalCached += cached;
    if (![totalIn, totalOut, totalCached].every(Number.isSafeInteger))
      return undefined;
    models.push(model);
  }

  const model = models.join(',') || 'unknown';
  const telemetryLine = `[copilot-telemetry] model=${model} in=${totalIn} out=${totalOut} cache=${totalCached} premium_requests=${premiumRequests}`;
  const usage = summaryUsage(
    models,
    totalIn,
    totalOut,
    totalCached,
    cacheComplete,
  );
  return { telemetryLine, model, usage };
}

export function parseCopilotTelemetry(
  output: string,
  opts: { model?: string; thinkingBudget?: string } = {},
): AdapterTelemetry {
  const telemetry = createUnavailableTelemetry('github-copilot', {
    requestedModel: opts.model,
    requestedEffort: opts.thinkingBudget,
    reason: 'copilot_summary_not_observed',
  });
  const summary = parseCopilotSessionSummary(output);
  if (!summary) return telemetry;

  const values = summary.usage;
  const source = 'provider_display' as const;
  if (values.in !== undefined)
    telemetry.tokens.input_total = observedMeasurement(
      values.in,
      source,
      'approximate',
    );
  if (values.out !== undefined)
    telemetry.tokens.output = observedMeasurement(
      values.out,
      source,
      'approximate',
    );
  if (values.cache !== undefined)
    telemetry.tokens.cache_read = observedMeasurement(
      values.cache,
      source,
      'approximate',
      ['input_total'],
    );
  for (const model of summary.model
    .split(',')
    .filter((item) => item !== 'unknown')) {
    telemetry.observed_identities.push({
      identity_id: `copilot-model-${telemetry.observed_identities.length + 1}`,
      model,
      provider: {
        availability: 'unavailable',
        value: null,
        reason: 'not_reported',
      },
      effort: {
        availability: 'unavailable',
        value: null,
        reason: 'not_reported',
      },
      provenance: 'telemetry',
    });
  }
  telemetry.observed_identity_availability =
    telemetry.observed_identities.length > 0
      ? { availability: 'available', reason: null }
      : { availability: 'unavailable', reason: 'summary_has_no_model_rows' };
  telemetry.provider_native_usage = Object.entries(values).map(
    ([name, value]) => ({ source, name: `copilot_${name}`, value }),
  );
  telemetry.completeness.collection = 'partial';
  telemetry.completeness.canonical_fields = 'partial';
  telemetry.diagnostics = ['copilot_rounded_display_counts'];
  telemetry.provenance.source_format_version = {
    availability: 'available',
    value: 'copilot-session-summary',
    reason: null,
  };
  return telemetry;
}

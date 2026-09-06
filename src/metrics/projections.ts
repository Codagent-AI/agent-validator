import { randomUUID } from 'node:crypto';
import { canonicalizeJson, createDigest } from './jcs.js';
import {
  type AggregateValue,
  ARTIFACT_SCHEMA_VERSION,
  type AttemptAggregate,
  type ExportRecord,
  MEASUREMENT_SCHEMA_VERSION,
  type ModelAttempt,
  type Snapshot,
  type TokenMeasurements,
} from './types.js';

const tokenNames: Array<keyof TokenMeasurements> = [
  'input_total',
  'input_uncached',
  'cache_read',
  'cache_write',
  'output',
  'reasoning',
  'provider_total',
  'normalized_total',
];

export function selectLatestHeads(records: ModelAttempt[]): {
  records: ModelAttempt[];
  diagnostics: string[];
} {
  const byId = new Map<string, ModelAttempt[]>();
  for (const record of records)
    byId.set(record.attempt_id, [
      ...(byId.get(record.attempt_id) ?? []),
      record,
    ]);
  const diagnostics: string[] = [];
  const heads: ModelAttempt[] = [];
  for (const [id, versions] of byId) {
    const revision = Math.max(...versions.map((item) => item.revision));
    const candidates = versions.filter((item) => item.revision === revision);
    const canonical = new Set(candidates.map((item) => canonicalizeJson(item)));
    if (canonical.size > 1)
      diagnostics.push(`conflicting_revision:${id}:${revision}`);
    const head = candidates[0];
    if (head) heads.push(head);
  }
  return {
    records: heads.sort((a, b) => a.attempt_id.localeCompare(b.attempt_id)),
    diagnostics,
  };
}

function aggregateValue(
  records: ModelAttempt[],
  field: keyof TokenMeasurements,
  incompatible: boolean,
): AggregateValue {
  const eligible = records.length;
  const values = records
    .map((item) => item.tokens[field])
    .filter((item) => item.availability === 'available');
  const value = values.reduce((total, item) => total + item.value, 0);
  const complete =
    !incompatible &&
    values.length === eligible &&
    records.every((item) => item.completeness.history === 'complete');
  let precision: AggregateValue['fidelity'] = null;
  if (values.some((item) => item.precision === 'approximate')) {
    precision = 'approximate';
  } else if (values.length > 0) {
    precision = 'exact';
  }
  let availability: AggregateValue['availability'] = 'unavailable';
  let reason: string | null = 'unavailable_for_all_attempts';
  if (values.length > 0 && complete) {
    availability = 'available';
    reason = null;
  } else if (incompatible) {
    reason = 'incompatible_measurement_version';
  } else if (values.length > 0) {
    reason = 'incomplete_coverage';
  }
  return {
    availability,
    value: values.length > 0 ? value : null,
    reason,
    coverage: {
      eligible_attempt_count: eligible,
      reporting_attempt_count: values.length,
      complete,
    },
    fidelity: precision,
  };
}

/** Reduces latest attempt heads once. It never treats allocations or revisions as additional dispatches. */
export function reduceAttempts(
  records: ModelAttempt[],
  options: { compatible_measurement_versions?: number[] } = {},
): AttemptAggregate {
  const selected = selectLatestHeads(records);
  const compatibleVersions = new Set(
    options.compatible_measurement_versions ?? [MEASUREMENT_SCHEMA_VERSION],
  );
  const compatible = selected.records.filter((record) =>
    compatibleVersions.has(record.measurement_schema_version),
  );
  const incompatible =
    compatible.length !== selected.records.length ||
    selected.diagnostics.length > 0;
  const tokens = Object.fromEntries(
    tokenNames.map((name) => [
      name,
      aggregateValue(compatible, name, incompatible),
    ]),
  ) as Record<keyof TokenMeasurements, AggregateValue>;
  const durations = compatible.map((item) =>
    item.lifecycle.started_at && item.lifecycle.ended_at
      ? Date.parse(item.lifecycle.ended_at) -
        Date.parse(item.lifecycle.started_at)
      : null,
  );
  const completeTimes =
    compatible.length > 0 && durations.every((duration) => duration !== null);
  const starts = compatible.map((item) =>
    item.lifecycle.started_at ? Date.parse(item.lifecycle.started_at) : NaN,
  );
  const ends = compatible.map((item) =>
    item.lifecycle.ended_at ? Date.parse(item.lifecycle.ended_at) : NaN,
  );
  return {
    attempt_count: compatible.length,
    tokens,
    diagnostics: [
      ...selected.diagnostics,
      ...selected.records
        .filter(
          (item) => !compatibleVersions.has(item.measurement_schema_version),
        )
        .map(
          (item) =>
            `incompatible_measurement_version:${item.attempt_id}:${item.measurement_schema_version}`,
        ),
    ],
    work_duration_ms: durations.reduce<number>(
      (sum, duration) => sum + (duration ?? 0),
      0,
    ),
    elapsed_time_ms: completeTimes
      ? Math.max(...ends) - Math.min(...starts)
      : null,
  };
}

/** Produces an immutable consumer record with a digest over the full replacement payload. */
export function projectExport(
  attempts: ModelAttempt[],
  context: { consumer: string; context_id: string },
): { protocol_version: number; records: ExportRecord[] } {
  const heads = selectLatestHeads(attempts);
  return {
    protocol_version: 1,
    records: heads.records.map((payload) => {
      const record: ExportRecord = {
        record_type: 'model_attempt',
        record_id: payload.attempt_id,
        revision: payload.revision,
        measurement_schema_version: payload.measurement_schema_version,
        producer: {
          name: 'agent-validator',
          version: payload.provenance.producer_version,
        },
        original_consumer_context: context,
        payload,
        digest: { algorithm: 'sha256', canonicalization: 'rfc8785', value: '' },
      };
      record.digest = createDigest(record);
      return record;
    }),
  };
}

/** Creates the standalone snapshot from immutable attempt records without changing their versions. */
export function projectSnapshot(
  sessionId: string,
  currentInvocationId: string,
  currentAttempts: ModelAttempt[],
  sessionAttempts: ModelAttempt[],
): Snapshot {
  const sessionHeads = selectLatestHeads(sessionAttempts).records;
  return {
    artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
    measurement_schema_versions: [
      ...new Set(sessionHeads.map((item) => item.measurement_schema_version)),
    ].sort((a, b) => a - b),
    aggregate_measurement_schema_version: MEASUREMENT_SCHEMA_VERSION,
    producer: {
      name: 'agent-validator',
      version: sessionHeads[0]?.provenance.producer_version ?? 'unknown',
    },
    snapshot_id: randomUUID(),
    published_at: new Date().toISOString(),
    session: { session_id: sessionId, state: 'open' },
    current_invocation_id: currentInvocationId,
    invocations: [],
    attempts: sessionHeads,
    aggregates: {
      current_invocation: reduceAttempts(currentAttempts),
      session: reduceAttempts(sessionHeads),
    },
  };
}

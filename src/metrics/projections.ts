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
  conflicting_attempt_ids: string[];
} {
  const byId = new Map<string, ModelAttempt[]>();
  for (const record of records)
    byId.set(record.attempt_id, [
      ...(byId.get(record.attempt_id) ?? []),
      record,
    ]);
  const diagnostics: string[] = [];
  const conflictingAttemptIds: string[] = [];
  const heads: ModelAttempt[] = [];
  for (const [id, versions] of byId) {
    const revision = Math.max(...versions.map((item) => item.revision));
    const candidates = versions.filter((item) => item.revision === revision);
    const canonical = new Set(candidates.map((item) => canonicalizeJson(item)));
    if (canonical.size > 1) {
      diagnostics.push(`conflicting_revision:${id}:${revision}`);
      conflictingAttemptIds.push(id);
    }
    const head = candidates[0];
    if (head) heads.push(head);
  }
  return {
    records: heads.sort((a, b) => a.attempt_id.localeCompare(b.attempt_id)),
    diagnostics,
    conflicting_attempt_ids: conflictingAttemptIds,
  };
}

function aggregateValue(
  records: ModelAttempt[],
  field: keyof TokenMeasurements,
  eligible: ModelAttempt[],
  limitation: string | null,
): AggregateValue {
  const reporting = records.filter(
    (item) => item.tokens[field].availability !== 'unavailable',
  );
  const values = reporting
    .map((item) => item.tokens[field])
    .filter((item) => item.availability !== 'unavailable');
  const partialAttemptIds = reporting
    .filter(
      (item) =>
        item.tokens[field].availability === 'partial' ||
        item.completeness.history !== 'complete' ||
        item.completeness.collection !== 'complete',
    )
    .map((item) => item.attempt_id);
  const reportingIds = new Set(reporting.map((item) => item.attempt_id));
  const missingAttemptIds = eligible
    .filter((item) => !reportingIds.has(item.attempt_id))
    .map((item) => item.attempt_id);
  const value = values.reduce((total, item) => total + item.value, 0);
  const complete =
    !limitation &&
    values.length === eligible.length &&
    partialAttemptIds.length === 0;
  let precision: AggregateValue['fidelity'] = null;
  if (values.some((item) => item.precision === 'approximate')) {
    precision = 'approximate';
  } else if (values.length > 0) {
    precision = 'exact';
  }
  let availability: AggregateValue['availability'] =
    values.length > 0 ? 'partial' : 'unavailable';
  let reason: string | null = 'unavailable_for_all_attempts';
  if (values.length > 0 && complete) {
    availability = 'available';
    reason = null;
  } else if (limitation) {
    reason = limitation;
  } else if (values.length > 0) {
    reason = 'incomplete_coverage';
  }
  const partialReasons = values
    .filter((item) => item.availability === 'partial')
    .map((item) => item.reason);
  if (partialReasons.length > 0) {
    reason = [
      ...new Set([...partialReasons, ...(limitation ? [limitation] : [])]),
    ]
      .sort()
      .join(';');
  }
  return {
    availability,
    value: values.length > 0 ? value : null,
    reason,
    coverage: {
      eligible_attempt_count: eligible.length,
      reporting_attempt_count: values.length,
      partial_attempt_ids: partialAttemptIds,
      missing_attempt_ids: missingAttemptIds,
      complete,
    },
    fidelity: precision,
  };
}

/** Reduces latest attempt heads once. It never treats allocations or revisions as additional dispatches. */
export function reduceAttempts(records: ModelAttempt[]): AttemptAggregate {
  const selected = selectLatestHeads(records);
  // This release implements only v1 semantics. A version list is not a
  // reviewed conversion, and callers cannot opt unknown payloads into totals.
  const compatible = selected.records.filter(
    (record) =>
      record.measurement_schema_version === MEASUREMENT_SCHEMA_VERSION,
  );
  const unambiguous = compatible.filter(
    (record) => !selected.conflicting_attempt_ids.includes(record.attempt_id),
  );
  let limitation: string | null = null;
  if (compatible.length !== selected.records.length)
    limitation = 'incompatible_measurement_version';
  else if (selected.diagnostics.length > 0) limitation = 'conflicting_revision';
  const tokens = Object.fromEntries(
    tokenNames.map((name) => [
      name,
      aggregateValue(unambiguous, name, selected.records, limitation),
    ]),
  ) as Record<keyof TokenMeasurements, AggregateValue>;
  const durations = unambiguous.map((item) =>
    item.lifecycle.started_at && item.lifecycle.ended_at
      ? Date.parse(item.lifecycle.ended_at) -
        Date.parse(item.lifecycle.started_at)
      : null,
  );
  const completeTimes =
    !limitation &&
    unambiguous.length > 0 &&
    durations.every((duration) => duration !== null);
  const starts = unambiguous.map((item) =>
    item.lifecycle.started_at ? Date.parse(item.lifecycle.started_at) : NaN,
  );
  const ends = unambiguous.map((item) =>
    item.lifecycle.ended_at ? Date.parse(item.lifecycle.ended_at) : NaN,
  );
  return {
    attempt_count: compatible.length,
    tokens,
    diagnostics: [
      ...selected.diagnostics,
      ...selected.records
        .filter(
          (item) =>
            item.measurement_schema_version !== MEASUREMENT_SCHEMA_VERSION,
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
  if (heads.diagnostics.length > 0)
    throw new Error(heads.diagnostics.join(';'));
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
  publication: { snapshot_id: string; published_at: string },
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
    snapshot_id: publication.snapshot_id,
    published_at: publication.published_at,
    session: { session_id: sessionId, state: 'open' },
    current_invocation_id: currentInvocationId,
    invocations: [],
    attempts: sessionHeads,
    aggregates: {
      current_invocation: reduceAttempts(currentAttempts),
      session: reduceAttempts(sessionAttempts),
    },
  };
}

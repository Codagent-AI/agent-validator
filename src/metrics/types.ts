/** Version constants are deliberately independent contract axes. */
export const MEASUREMENT_SCHEMA_VERSION = 1;
export const ARTIFACT_SCHEMA_VERSION = 1;
export const PROTOCOL_VERSION = 1;
export const CAPABILITIES_VERSION = 1;
/** Private on-disk format; never exported as a public compatibility promise. */
export const STORAGE_VERSION = 1;

export type Availability = 'available' | 'unavailable';
export type Precision = 'exact' | 'approximate';
export type ValueSource =
  | 'provider_usage'
  | 'provider_display'
  | 'provider_event'
  | 'validator_derivation';
export type ValueOrigin = 'observed' | 'derived';
export type Completeness = 'complete' | 'partial' | 'unavailable';

export interface AvailableValue<T> {
  availability: 'available';
  value: T;
  reason: null;
  source: ValueSource;
  origin: ValueOrigin;
  precision: Precision;
  derivation: string | null;
  included_in: string[] | null;
}
export interface UnavailableValue {
  availability: 'unavailable';
  value: null;
  reason: string;
  source: null;
  origin: null;
  precision: null;
  derivation: null;
  included_in: null;
}
export type MeasurementValue<T> = AvailableValue<T> | UnavailableValue;

export interface IdentityValue {
  adapter: string | null;
  model: string | null;
  provider: string | null;
  effort: string | null;
  provenance: 'configuration' | 'launch_resolution' | 'telemetry';
}
export interface ObservedIdentity {
  identity_id: string;
  model: string;
  provider: Pick<MeasurementValue<string>, 'availability' | 'value' | 'reason'>;
  effort: Pick<MeasurementValue<string>, 'availability' | 'value' | 'reason'>;
  provenance: 'telemetry';
}

export interface TokenMeasurements {
  input_total: MeasurementValue<number>;
  input_uncached: MeasurementValue<number>;
  cache_read: MeasurementValue<number>;
  cache_write: MeasurementValue<number>;
  output: MeasurementValue<number>;
  reasoning: MeasurementValue<number>;
  provider_total: MeasurementValue<number>;
  normalized_total: MeasurementValue<number>;
}

export interface UsageAllocation {
  allocation_id: string;
  observed_identity_ref: string;
  usage: Pick<TokenMeasurements, 'normalized_total'>;
}
export interface UnallocatedUsage {
  allocation_id: string;
  observed_identity_ref: { availability: 'unavailable'; reason: string };
  usage: Pick<TokenMeasurements, 'normalized_total'>;
}
export interface ReportedCost {
  cost_evidence_id: string;
  amount: MeasurementValue<number>;
  currency: Pick<MeasurementValue<string>, 'availability' | 'value' | 'reason'>;
  scope: 'attempt' | 'allocation' | 'unavailable';
  allocation_id?: string;
  coverage: 'full' | 'partial' | 'unknown';
  overlap: 'established' | 'unknown';
  source: ValueSource;
}

export interface ModelAttempt {
  record_type: 'model_attempt';
  attempt_id: string;
  revision: number;
  measurement_schema_version: number;
  session_id: string;
  invocation_id: string;
  lifecycle: {
    state: 'prepared' | 'running' | 'completed' | 'failed' | 'interrupted';
    started_at: string | null;
    ended_at: string | null;
  };
  adapter: string;
  outcome: 'passed' | 'failed' | 'error' | 'interrupted' | 'unknown';
  requested_identity: IdentityValue;
  resolved_identity: IdentityValue;
  observed_identities: ObservedIdentity[];
  observed_identity_availability: {
    availability: 'available' | 'unavailable';
    reason: string | null;
  };
  tokens: TokenMeasurements;
  provider_native_usage: Array<{
    source: ValueSource;
    name: string;
    value: number | string;
  }>;
  completeness: {
    history: Completeness;
    collection: Completeness;
    canonical_fields: Completeness;
    normalized_total: Completeness;
    per_model_attribution: 'complete' | 'partial' | 'unavailable';
  };
  allocations: UsageAllocation[];
  unallocated_usage: UnallocatedUsage | null;
  provider_reported_costs: ReportedCost[];
  provenance: {
    producer_version: string;
    build: Pick<MeasurementValue<string>, 'availability' | 'value' | 'reason'>;
    adapter_mapping_version: string;
    cli_version: Pick<
      MeasurementValue<string>,
      'availability' | 'value' | 'reason'
    >;
    source_format_version: Pick<
      MeasurementValue<string>,
      'availability' | 'value' | 'reason'
    >;
  };
  diagnostics: string[];
  review_context?: { gate: string; slot: number };
}

export interface Invocation {
  record_type: 'invocation';
  invocation_id: string;
  revision: number;
  measurement_schema_version: number;
  session_id: string;
  lifecycle: {
    state: 'running' | 'completed' | 'failed' | 'interrupted';
    started_at: string | null;
    ended_at: string | null;
  };
  attempt_ids: string[];
  zero_dispatch: boolean;
  diagnostics: string[];
}

export interface Digest {
  algorithm: 'sha256';
  canonicalization: 'rfc8785';
  value: string;
}
export interface ExportRecord {
  record_type: 'invocation' | 'model_attempt';
  record_id: string;
  revision: number;
  measurement_schema_version: number;
  producer: { name: 'agent-validator'; version: string };
  original_consumer_context: { consumer: string; context_id: string };
  payload: Invocation | ModelAttempt;
  digest: Digest;
}

export interface AggregateValue {
  availability: Availability;
  value: number | null;
  reason: string | null;
  coverage: {
    eligible_attempt_count: number;
    reporting_attempt_count: number;
    complete: boolean;
  };
  fidelity: Precision | null;
}
export interface AttemptAggregate {
  attempt_count: number;
  tokens: Record<keyof TokenMeasurements, AggregateValue>;
  diagnostics: string[];
  work_duration_ms: number;
  elapsed_time_ms: number | null;
}
export interface Snapshot {
  artifact_schema_version: number;
  measurement_schema_versions: number[];
  aggregate_measurement_schema_version: number;
  producer: { name: 'agent-validator'; version: string };
  snapshot_id: string;
  published_at: string;
  session: { session_id: string; state: string };
  current_invocation_id: string;
  invocations: Invocation[];
  attempts: ModelAttempt[];
  aggregates: {
    current_invocation: AttemptAggregate;
    session: AttemptAggregate;
  };
}

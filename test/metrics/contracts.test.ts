import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalizeJson,
  createDigest,
  parseJsonStrict,
  verifyDigest,
} from '../../src/metrics/jcs.js';
import {
  projectExport,
  projectSnapshot,
  selectLatestHeads,
  reduceAttempts,
} from '../../src/metrics/projections.js';
import {
  validateAttempt,
  validateCapabilities,
  validateExportRecord,
} from '../../src/metrics/validation.js';
import type { ModelAttempt } from '../../src/metrics/types.js';

const available = (value: number, inclusion?: string[]) => ({
  availability: 'available' as const,
  value,
  reason: null,
  source: 'provider_usage' as const,
  origin: 'observed' as const,
  precision: 'exact' as const,
  derivation: null,
  included_in: inclusion ?? null,
});

const unavailable = (reason = 'not_reported') => ({
  availability: 'unavailable' as const,
  value: null,
  reason,
  source: null,
  origin: null,
  precision: null,
  derivation: null,
  included_in: null,
});

function attempt(overrides: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    record_type: 'model_attempt',
    attempt_id: 'attempt-1',
    revision: 1,
    measurement_schema_version: 1,
    session_id: 'session-1',
    invocation_id: 'invocation-1',
    lifecycle: { state: 'completed', started_at: '2026-09-06T12:00:00.000Z', ended_at: '2026-09-06T12:00:10.000Z' },
    adapter: 'codex',
    outcome: 'passed',
    requested_identity: { adapter: 'codex', model: 'requested', provider: 'openai', effort: null, provenance: 'configuration' },
    resolved_identity: { adapter: 'codex', model: 'resolved', provider: 'openai', effort: null, provenance: 'launch_resolution' },
    observed_identities: [],
    observed_identity_availability: { availability: 'unavailable', reason: 'not_reported' },
    tokens: {
      input_total: available(100), input_uncached: unavailable(), cache_read: available(40, ['input_total']),
      cache_write: unavailable(), output: available(30), reasoning: available(10, ['output']), provider_total: unavailable(),
      normalized_total: available(130),
    },
    provider_native_usage: [],
    completeness: { history: 'complete', collection: 'complete', canonical_fields: 'partial', normalized_total: 'complete', per_model_attribution: 'unavailable' },
    allocations: [],
    unallocated_usage: null,
    provider_reported_costs: [],
    provenance: { producer_version: '1.13.2', build: { availability: 'unavailable', value: null, reason: 'not_injected' }, adapter_mapping_version: 'codex-v1', cli_version: { availability: 'unavailable', value: null, reason: 'not_reported' }, source_format_version: { availability: 'unavailable', value: null, reason: 'not_reported' } },
    diagnostics: [],
    ...overrides,
  };
}

describe('RFC 8785 canonical record digests', () => {
  test('replays numeric limits, escaping and UTF-16 key ordering from shared bytes', async () => {
    const directory = path.resolve(import.meta.dir, '../../contracts/model-metrics/v1');
    const manifest = JSON.parse(await readFile(path.join(directory, 'fixture-manifest.json'), 'utf8'));
    const entry = manifest.cases.find((item: { name: string }) => item.name === 'numeric-limits-utf16-escaping');
    expect(entry).toBeDefined();
    const original = await readFile(path.join(directory, entry.original_json), 'utf8');
    const canonical = await readFile(path.join(directory, entry.canonical_utf8), 'utf8');
    const parsed = parseJsonStrict(original);
    expect(canonicalizeJson(parsed)).toBe(canonical.trimEnd());
    expect(createDigest(parsed as object).value).toBe(entry.expected_digest);
  });
  test('rejects trailing high surrogates in values and keys', () => {
    expect(() => canonicalizeJson('\ud800')).toThrow('Invalid Unicode');
    expect(() => canonicalizeJson({ ['key\ud800']: 1 })).toThrow('Invalid Unicode');
  });
  test('canonicalizes nested keys, Unicode, signed zero, and exponents deterministically', () => {
    expect(canonicalizeJson({ z: -0, 'é': 1e-7, a: ['\u000f', 1.5] })).toBe('{"a":["\\u000f",1.5],"z":0,"é":1e-7}');
  });

  test('rejects duplicate names and non-finite numbers before they become evidence', () => {
    expect(() => parseJsonStrict('{"record_id":"a","record_id":"b"}')).toThrow('Duplicate object key');
    expect(() => canonicalizeJson({ count: Number.NaN })).toThrow('finite');
  });

  test('parses a valid JSON string ending in a literal backslash', () => {
    expect(parseJsonStrict('{"path":"\\\\"}')).toEqual({ path: '\\' });
  });

  test('replays the pinned canonical fixture bytes and digest', async () => {
    const root = path.resolve(import.meta.dir, '../..');
    const original = await readFile(path.join(root, 'contracts/model-metrics/v1/fixtures/fraction-unicode-signed-zero.json'), 'utf8');
    const canonical = await readFile(path.join(root, 'contracts/model-metrics/v1/fixtures/fraction-unicode-signed-zero.canonical.json'), 'utf8');
    const parsed = parseJsonStrict(original);
    expect(canonicalizeJson(parsed)).toBe(canonical.trim());
    expect(
      createDigest({
        ...(parsed as Record<string, unknown>),
        digest: { algorithm: 'sha256', canonicalization: 'rfc8785', value: '' },
      }).value,
    ).toBe('be8bd2e33a794d5023c73042b0538905b807428de7045f72245514f05416b4b1');
  });

  test('hashes a complete replacement record excluding only its digest and verifies equivalent JSON', () => {
    const record = {
      record_type: 'model_attempt', record_id: 'attempt-1', revision: 1, measurement_schema_version: 1,
      producer: { name: 'agent-validator', version: '1.13.2' }, original_consumer_context: { consumer: 'runner', context_id: 'opaque-1' },
      payload: attempt(), digest: { algorithm: 'sha256', canonicalization: 'rfc8785', value: '' },
    };
    record.digest.value = createDigest(record).value;
    expect(verifyDigest(record).valid).toBe(true);
    expect(verifyDigest({ ...record, payload: { ...record.payload, adapter: 'claude' } }).valid).toBe(false);
  });
});

describe('closed measurement contracts', () => {
  test('replays pinned semantic replacement, allocation-cost and unsupported-version fixtures', async () => {
    const directory = path.resolve(import.meta.dir, '../../contracts/model-metrics/v1');
    const manifest = JSON.parse(await readFile(path.join(directory, 'fixture-manifest.json'), 'utf8'));
    expect(manifest.semantic_cases?.map((entry: { name: string }) => entry.name)).toEqual([
      'two-model-allocation-cost', 'overlapping-cost-scopes', 'prepared-terminal-replacement', 'unsupported-current-head',
    ]);
    for (const entry of manifest.semantic_cases) {
      const fixture = JSON.parse(await readFile(path.join(directory, entry.original_json), 'utf8'));
      const canonical = await readFile(path.join(directory, entry.canonical_utf8), 'utf8');
      expect(canonicalizeJson(fixture)).toBe(canonical.trimEnd());
      expect(createDigest(fixture).value).toBe(entry.expected_digest);
      expect(fixture.records.map((record: unknown) => validateAttempt(record).success)).toEqual(fixture.expected.valid_records);
      const heads = selectLatestHeads(fixture.records);
      expect(heads.records.map((record) => ({ attempt_id: record.attempt_id, revision: record.revision }))).toEqual(fixture.expected.heads);
      const aggregate = reduceAttempts(fixture.records);
      expect(aggregate.attempt_count).toBe(fixture.expected.attempt_count);
      expect(aggregate.tokens.normalized_total).toMatchObject(fixture.expected.normalized_total);
      for (const record of fixture.records.filter((record: ModelAttempt) => record.measurement_schema_version === 1)) {
        const projected = projectExport([record], { consumer: 'runner', context_id: 'fixture-context' }).records[0]!;
        expect(projected.payload).toEqual(record);
        expect(validateExportRecord(projected).success).toBe(true);
      }
    }
  });
  test('ships pinned v1 schema and compatibility fixture assets', async () => {
    const root = path.resolve(import.meta.dir, '../..');
    const manifest = JSON.parse(await readFile(path.join(root, 'contracts/model-metrics/v1/fixture-manifest.json'), 'utf8'));
    const schema = JSON.parse(await readFile(path.join(root, 'contracts/model-metrics/v1/model-attempt.schema.json'), 'utf8'));
    const artifact = JSON.parse(await readFile(path.join(root, 'contracts/validator-metrics/v1/validation-metrics.schema.json'), 'utf8'));
    expect(manifest.fixture_version).toBe(1);
    expect(manifest.cases.some((item: { expected_digest: string }) => /^[a-f0-9]{64}$/.test(item.expected_digest))).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(artifact.properties.artifact_schema_version.const).toBe(1);
  });

  test('keeps published schema string evidence and nested usage shapes aligned with runtime validation', async () => {
    const root = path.resolve(import.meta.dir, '../..');
    const schema = JSON.parse(await readFile(path.join(root, 'contracts/model-metrics/v1/model-attempt.schema.json'), 'utf8'));
    expect(schema.$defs.stringEvidence).toBeDefined();
    expect(schema.$defs.observedIdentity.properties.provider.$ref).toBe('#/$defs/stringEvidence');
    expect(schema.$defs.allocation.properties.usage.$ref).toBe('#/$defs/usage');
    expect(schema.$defs.usage).toEqual({ type: 'object', additionalProperties: false, required: ['normalized_total'], properties: { normalized_total: { $ref: '#/$defs/measurement' } } });
    expect(schema.$defs.cost.properties.amount.$ref).toBe('#/$defs/decimalMeasurement');
  });

  test('preserves declared optional evidence and rejects undeclared fields and invalid exact token counts', () => {
    expect(validateAttempt(attempt()).success).toBe(true);
    expect(validateAttempt({ ...attempt(), review_context: { gate: 'security', slot: 2 } }).success).toBe(true);
    expect(validateAttempt({ ...attempt(), invented_optional_field: true }).success).toBe(false);
    expect(validateAttempt({ ...attempt(), tokens: { ...attempt().tokens, input_total: available(1.5) } }).success).toBe(false);
  });

  test('does not allow prompts, credentials, or principal and host identifiers into native evidence or diagnostics', () => {
    expect(validateAttempt({ ...attempt(), provider_native_usage: [{ source: 'provider_event', name: 'prompt', value: 'secret prompt' }] }).success).toBe(false);
    expect(validateAttempt({ ...attempt(), diagnostics: ['account_id=user@example.test'] }).success).toBe(false);
  });

  test('requires capability limits to be typed, bounded, and internally consistent', () => {
    expect(validateCapabilities({
      capabilities_version: 1, protocol_versions: [1], measurement_schema_versions: [1],
      limits: { default_inventory_count: 10, maximum_inventory_count: 20, default_export_count: 5, maximum_export_count: 10, default_export_bytes: 1000, maximum_export_bytes: 2000, maximum_individual_record_bytes: 1500 },
    }).success).toBe(true);
    expect(validateCapabilities({
      capabilities_version: 1, protocol_versions: [1], measurement_schema_versions: [1],
      limits: { default_inventory_count: 21, maximum_inventory_count: 20, default_export_count: 5, maximum_export_count: 10, default_export_bytes: 1000, maximum_export_bytes: 2000, maximum_individual_record_bytes: 1500 },
    }).success).toBe(false);
  });
});

describe('accounting and deterministic projections', () => {
  test('uses caller-owned snapshot identity and time deterministically', () => {
    const publication = { snapshot_id: 'snapshot-fixed', published_at: '2026-09-06T12:00:11.000Z' };
    const first = projectSnapshot('session-1', 'invocation-1', [attempt()], [attempt()], publication);
    const second = projectSnapshot('session-1', 'invocation-1', [attempt()], [attempt()], publication);
    expect(first).toEqual(second);
    expect(first.snapshot_id).toBe(publication.snapshot_id);
    expect(first.published_at).toBe(publication.published_at);
  });
  test('does not double count cached input or reasoning already included by containing fields', () => {
    const reduced = reduceAttempts([attempt()]);
    expect(reduced.tokens.normalized_total.value).toBe(130);
    expect(reduced.tokens.normalized_total.availability).toBe('available');
    expect(reduced.tokens.cache_read.value).toBe(40);
    expect(reduced.attempt_count).toBe(1);
  });

  test('keeps known subtotals but marks coverage incomplete when another attempt cannot report a category', () => {
    const reduced = reduceAttempts([attempt(), attempt({ attempt_id: 'attempt-2', tokens: { ...attempt().tokens, cache_read: unavailable(), normalized_total: unavailable('overlap_unknown') } })]);
    expect(reduced.tokens.cache_read.value).toBe(40);
    expect(reduced.tokens.cache_read.coverage.complete).toBe(false);
    expect(reduced.tokens.normalized_total.availability).toBe('unavailable');
  });

  test('does not present partial dispatch collection as a complete aggregate', () => {
    const reduced = reduceAttempts([attempt({ completeness: { ...attempt().completeness, collection: 'partial' } })]);
    expect(reduced.tokens.normalized_total.value).toBe(130);
    expect(reduced.tokens.normalized_total.availability).toBe('unavailable');
    expect(reduced.tokens.normalized_total.coverage.complete).toBe(false);
  });

  test('does not derive uncached input when cache-write inclusion is unknown', () => {
    const source = attempt({ tokens: { ...attempt().tokens, input_uncached: unavailable(), cache_write: unavailable('not_reported'), normalized_total: unavailable('not_enough_components') } });
    expect(reduceAttempts([source]).tokens.input_uncached.availability).toBe('unavailable');
  });

  test('selects one latest head, diagnoses conflicts, and never falls back to an older compatible revision', () => {
    const heads = selectLatestHeads([
      attempt({ revision: 1 }),
      attempt({ revision: 2, measurement_schema_version: 99 }),
      attempt({ revision: 2, measurement_schema_version: 99, adapter: 'conflict' }),
    ]);
    expect(heads.records).toHaveLength(1);
    expect(heads.records[0]?.measurement_schema_version).toBe(99);
    expect(heads.diagnostics).toContain('conflicting_revision:attempt-1:2');
  });

  test('combines a future test-only version only with an explicitly reviewed mapping', () => {
    const future = attempt({ attempt_id: 'future', measurement_schema_version: 2 as number });
    expect(reduceAttempts([attempt(), future]).attempt_count).toBe(1);
    expect(reduceAttempts([attempt(), future], { compatible_measurement_versions: [1, 2] }).attempt_count).toBe(2);
  });

  test('projects partial allocation, unallocated usage, and allocation-scoped cost without pricing', () => {
    const model = attempt({
      observed_identities: [{ identity_id: 'identity-a', model: 'A', provider: { availability: 'available', value: 'provider', reason: null }, effort: { availability: 'unavailable', value: null, reason: 'not_reported' }, provenance: 'telemetry' }],
      completeness: { ...attempt().completeness, per_model_attribution: 'partial' },
      allocations: [{ allocation_id: 'allocation-a', observed_identity_ref: 'identity-a', usage: { normalized_total: available(100) } }],
      unallocated_usage: { allocation_id: 'unallocated-1', observed_identity_ref: { availability: 'unavailable', reason: 'aggregate_only' }, usage: { normalized_total: available(50) } },
      provider_reported_costs: [{ cost_evidence_id: 'cost-a', amount: available(12.5), currency: { availability: 'available', value: 'USD', reason: null }, scope: 'allocation', allocation_id: 'allocation-a', coverage: 'full', overlap: 'unknown', source: 'provider_usage' }],
    });
    const exported = projectExport([model], { consumer: 'runner', context_id: 'opaque-1' });
    expect(exported.records[0]?.payload).toEqual(model);
    expect(exported.records[0]?.digest.value).toMatch(/^[a-f0-9]{64}$/);
    expect(projectSnapshot('session-1', 'invocation-1', [model], [attempt()], { snapshot_id: 'snapshot-1', published_at: '2026-09-06T12:00:11.000Z' }).aggregates.current_invocation.attempt_count).toBe(1);
  });

  test('rejects export records with invalid allocation or cost references', () => {
    const bad = projectExport([attempt({ provider_reported_costs: [{ cost_evidence_id: 'cost', amount: available(1), currency: { availability: 'available', value: 'USD', reason: null }, scope: 'allocation', allocation_id: 'missing', coverage: 'full', overlap: 'unknown', source: 'provider_usage' }] })], { consumer: 'runner', context_id: 'opaque' }).records[0];
    expect(validateExportRecord(bad).success).toBe(false);
  });

  test('rejects tampered export envelopes and payload metadata mismatches', () => {
    const record = projectExport([attempt()], { consumer: 'runner', context_id: 'opaque' }).records[0]!;
    expect(validateExportRecord(record).success).toBe(true);
    expect(validateExportRecord({ ...record, revision: 2 }).success).toBe(false);
    expect(validateExportRecord({ ...record, payload: { ...record.payload, adapter: 'tampered' } }).success).toBe(false);
  });

  test('validates invocation payloads and reports the same metadata errors as attempt payloads', () => {
    const payload = {
      record_type: 'invocation', invocation_id: 'invocation-1', session_id: 'session-1', revision: 1,
      measurement_schema_version: 1, lifecycle: { state: 'completed', started_at: '2026-09-06T12:00:00.000Z', ended_at: '2026-09-06T12:00:10.000Z' },
      attempt_ids: [], zero_dispatch: true, diagnostics: [],
    };
    const record = {
      record_type: 'invocation', record_id: 'invocation-1', revision: 1, measurement_schema_version: 1,
      producer: { name: 'agent-validator', version: 'fixture' }, original_consumer_context: { consumer: 'runner', context_id: 'opaque' }, payload,
    };
    const sign = (value: object) => ({ ...value, digest: createDigest(value) });
    expect(validateExportRecord(sign(record)).success).toBe(true);
    for (const [candidate, expectedPath] of [
      [{ ...record, record_id: 'different' }, ['record_id']],
      [{ ...record, revision: 2 }, ['revision']],
      [{ ...record, payload: { ...payload, zero_dispatch: 'invalid' } }, ['payload']],
    ] as const) {
      const result = validateExportRecord(sign(candidate));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual([...expectedPath]);
    }
  });
});

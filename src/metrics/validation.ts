import { z } from 'zod';
import { verifyDigest } from './jcs.js';

const nonEmpty = z.string().min(1);
const consumerContext = z
  .object({ consumer: nonEmpty, context_id: nonEmpty })
  .strict();
const exactInteger = z.number().int().safe().nonnegative();
const numberValue = z.number().finite().nonnegative();
const source = z.enum([
  'provider_usage',
  'provider_display',
  'provider_event',
  'validator_derivation',
]);
const unavailable = z
  .object({
    availability: z.literal('unavailable'),
    value: z.null(),
    reason: nonEmpty,
    source: z.null(),
    origin: z.null(),
    precision: z.null(),
    derivation: z.null(),
    included_in: z.null(),
  })
  .strict();
const available = z
  .object({
    availability: z.literal('available'),
    value: numberValue,
    reason: z.null(),
    source,
    origin: z.enum(['observed', 'derived']),
    precision: z.enum(['exact', 'approximate']),
    derivation: z.string().nullable(),
    included_in: z.array(nonEmpty).nullable(),
  })
  .strict();
const tokenValue = z.union([
  available.extend({ value: exactInteger }),
  unavailable,
]);
const stringEvidence = z.union([
  z
    .object({
      availability: z.literal('available'),
      value: nonEmpty,
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      value: z.null(),
      reason: nonEmpty,
    })
    .strict(),
]);
const identity = z
  .object({
    adapter: z.string().nullable(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    effort: z.string().nullable(),
    provenance: z.enum(['configuration', 'launch_resolution', 'telemetry']),
  })
  .strict();

const tokens = z
  .object({
    input_total: tokenValue,
    input_uncached: tokenValue,
    cache_read: tokenValue,
    cache_write: tokenValue,
    output: tokenValue,
    reasoning: tokenValue,
    provider_total: tokenValue,
    normalized_total: tokenValue,
  })
  .strict();
const allocation = z
  .object({
    allocation_id: nonEmpty,
    observed_identity_ref: nonEmpty,
    usage: z.object({ normalized_total: tokenValue }).strict(),
  })
  .strict();
const unallocated = z
  .object({
    allocation_id: nonEmpty,
    observed_identity_ref: z
      .object({ availability: z.literal('unavailable'), reason: nonEmpty })
      .strict(),
    usage: z.object({ normalized_total: tokenValue }).strict(),
  })
  .strict();
const cost = z
  .object({
    cost_evidence_id: nonEmpty,
    amount: z.union([available, unavailable]),
    currency: stringEvidence,
    scope: z.enum(['attempt', 'allocation', 'unavailable']),
    allocation_id: nonEmpty.optional(),
    coverage: z.enum(['full', 'partial', 'unknown']),
    overlap: z.enum(['established', 'unknown']),
    source,
  })
  .strict();
const nativeUsageNames = new Set([
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'total_tokens',
  'request_count',
  'provider_session_id',
  'reported_cost',
]);
const prohibitedEvidence =
  /(?:prompt|response|credential|password|api[_ -]?key|account|user|organization|email|host|machine)/i;

export const modelAttemptSchema = z
  .object({
    record_type: z.literal('model_attempt'),
    attempt_id: nonEmpty,
    revision: z.number().int().positive(),
    measurement_schema_version: z.literal(1),
    session_id: nonEmpty,
    invocation_id: nonEmpty,
    lifecycle: z
      .object({
        state: z.enum([
          'prepared',
          'running',
          'completed',
          'failed',
          'interrupted',
        ]),
        started_at: z.string().datetime().nullable(),
        ended_at: z.string().datetime().nullable(),
      })
      .strict(),
    adapter: nonEmpty,
    outcome: z.enum(['passed', 'failed', 'error', 'interrupted', 'unknown']),
    requested_identity: identity,
    resolved_identity: identity,
    observed_identities: z.array(
      z
        .object({
          identity_id: nonEmpty,
          model: nonEmpty,
          provider: stringEvidence,
          effort: stringEvidence,
          provenance: z.literal('telemetry'),
        })
        .strict(),
    ),
    observed_identity_availability: z
      .object({
        availability: z.enum(['available', 'unavailable']),
        reason: z.string().nullable(),
      })
      .strict(),
    tokens,
    provider_native_usage: z.array(
      z
        .object({
          source,
          name: nonEmpty,
          value: z.union([z.string(), numberValue]),
        })
        .strict(),
    ),
    completeness: z
      .object({
        history: z.enum(['complete', 'partial', 'unavailable']),
        collection: z.enum(['complete', 'partial', 'unavailable']),
        canonical_fields: z.enum(['complete', 'partial', 'unavailable']),
        normalized_total: z.enum(['complete', 'partial', 'unavailable']),
        per_model_attribution: z.enum(['complete', 'partial', 'unavailable']),
      })
      .strict(),
    allocations: z.array(allocation),
    unallocated_usage: unallocated.nullable(),
    provider_reported_costs: z.array(cost),
    provenance: z
      .object({
        producer_version: nonEmpty,
        build: stringEvidence,
        adapter_mapping_version: nonEmpty,
        cli_version: stringEvidence,
        source_format_version: stringEvidence,
      })
      .strict(),
    diagnostics: z.array(nonEmpty),
    review_context: z
      .object({ gate: nonEmpty, slot: z.number().int().nonnegative() })
      .strict()
      .optional(),
    consumer_context: consumerContext.nullable().optional(),
  })
  .strict()
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Contract cross-field validation keeps all revision-local reference rules together.
  .superRefine((attempt, ctx) => {
    const identityIds = new Set(
      attempt.observed_identities.map((item) => item.identity_id),
    );
    const allocationIds = new Set(
      attempt.allocations.map((item) => item.allocation_id),
    );
    for (const row of attempt.allocations)
      if (!identityIds.has(row.observed_identity_ref))
        ctx.addIssue({
          code: 'custom',
          path: ['allocations'],
          message:
            'Allocation identity reference must resolve within the attempt',
        });
    for (const row of attempt.provider_reported_costs) {
      if (
        row.scope === 'allocation' &&
        !(row.allocation_id && allocationIds.has(row.allocation_id))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['provider_reported_costs'],
          message: 'Allocation cost reference must resolve within the attempt',
        });
      if (row.scope !== 'allocation' && row.allocation_id)
        ctx.addIssue({
          code: 'custom',
          path: ['provider_reported_costs'],
          message: 'Only allocation cost may carry allocation_id',
        });
    }
    for (const [name, token] of Object.entries(attempt.tokens))
      if (
        token.availability === 'available' &&
        token.origin === 'derived' &&
        !token.derivation
      )
        ctx.addIssue({
          code: 'custom',
          path: ['tokens', name],
          message: 'Derived measurements require a derivation',
        });
    for (const native of attempt.provider_native_usage)
      if (!nativeUsageNames.has(native.name))
        ctx.addIssue({
          code: 'custom',
          path: ['provider_native_usage'],
          message: 'Provider-native evidence name is not allowlisted',
        });
    for (const diagnostic of attempt.diagnostics)
      if (prohibitedEvidence.test(diagnostic))
        ctx.addIssue({
          code: 'custom',
          path: ['diagnostics'],
          message: 'Diagnostics must not contain prohibited evidence',
        });
  });

const invocationSchema = z
  .object({
    record_type: z.literal('invocation'),
    invocation_id: nonEmpty,
    revision: z.number().int().positive(),
    measurement_schema_version: z.literal(1),
    session_id: nonEmpty,
    lifecycle: z
      .object({
        state: z.enum(['running', 'completed', 'failed', 'interrupted']),
        started_at: z.string().datetime().nullable(),
        ended_at: z.string().datetime().nullable(),
      })
      .strict(),
    attempt_ids: z.array(nonEmpty),
    zero_dispatch: z.boolean(),
    diagnostics: z.array(nonEmpty),
    command: z.enum(['run', 'check', 'review']).optional(),
    consumer_context: consumerContext.nullable().optional(),
    outcome: z.string().nullable().optional(),
  })
  .strict();

function validateEnvelopeMetadata(
  record: {
    record_type: 'invocation' | 'model_attempt';
    revision: number;
    measurement_schema_version: number;
  },
  payload: {
    record_type: 'invocation' | 'model_attempt';
    revision: number;
    measurement_schema_version: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (record.record_type !== payload.record_type)
    ctx.addIssue({
      code: 'custom',
      path: ['record_type'],
      message: 'Record type must match complete replacement payload',
    });
  if (record.revision !== payload.revision)
    ctx.addIssue({
      code: 'custom',
      path: ['revision'],
      message: 'Revision must match complete replacement payload',
    });
  if (record.measurement_schema_version !== payload.measurement_schema_version)
    ctx.addIssue({
      code: 'custom',
      path: ['measurement_schema_version'],
      message:
        'Measurement schema version must match complete replacement payload',
    });
}

const exportRecordSchema = z
  .object({
    record_type: z.enum(['invocation', 'model_attempt']),
    record_id: nonEmpty,
    revision: z.number().int().positive(),
    measurement_schema_version: z.literal(1),
    producer: z
      .object({ name: z.literal('agent-validator'), version: nonEmpty })
      .strict(),
    original_consumer_context: consumerContext,
    payload: z.unknown(),
    digest: z
      .object({
        algorithm: z.literal('sha256'),
        canonicalization: z.literal('rfc8785'),
        value: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (!verifyDigest(record).valid)
      ctx.addIssue({
        code: 'custom',
        path: ['digest', 'value'],
        message: 'Digest does not match complete record contents',
      });
    const payloadSchema =
      record.record_type === 'model_attempt'
        ? modelAttemptSchema
        : invocationSchema;
    const result = payloadSchema.safeParse(record.payload);
    if (!result.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: result.error.issues[0]?.message ?? 'Invalid payload',
      });
      return;
    }
    const payload = result.data;
    const payloadId =
      payload.record_type === 'model_attempt'
        ? payload.attempt_id
        : payload.invocation_id;
    if (payloadId !== record.record_id)
      ctx.addIssue({
        code: 'custom',
        path: ['record_id'],
        message: 'Record id must match complete replacement payload',
      });
    validateEnvelopeMetadata(record, payload, ctx);
  });

export const capabilitiesSchema = z
  .object({
    capabilities_version: z.literal(1),
    protocol_versions: z.array(z.literal(1)).min(1),
    measurement_schema_versions: z.array(z.literal(1)).min(1),
    limits: z
      .object({
        default_inventory_count: z.number().int().positive(),
        maximum_inventory_count: z.number().int().positive(),
        default_export_count: z.number().int().positive(),
        maximum_export_count: z.number().int().positive(),
        default_export_bytes: z.number().int().positive(),
        maximum_export_bytes: z.number().int().positive(),
        maximum_individual_record_bytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((capabilities, ctx) => {
    const { limits } = capabilities;
    if (
      limits.default_inventory_count > limits.maximum_inventory_count ||
      limits.default_export_count > limits.maximum_export_count ||
      limits.default_export_bytes > limits.maximum_export_bytes ||
      limits.maximum_individual_record_bytes > limits.maximum_export_bytes
    )
      ctx.addIssue({
        code: 'custom',
        path: ['limits'],
        message:
          'Default limits must not exceed maximums and a record must fit a maximum batch',
      });
  });

export function validateAttempt(input: unknown) {
  return modelAttemptSchema.safeParse(input);
}
export function validateExportRecord(input: unknown) {
  return exportRecordSchema.safeParse(input);
}
export function validateCapabilities(input: unknown) {
  return capabilitiesSchema.safeParse(input);
}

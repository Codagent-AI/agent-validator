import { randomUUID } from 'node:crypto';
import type { AdapterTelemetry } from '../cli-adapters/shared.js';
import { MetricsRecorder, type PublicationResult } from './recorder.js';
import { recoverPendingSessionClosures } from './session-closure.js';
import {
  type Invocation,
  MEASUREMENT_SCHEMA_VERSION,
  type ModelAttempt,
} from './types.js';

export interface CommandTelemetry {
  invocation_id: string;
  session_id: string | null;
  artifact_path: string | null;
  publication: {
    state: 'published' | 'degraded' | 'unavailable';
    snapshot_id: string | null;
    owner_invocation_id: string | null;
    reasons: string[];
  };
}

export type ValidationCommand = 'run' | 'check' | 'review';

export interface PreparedAttempt {
  attempt_id: string;
  record: ModelAttempt | null;
}

/**
 * Owns the command-level telemetry boundary. Failures here are intentionally
 * represented as metadata: validation results retain their original outcome.
 */
export class CommandMetricsLifecycle {
  readonly invocationId = randomUUID();
  private recorder: MetricsRecorder | null = null;
  private sessionId: string | null = null;
  private record: Invocation | null = null;
  private unavailableReasons: string[] = [];
  private attemptPersistenceFailed = false;

  constructor(
    private readonly command: ValidationCommand,
    private context: { consumer: string; context_id: string } | null = null,
  ) {}

  setContext(context: { consumer: string; context_id: string } | null): void {
    this.context = context;
  }

  async associate(logDir: string): Promise<void> {
    try {
      const recovery = await recoverPendingSessionClosures(logDir);
      if (recovery.warnings.length > 0)
        throw new Error(recovery.warnings.join('; '));
      this.recorder = await MetricsRecorder.open(logDir);
      const session = await this.recorder.openOrCreateActiveSession();
      this.sessionId = session.session_id;
      this.record = {
        record_type: 'invocation',
        invocation_id: this.invocationId,
        revision: 1,
        measurement_schema_version: MEASUREMENT_SCHEMA_VERSION,
        session_id: session.session_id,
        lifecycle: {
          state: 'running',
          started_at: new Date().toISOString(),
          ended_at: null,
        },
        attempt_ids: [],
        zero_dispatch: false,
        diagnostics: [],
        command: this.command,
        consumer_context: this.context,
        outcome: null,
      };
      await this.recorder.recordInvocation(this.record);
    } catch (error) {
      this.recorder = null;
      this.sessionId = null;
      this.record = null;
      this.unavailableReasons.push(errorMessage(error));
    }
  }

  async finalize(outcome: string): Promise<CommandTelemetry> {
    if (!(this.recorder && this.record && this.sessionId)) {
      return this.telemetry({
        state: 'unavailable',
        snapshot_id: null,
        owner_invocation_id: null,
        artifact_path: null,
        reasons:
          this.unavailableReasons.length > 0
            ? this.unavailableReasons
            : ['storage_not_established'],
      });
    }

    try {
      const committed = await this.recorder.readCommittedSession(
        this.sessionId,
      );
      const current = committed.invocations.find(
        (item) => item.invocation_id === this.invocationId,
      );
      if (!current) throw new Error('invocation_not_committed');
      this.record = {
        ...current,
        revision: current.revision + 1,
        lifecycle: {
          state:
            outcome === 'error' || outcome === 'lock_conflict'
              ? 'failed'
              : 'completed',
          started_at: current.lifecycle.started_at,
          ended_at: new Date().toISOString(),
        },
        zero_dispatch:
          current.attempt_ids.length === 0 && !this.attemptPersistenceFailed,
        diagnostics: this.attemptPersistenceFailed
          ? [...new Set([...current.diagnostics, 'attempt_persistence_failed'])]
          : current.diagnostics,
        outcome,
      };
      await this.recorder.updateInvocation(this.record);
      const publication = await this.recorder.publishSnapshot(
        this.sessionId,
        this.invocationId,
      );
      return this.telemetry(
        this.attemptPersistenceFailed
          ? {
              ...publication,
              state: 'degraded',
              reasons: [
                ...new Set([
                  ...publication.reasons,
                  'attempt_persistence_failed',
                ]),
              ],
            }
          : publication,
      );
    } catch (error) {
      return this.telemetry({
        state: 'degraded',
        snapshot_id: null,
        owner_invocation_id: null,
        artifact_path: null,
        reasons: [errorMessage(error)],
      });
    }
  }

  /**
   * Records a real adapter dispatch before invoking the adapter. The generated
   * ID remains useful to review artifacts even when durable storage is down.
   */
  async prepareAttempt(args: {
    adapter: string;
    gate: string;
    slot: number;
    telemetry: AdapterTelemetry;
  }): Promise<PreparedAttempt> {
    const attempt_id = randomUUID();
    if (!(this.recorder && this.record && this.sessionId))
      return { attempt_id, record: null };
    const record: ModelAttempt = {
      record_type: 'model_attempt',
      attempt_id,
      revision: 1,
      measurement_schema_version: MEASUREMENT_SCHEMA_VERSION,
      session_id: this.sessionId,
      invocation_id: this.invocationId,
      lifecycle: {
        state: 'prepared',
        started_at: new Date().toISOString(),
        ended_at: null,
      },
      adapter: args.adapter,
      outcome: 'unknown',
      requested_identity: args.telemetry.requested_identity,
      resolved_identity: args.telemetry.resolved_identity,
      observed_identities: args.telemetry.observed_identities,
      observed_identity_availability:
        args.telemetry.observed_identity_availability,
      tokens: args.telemetry.tokens,
      provider_native_usage: args.telemetry.provider_native_usage,
      completeness: { history: 'complete', ...args.telemetry.completeness },
      allocations: args.telemetry.allocations,
      unallocated_usage: args.telemetry.unallocated_usage,
      provider_reported_costs: args.telemetry.provider_reported_costs,
      provenance: {
        producer_version: 'unknown',
        build: {
          availability: 'unavailable',
          value: null,
          reason: 'build_revision_unavailable',
        },
        ...args.telemetry.provenance,
      },
      diagnostics: args.telemetry.diagnostics,
      review_context: { gate: args.gate, slot: args.slot },
      consumer_context: this.context,
    };
    try {
      await this.recorder.prepareAttempt(record);
      return { attempt_id, record };
    } catch (error) {
      this.attemptPersistenceFailed = true;
      this.unavailableReasons.push(errorMessage(error));
      return { attempt_id, record: null };
    }
  }

  async finalizeAttempt(
    prepared: PreparedAttempt,
    telemetry: AdapterTelemetry,
    outcome: 'passed' | 'failed' | 'error',
  ): Promise<void> {
    if (!(prepared.record && this.recorder)) return;
    const current = prepared.record;
    const record: ModelAttempt = {
      ...current,
      revision: current.revision + 1,
      lifecycle: {
        state: outcome === 'error' ? 'failed' : 'completed',
        started_at: current.lifecycle.started_at,
        ended_at: new Date().toISOString(),
      },
      outcome,
      requested_identity: telemetry.requested_identity,
      resolved_identity: telemetry.resolved_identity,
      observed_identities: telemetry.observed_identities,
      observed_identity_availability: telemetry.observed_identity_availability,
      tokens: telemetry.tokens,
      provider_native_usage: telemetry.provider_native_usage,
      completeness: {
        history: current.completeness.history,
        ...telemetry.completeness,
      },
      allocations: telemetry.allocations,
      unallocated_usage: telemetry.unallocated_usage,
      provider_reported_costs: telemetry.provider_reported_costs,
      provenance: { ...current.provenance, ...telemetry.provenance },
      diagnostics: telemetry.diagnostics,
    };
    try {
      await this.recorder.updateAttempt(record);
      prepared.record = record;
    } catch (error) {
      this.attemptPersistenceFailed = true;
      this.unavailableReasons.push(errorMessage(error));
    }
  }

  private telemetry(publication: PublicationResult): CommandTelemetry {
    return {
      invocation_id: this.invocationId,
      session_id: this.sessionId,
      artifact_path: publication.artifact_path,
      publication: {
        state: publication.state,
        snapshot_id: publication.snapshot_id,
        owner_invocation_id: publication.owner_invocation_id,
        reasons: publication.reasons,
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'metrics_storage_unavailable';
}

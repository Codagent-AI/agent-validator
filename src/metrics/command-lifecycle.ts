import { randomUUID } from 'node:crypto';
import type { AdapterTelemetry } from '../cli-adapters/shared.js';
import { MetricsRecorder, type PublicationResult } from './recorder.js';
import { recoverPendingSessionClosures } from './session-closure.js';
import type { StoreFilesystem } from './store.js';
import {
  type Invocation,
  MEASUREMENT_SCHEMA_VERSION,
  type ModelAttempt,
} from './types.js';
import { validateAttempt } from './validation.js';

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

const METRICS_IDENTIFIER_MAX_LENGTH = 256;

/** Shared correlation-option grammar for run, check, and review. */
export function validateMetricsContext(options: {
  metricsConsumer?: string;
  metricsContext?: string;
}): { consumer: string; context_id: string } | null {
  if (!(options.metricsConsumer || options.metricsContext)) return null;
  if (!(options.metricsConsumer && options.metricsContext))
    throw new Error(
      'metrics-consumer and metrics-context must be supplied together',
    );
  for (const value of [options.metricsConsumer, options.metricsContext]) {
    if (!value.trim() || value.length > METRICS_IDENTIFIER_MAX_LENGTH)
      throw new Error(
        'metrics consumer and context must be bounded nonempty values',
      );
  }
  return {
    consumer: options.metricsConsumer,
    context_id: options.metricsContext,
  };
}

export interface CommandMetricsOptions {
  /** Storage durability hooks; tests inject slow or failing flushes here. */
  filesystem?: StoreFilesystem;
  /** Backoff before each retry of a failed terminal attempt write. */
  finalWriteRetryDelaysMs?: readonly number[];
}

const DEFAULT_FINAL_WRITE_RETRY_DELAYS_MS = [100, 400, 1_600] as const;

/** Per-attempt write chain. Live progress keeps only its newest unwritten snapshot. */
interface AttemptWriteQueue {
  tail: Promise<void>;
  progress: AdapterTelemetry | null;
  progressWrite: Promise<void> | null;
}

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
  private attemptWrites = new Map<string, AttemptWriteQueue>();
  private terminalAttempts = new Set<string>();

  constructor(
    private readonly command: ValidationCommand,
    private context: { consumer: string; context_id: string } | null = null,
    private readonly options: CommandMetricsOptions = {},
  ) {}

  setContext(context: { consumer: string; context_id: string } | null): void {
    this.context = context;
  }

  async associate(logDir: string): Promise<void> {
    try {
      const recovery = await recoverPendingSessionClosures(logDir);
      if (recovery.warnings.length > 0)
        throw new Error(recovery.warnings.join('; '));
      this.recorder = await MetricsRecorder.open(
        logDir,
        this.options.filesystem,
      );
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

    // Live-progress writes are fire-and-forget; settle them before the
    // invocation's terminal revision and publication read the store.
    await Promise.all(
      [...this.attemptWrites.values()].map((queue) => queue.tail),
    );
    if (this.attemptPersistenceFailed)
      console.warn(
        `Metrics attempt telemetry was not fully persisted: ${[...new Set(this.unavailableReasons)].join('; ')}`,
      );
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

  observeAttempt(
    prepared: PreparedAttempt,
    telemetry: AdapterTelemetry,
  ): Promise<void> {
    if (this.terminalAttempts.has(prepared.attempt_id))
      return Promise.resolve();
    const queue = this.attemptQueue(prepared.attempt_id);
    queue.progress = structuredClone(telemetry);
    if (queue.progressWrite) return queue.progressWrite;
    const write = queue.tail.then(() => {
      const evidence = queue.progress;
      queue.progress = null;
      queue.progressWrite = null;
      if (!evidence) return;
      return this.persistAttempt(prepared, evidence, 'unknown', false, null);
    });
    queue.progressWrite = write;
    queue.tail = write;
    return write;
  }

  finalizeAttempt(
    prepared: PreparedAttempt,
    telemetry: AdapterTelemetry,
    outcome: 'passed' | 'failed' | 'error',
  ): Promise<void> {
    const queue = this.attemptQueue(prepared.attempt_id);
    if (this.terminalAttempts.has(prepared.attempt_id)) return queue.tail;
    this.terminalAttempts.add(prepared.attempt_id);
    // The terminal revision supersedes an unwritten progress snapshot; the
    // snapshot is kept only as fallback evidence for an evidence-free failure.
    const superseded = queue.progress;
    queue.progress = null;
    const evidence = structuredClone(telemetry);
    queue.tail = queue.tail.then(() =>
      this.persistAttempt(prepared, evidence, outcome, true, superseded),
    );
    return queue.tail;
  }

  private attemptQueue(attemptId: string): AttemptWriteQueue {
    let queue = this.attemptWrites.get(attemptId);
    if (!queue) {
      queue = { tail: Promise.resolve(), progress: null, progressWrite: null };
      this.attemptWrites.set(attemptId, queue);
    }
    return queue;
  }

  private async persistAttempt(
    prepared: PreparedAttempt,
    evidence: AdapterTelemetry,
    outcome: ModelAttempt['outcome'],
    terminal: boolean,
    superseded: AdapterTelemetry | null,
  ): Promise<void> {
    if (!(prepared.record && this.recorder)) return;
    const recorder = this.recorder;
    const current = prepared.record;
    let telemetry = evidence;
    // An operational failure without new evidence cannot erase previously
    // observed partial measurement, whether committed or still queued. It
    // still cannot establish a complete total.
    const previous = [superseded, current].find(
      (candidate): candidate is AdapterTelemetry =>
        candidate !== null &&
        candidate.completeness.collection !== 'unavailable',
    );
    if (
      outcome === 'error' &&
      telemetry.completeness.collection === 'unavailable' &&
      previous
    ) {
      telemetry = {
        ...previous,
        completeness: { ...previous.completeness, collection: 'partial' },
        diagnostics: [
          ...new Set([...previous.diagnostics, ...telemetry.diagnostics]),
        ],
      };
    }
    const record: ModelAttempt = {
      ...current,
      revision: current.revision + 1,
      lifecycle: {
        state: attemptState(terminal, outcome),
        started_at: current.lifecycle.started_at,
        ended_at: terminal ? new Date().toISOString() : null,
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
      if (!validateAttempt(record).success)
        throw new Error('invalid_adapter_telemetry');
      // Progress is best effort and superseded by later evidence; the terminal
      // revision is the attempt's only durable outcome, so it rides out
      // transient storage or lock failures before giving up.
      const retryDelays = terminal
        ? (this.options.finalWriteRetryDelaysMs ??
          DEFAULT_FINAL_WRITE_RETRY_DELAYS_MS)
        : [];
      await withRetries(() => recorder.updateAttempt(record), retryDelays);
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

async function withRetries(
  action: () => Promise<void>,
  delaysMs: readonly number[],
): Promise<void> {
  for (const delayMs of delaysMs) {
    try {
      return await action();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return action();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'metrics_storage_unavailable';
}

function attemptState(
  terminal: boolean,
  outcome: ModelAttempt['outcome'],
): ModelAttempt['lifecycle']['state'] {
  if (!terminal) return 'running';
  return outcome === 'error' ? 'failed' : 'completed';
}

// biome-ignore lint/nursery/noExcessiveLinesPerFile: one transactional storage boundary keeps commit, recovery, and locking invariants together.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MetricsOperationError } from './errors.js';
import { createDigest, parseJsonStrict, verifyDigest } from './jcs.js';
import {
  type Digest,
  type Invocation,
  type ModelAttempt,
  STORAGE_VERSION,
} from './types.js';

export type MetricRecord = Invocation | ModelAttempt;

export interface StoredMetricRecord {
  record_type: MetricRecord['record_type'];
  record_id: string;
  revision: number;
  measurement_schema_version: number;
  producer: { name: 'agent-validator'; version: string };
  original_consumer_context: { consumer: string; context_id: string } | null;
  payload: MetricRecord;
  digest: Digest;
}

interface RecordHead {
  record_type: MetricRecord['record_type'];
  revision: number;
}

export interface StoredSession {
  session_id: string;
  state: 'active' | 'closing' | 'closed';
  created_at: string;
  updated_at: string;
  owner: { pid: number; nonce: string } | null;
  receipt_refs: string[];
  closure_refs: string[];
}

interface StoreState {
  storage_version: number;
  generation: number;
  sessions: Record<string, StoredSession>;
  heads: Record<string, RecordHead>;
  dispositions: Record<string, string>;
  receipts?: Record<string, ReceiptManifest>;
  record_index: Record<string, RecordIndexEntry>;
}

interface RecordIndexEntry extends ReceiptItem {
  original_consumer_context: StoredMetricRecord['original_consumer_context'];
  started_at: string | null;
  bytes: number;
  generation: number;
}

interface StoreIdentity {
  storage_version: number;
  store_id: string;
}

interface ReceiptItem {
  record_type: StoredMetricRecord['record_type'];
  record_id: string;
  revision: number;
  measurement_schema_version: number;
  digest: Digest;
}

interface ReceiptManifest {
  receipt: string;
  consumer: string;
  context: string;
  protocol_version: number;
  records: ReceiptItem[];
}

export interface ExportPendingOptions {
  consumer: string;
  context: string;
  protocolVersion: number;
  measurementVersions: number[];
  maxRecords?: number;
  maxBytes?: number;
}

export interface MetricsExport {
  store_id: string;
  consumer_context: { consumer: string; context_id: string };
  export_id: string | null;
  evidence_state:
    | 'pending'
    | 'previously_acknowledged'
    | 'discarded'
    | 'missing';
  records: StoredMetricRecord[];
  batch: {
    generation: number;
    returned_revision_count: number;
    remaining_revision_count: number;
    scope_complete: boolean;
  };
  delivery_gaps: { count: number; reasons: string[] };
  receipt: string | null;
}

export interface ReceiptOperation {
  consumer: string;
  context: string;
  protocolVersion: number;
  receipt: string;
}

export interface PendingContext {
  consumer: string;
  context: string;
  pending_revision_count: number;
  oldest_pending_at: string | null;
  approximate_payload_bytes: number;
  delivery_gap_count: number;
  delivery_gap_reasons: string[];
}

export interface PendingInventory {
  store_id: string;
  inventory_generation: number;
  contexts: PendingContext[];
}

export interface StoreFilesystem {
  syncFile(file: fs.FileHandle): Promise<void>;
  syncDirectory(directory: string): Promise<void>;
}

const realFilesystem: StoreFilesystem = {
  syncFile: (file) => file.sync(),
  async syncDirectory(directory) {
    // Directory sync is the durability barrier for rename publication on POSIX.
    // Some local development filesystems reject opening directories; do not hide a
    // failure once the descriptor has been obtained.
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } finally {
      await handle?.close();
    }
  },
};

const LOCK_OWNER_FILENAME = 'owner.json';
const INCOMPLETE_LOCK_STALE_MS = 30_000;
const MAXIMUM_INDIVIDUAL_RECORD_BYTES = 3_000_000;

function recordId(record: MetricRecord): string {
  return record.record_type === 'invocation'
    ? record.invocation_id
    : record.attempt_id;
}

function initialState(): StoreState {
  return {
    storage_version: STORAGE_VERSION,
    generation: 0,
    sessions: {},
    heads: {},
    dispositions: {},
    receipts: {},
    record_index: {},
  };
}

function evidenceState(
  selected: StoredMetricRecord[],
  matching: RecordIndexEntry[],
  gaps: number,
): MetricsExport['evidence_state'] {
  if (selected.length > 0) return 'pending';
  if (matching.length === 0) return 'missing';
  if (gaps > 0) return 'discarded';
  return 'previously_acknowledged';
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function conflictingDisposition(previous: string): MetricsOperationError {
  return new MetricsOperationError(
    previous === 'discarded' ? 'delivery_gap' : 'invalid_receipt',
    'Receipt already has a conflicting disposition',
  );
}

function validIndexEntry(entry: RecordIndexEntry, generation: number): boolean {
  const context = entry?.original_consumer_context;
  return Boolean(
    entry &&
      ['invocation', 'model_attempt'].includes(entry.record_type) &&
      typeof entry.record_id === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(entry.record_id) &&
      Number.isSafeInteger(entry.revision) &&
      entry.revision > 0 &&
      Number.isSafeInteger(entry.measurement_schema_version) &&
      entry.measurement_schema_version > 0 &&
      Number.isSafeInteger(entry.bytes) &&
      entry.bytes > 0 &&
      Number.isSafeInteger(entry.generation) &&
      entry.generation > 0 &&
      entry.generation <= generation &&
      entry.digest?.algorithm === 'sha256' &&
      entry.digest.canonicalization === 'rfc8785' &&
      typeof entry.digest.value === 'string' &&
      /^[a-f0-9]{64}$/.test(entry.digest.value) &&
      (entry.started_at === null || typeof entry.started_at === 'string') &&
      (context === null ||
        (context &&
          typeof context.consumer === 'string' &&
          typeof context.context_id === 'string')),
  );
}

/** Crash-safe private revision store. Its layout is intentionally not a public API. */
export class MetricsStore {
  readonly root: string;
  private readonly recordsPath: string;
  private readonly statePath: string;
  private readonly identityPath: string;
  private readonly lockPath: string;
  private readonly lockOwnerPath: string;

  private constructor(
    readonly logDir: string,
    private readonly filesystem: StoreFilesystem,
  ) {
    this.root = path.join(logDir, '.metrics');
    this.recordsPath = path.join(this.root, 'records');
    this.statePath = path.join(this.root, 'state.json');
    this.identityPath = path.join(this.root, 'store.json');
    this.lockPath = path.join(this.root, 'metadata.lock');
    this.lockOwnerPath = path.join(this.lockPath, LOCK_OWNER_FILENAME);
  }

  static async open(
    logDir: string,
    filesystem: StoreFilesystem = realFilesystem,
  ): Promise<MetricsStore> {
    const store = new MetricsStore(path.resolve(logDir), filesystem);
    await fs.mkdir(store.recordsPath, { recursive: true });
    try {
      const identity = parseJsonStrict(
        await fs.readFile(store.identityPath, 'utf8'),
      ) as unknown as StoreIdentity;
      if (
        identity.storage_version !== STORAGE_VERSION ||
        typeof identity.store_id !== 'string'
      )
        throw new Error('Unsupported metrics storage');
    } catch (error) {
      if (!isMissing(error)) throw error;
      await store.writeAtomic(store.identityPath, {
        storage_version: STORAGE_VERSION,
        store_id: randomUUID(),
      });
    }
    try {
      await store.readState();
    } catch (error) {
      if (!isMissing(error)) throw error;
      await store.writeAtomic(store.statePath, initialState());
    }
    await store.recoverDeadSessionOwners();
    return store;
  }

  /** Opens committed delivery evidence without creating a directory or store. */
  static async openExisting(
    logDir: string,
    filesystem: StoreFilesystem = realFilesystem,
  ): Promise<MetricsStore> {
    const store = new MetricsStore(path.resolve(logDir), filesystem);
    await store.readIdentity();
    await store.readState();
    return store;
  }

  async createSession(): Promise<StoredSession> {
    return this.withLock(async () => {
      const state = await this.readState();
      const now = new Date().toISOString();
      const session: StoredSession = {
        session_id: randomUUID(),
        state: 'active',
        created_at: now,
        updated_at: now,
        owner: { pid: process.pid, nonce: randomUUID() },
        receipt_refs: [],
        closure_refs: [],
      };
      state.sessions[session.session_id] = session;
      await this.commitState(state);
      return session;
    });
  }

  async readSession(sessionId: string): Promise<StoredSession | null> {
    return (await this.readState()).sessions[sessionId] ?? null;
  }

  /** Returns the newest active session without ever reopening a closing one. */
  async findActiveSession(): Promise<StoredSession | null> {
    return (
      Object.values((await this.readState()).sessions)
        .filter((session) => session.state === 'active')
        .sort((left, right) =>
          right.updated_at.localeCompare(left.updated_at),
        )[0] ?? null
    );
  }

  async joinSession(sessionId: string): Promise<StoredSession> {
    const session = await this.readSession(sessionId);
    if (!session) throw new Error(`Unknown metrics session: ${sessionId}`);
    if (session.state !== 'active')
      throw new Error(`Cannot join closed metrics session: ${sessionId}`);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const session = state.sessions[sessionId];
      if (!session) throw new Error(`Unknown metrics session: ${sessionId}`);
      session.state = 'closed';
      session.owner = null;
      session.updated_at = new Date().toISOString();
      await this.commitState(state);
    });
  }

  /** A closing state is durable and prevents a new command from joining this session. */
  async beginSessionClose(sessionId: string, closeId: string): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const session = state.sessions[sessionId];
      if (!session) throw new Error(`Unknown metrics session: ${sessionId}`);
      if (session.state === 'closed') return;
      if (
        session.state === 'closing' &&
        !session.closure_refs.includes(closeId)
      )
        throw new Error(`Metrics session is already closing: ${sessionId}`);
      session.state = 'closing';
      session.owner = null;
      if (!session.closure_refs.includes(closeId))
        session.closure_refs.push(closeId);
      session.updated_at = new Date().toISOString();
      await this.commitState(state);
    });
  }

  async completeSessionClose(
    sessionId: string,
    closeId: string,
  ): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const session = state.sessions[sessionId];
      if (!session) throw new Error(`Unknown metrics session: ${sessionId}`);
      if (session.state === 'closed') return;
      if (
        session.state !== 'closing' ||
        !session.closure_refs.includes(closeId)
      )
        throw new Error(`Metrics session close does not match: ${sessionId}`);
      session.state = 'closed';
      session.owner = null;
      session.updated_at = new Date().toISOString();
      await this.commitState(state);
    });
  }

  async commit(records: MetricRecord[]): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      for (const record of records) await this.commitRecord(state, record);
      await this.commitState(state);
    });
  }

  /**
   * Returns a bounded immutable replacement batch and persists its receipt before
   * exposing it. Export deliberately does not alter delivery dispositions.
   */
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: receipt commit is a single atomic protocol boundary.
  async exportPending(options: ExportPendingOptions): Promise<MetricsExport> {
    if (options.protocolVersion !== 1)
      throw new Error('Unsupported metrics protocol version');
    if (!options.measurementVersions.includes(1))
      throw new Error('Unsupported measurement schema version');
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping selection and receipt persistence together avoids a stale manifest.
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: keeping selection and receipt persistence together avoids a stale manifest.
    return this.withLock(async () => {
      const state = await this.readState();
      const identity = await this.readIdentity();
      const matching = Object.values(state.record_index).filter(
        (record) =>
          record.original_consumer_context?.consumer === options.consumer &&
          record.original_consumer_context.context_id === options.context,
      );
      const pending = matching.filter(
        (record) => !state.dispositions[this.revisionKey(record)],
      );
      const discarded = matching.filter(
        (record) =>
          state.dispositions[this.revisionKey(record)] === 'discarded',
      );
      if (
        pending.some(
          (record) =>
            !options.measurementVersions.includes(
              record.measurement_schema_version,
            ),
        )
      )
        throw new Error(
          'Unsupported measurement schema version in pending evidence',
        );

      const maxRecords = options.maxRecords ?? 100;
      const maxBytes = options.maxBytes ?? 1_000_000;
      const selected: StoredMetricRecord[] = [];
      let bytes = 0;
      pending.sort(
        (left, right) =>
          left.generation - right.generation ||
          left.record_type.localeCompare(right.record_type) ||
          left.record_id.localeCompare(right.record_id) ||
          left.revision - right.revision,
      );
      for (const entry of pending) {
        const size = entry.bytes;
        if (size > maxBytes && selected.length === 0)
          throw new Error('Metrics record exceeds export byte limit');
        if (
          selected.length === maxRecords ||
          (selected.length > 0 && bytes + size > maxBytes)
        )
          break;
        const record = await this.readRecord(entry.record_id, entry.revision);
        if (
          record.digest.value !== entry.digest.value ||
          record.record_type !== entry.record_type ||
          JSON.stringify(record.original_consumer_context) !==
            JSON.stringify(entry.original_consumer_context) ||
          record.measurement_schema_version !==
            entry.measurement_schema_version ||
          Buffer.byteLength(JSON.stringify(record)) !== size
        )
          throw new Error('Corrupt metrics record index');
        selected.push(record);
        bytes += size;
      }
      const receiptItems = selected.map((record) => ({
        record_type: record.record_type,
        record_id: record.record_id,
        revision: record.revision,
        measurement_schema_version: record.measurement_schema_version,
        digest: record.digest,
      }));
      let receipt: string | null = null;
      if (receiptItems.length > 0) {
        if (!state.receipts) state.receipts = {};
        const receipts = state.receipts;
        receipt =
          Object.values(receipts).find(
            (candidate) =>
              candidate.consumer === options.consumer &&
              candidate.context === options.context &&
              candidate.protocol_version === options.protocolVersion &&
              JSON.stringify(candidate.records) ===
                JSON.stringify(receiptItems),
          )?.receipt ?? randomUUID();
        receipts[receipt] ??= {
          receipt,
          consumer: options.consumer,
          context: options.context,
          protocol_version: options.protocolVersion,
          records: receiptItems,
        };
        await this.commitState(state);
      }
      const gaps = discarded.length;
      return {
        store_id: identity.store_id,
        consumer_context: {
          consumer: options.consumer,
          context_id: options.context,
        },
        export_id: receipt,
        evidence_state: evidenceState(selected, matching, gaps),
        records: selected,
        batch: {
          generation: state.generation,
          returned_revision_count: selected.length,
          remaining_revision_count: pending.length - selected.length,
          scope_complete: pending.length === selected.length,
        },
        delivery_gaps: { count: gaps, reasons: gaps ? ['user_discarded'] : [] },
        receipt,
      };
    });
  }

  async acknowledgeReceipt(options: ReceiptOperation): Promise<void> {
    await this.disposeReceipt(options, 'acknowledged');
  }

  async discardReceipt(options: ReceiptOperation): Promise<void> {
    await this.disposeReceipt(options, 'discarded');
  }

  /** Read-only scope discovery; this never creates a receipt or store state. */
  async pendingInventory(consumer?: string): Promise<PendingInventory> {
    const [state, identity] = await Promise.all([
      this.readState(),
      this.readIdentity(),
    ]);
    const grouped = new Map<
      string,
      { consumer: string; context: string; records: RecordIndexEntry[] }
    >();
    for (const record of Object.values(state.record_index)) {
      const context = record.original_consumer_context;
      if (!context || (consumer && context.consumer !== consumer)) continue;
      const key = `${context.consumer}\u0000${context.context_id}`;
      const group = grouped.get(key) ?? {
        consumer: context.consumer,
        context: context.context_id,
        records: [],
      };
      group.records.push(record);
      grouped.set(key, group);
    }
    const contexts = [...grouped.values()]
      .map((group) => {
        const pending = group.records.filter(
          (record) => !state.dispositions[this.revisionKey(record)],
        );
        const discarded = group.records.filter(
          (record) =>
            state.dispositions[this.revisionKey(record)] === 'discarded',
        );
        return {
          consumer: group.consumer,
          context: group.context,
          pending_revision_count: pending.length,
          oldest_pending_at:
            pending
              .map((record) => record.started_at)
              .filter((time): time is string => Boolean(time))
              .sort()[0] ?? null,
          approximate_payload_bytes: pending.reduce(
            (total, record) => total + record.bytes,
            0,
          ),
          delivery_gap_count: discarded.length,
          delivery_gap_reasons: discarded.length > 0 ? ['user_discarded'] : [],
        };
      })
      .filter(
        (context) =>
          context.pending_revision_count || context.delivery_gap_count,
      );
    return {
      store_id: identity.store_id,
      inventory_generation: state.generation,
      contexts: contexts.sort(
        (left, right) =>
          left.consumer.localeCompare(right.consumer) ||
          left.context.localeCompare(right.context),
      ),
    };
  }

  /** Commits a new dispatch and the latest parent membership under one metadata generation. */
  async commitAttemptWithParent(record: ModelAttempt): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const session = state.sessions[record.session_id];
      if (!session || session.state !== 'active')
        throw new Error('Attempt cannot join a closed metrics session');
      const parentHead = state.heads[record.invocation_id];
      if (!parentHead || parentHead.record_type !== 'invocation')
        throw new Error(`Unknown parent invocation: ${record.invocation_id}`);
      const parent = (
        await this.readRecord(record.invocation_id, parentHead.revision)
      ).payload;
      if (
        parent.record_type !== 'invocation' ||
        parent.session_id !== record.session_id
      )
        throw new Error(
          `Attempt parent/session mismatch: ${record.attempt_id}`,
        );
      const revisedParent: Invocation = {
        ...parent,
        revision: parent.revision + 1,
        attempt_ids: [...new Set([...parent.attempt_ids, record.attempt_id])],
      };
      await this.commitRecord(state, record);
      await this.commitRecord(state, revisedParent);
      await this.commitState(state);
    });
  }

  async readCommittedSession(
    sessionId: string,
  ): Promise<{ invocations: Invocation[]; attempts: ModelAttempt[] }> {
    const state = await this.readState();
    const records: MetricRecord[] = [];
    for (const [id, head] of Object.entries(state.heads)) {
      const stored = await this.readRecord(id, head.revision);
      if (stored.payload.session_id === sessionId) records.push(stored.payload);
    }
    return {
      invocations: records
        .filter((item): item is Invocation => item.record_type === 'invocation')
        .sort((a, b) => a.invocation_id.localeCompare(b.invocation_id)),
      attempts: records
        .filter(
          (item): item is ModelAttempt => item.record_type === 'model_attempt',
        )
        .sort((a, b) => a.attempt_id.localeCompare(b.attempt_id)),
    };
  }

  async addReceiptReference(sessionId: string, receipt: string): Promise<void> {
    await this.updateSessionReferences(sessionId, 'receipt_refs', receipt);
  }

  async addClosureReference(sessionId: string, closure: string): Promise<void> {
    await this.updateSessionReferences(sessionId, 'closure_refs', closure);
  }

  private async updateSessionReferences(
    sessionId: string,
    key: 'receipt_refs' | 'closure_refs',
    value: string,
  ): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      const session = state.sessions[sessionId];
      if (!session) throw new Error(`Unknown metrics session: ${sessionId}`);
      if (!session[key].includes(value)) session[key].push(value);
      session.updated_at = new Date().toISOString();
      await this.commitState(state);
    });
  }

  private async commitRecord(
    state: StoreState,
    record: MetricRecord,
  ): Promise<void> {
    const id = recordId(record);
    const current = state.heads[id];
    if (current && record.revision <= current.revision)
      throw new Error(`Metrics revision must increase: ${id}`);
    const envelope: StoredMetricRecord = {
      record_type: record.record_type,
      record_id: id,
      revision: record.revision,
      measurement_schema_version: record.measurement_schema_version,
      producer: {
        name: 'agent-validator',
        version:
          record.record_type === 'model_attempt'
            ? record.provenance.producer_version
            : 'unknown',
      },
      original_consumer_context: record.consumer_context ?? null,
      payload: record,
      digest: { algorithm: 'sha256', canonicalization: 'rfc8785', value: '' },
    };
    envelope.digest = createDigest(envelope);
    if (
      Buffer.byteLength(JSON.stringify(envelope)) >
      MAXIMUM_INDIVIDUAL_RECORD_BYTES
    )
      throw new Error('Metrics record exceeds individual record byte limit');
    const destination = path.join(
      this.recordsPath,
      id,
      `${record.revision}.json`,
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      const existing = await this.readRecord(id, record.revision);
      if (existing.digest.value !== envelope.digest.value)
        throw new Error(
          `Conflicting immutable metrics revision: ${id}:${record.revision}`,
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.writeAtomic(destination, envelope);
    }
    state.heads[id] = {
      record_type: record.record_type,
      revision: record.revision,
    };
    state.record_index[this.revisionKey(envelope)] = {
      record_type: envelope.record_type,
      record_id: id,
      revision: record.revision,
      measurement_schema_version: envelope.measurement_schema_version,
      digest: envelope.digest,
      original_consumer_context: envelope.original_consumer_context,
      started_at: record.lifecycle.started_at,
      bytes: Buffer.byteLength(JSON.stringify(envelope)),
      generation: state.generation + 1,
    };
  }

  private revisionKey(
    record: Pick<ReceiptItem, 'record_type' | 'record_id' | 'revision'>,
  ): string {
    return `${record.record_type}:${record.record_id}:${record.revision}`;
  }

  private async readIdentity(): Promise<StoreIdentity> {
    const identity = parseJsonStrict(
      await fs.readFile(this.identityPath, 'utf8'),
    ) as unknown as StoreIdentity;
    if (identity.storage_version !== STORAGE_VERSION || !identity.store_id)
      throw new Error('Corrupt or unsupported metrics storage');
    return identity;
  }

  private async disposeReceipt(
    options: ReceiptOperation,
    disposition: 'acknowledged' | 'discarded',
  ): Promise<void> {
    if (options.protocolVersion !== 1)
      throw new Error('Unsupported metrics protocol version');
    await this.withLock(async () => {
      const state = await this.readState();
      const receipt = state.receipts?.[options.receipt];
      if (!receipt)
        throw new MetricsOperationError(
          'invalid_receipt',
          'Invalid metrics receipt',
        );
      if (
        receipt.consumer !== options.consumer ||
        receipt.context !== options.context ||
        receipt.protocol_version !== options.protocolVersion
      )
        throw new MetricsOperationError(
          'scope_mismatch',
          'Metrics receipt does not match the requested scope',
        );
      for (const item of receipt.records) {
        const key = this.revisionKey(item);
        const previous = state.dispositions[key];
        if (previous && previous !== disposition)
          throw conflictingDisposition(previous);
        if (!previous) state.dispositions[key] = disposition;
      }
      await this.commitState(state);
    });
  }

  private async readRecord(
    id: string,
    revision: number,
  ): Promise<StoredMetricRecord> {
    const parsed = parseJsonStrict(
      await fs.readFile(
        path.join(this.recordsPath, id, `${revision}.json`),
        'utf8',
      ),
    ) as unknown as StoredMetricRecord;
    const verified = verifyDigest(parsed);
    if (!verified.valid)
      throw new MetricsOperationError(
        'storage_corrupt',
        `Corrupt metrics record: ${id}:${revision}`,
      );
    if (
      parsed.record_id !== id ||
      parsed.revision !== revision ||
      parsed.payload.record_type !== parsed.record_type
    )
      throw new Error(`Invalid metrics record envelope: ${id}:${revision}`);
    return parsed;
  }

  private async readState(): Promise<StoreState> {
    const state = parseJsonStrict(
      await fs.readFile(this.statePath, 'utf8'),
    ) as unknown as StoreState;
    if (
      state.storage_version !== STORAGE_VERSION ||
      !state.sessions ||
      !state.heads ||
      !Number.isInteger(state.generation)
    )
      throw new Error('Corrupt or unsupported metrics storage');
    const objectMap = (value: unknown): boolean =>
      Boolean(value && typeof value === 'object' && !Array.isArray(value));
    if (
      !(objectMap(state.sessions) && objectMap(state.heads)) ||
      (state.dispositions !== undefined && !objectMap(state.dispositions)) ||
      (state.receipts !== undefined && !objectMap(state.receipts))
    )
      throw new Error('Corrupt metrics storage metadata');
    state.dispositions ??= {};
    state.receipts ??= {};
    if (
      Object.values(state.dispositions).some(
        (value) => !['acknowledged', 'discarded'].includes(value),
      )
    )
      throw new Error('Corrupt metrics disposition');
    if (state.record_index === undefined && Object.keys(state.heads).length > 0)
      throw new Error(
        'Unsupported unindexed metrics storage: preserve evidence and use a compatible producer; automatic migration is unavailable',
      );
    state.record_index ??= {};
    if (!objectMap(state.record_index))
      throw new Error('Corrupt metrics record index');
    for (const [key, entry] of Object.entries(state.record_index)) {
      if (
        !validIndexEntry(entry, state.generation) ||
        key !== this.revisionKey(entry)
      )
        throw new Error('Corrupt metrics record index');
    }
    return state;
  }

  private async commitState(state: StoreState): Promise<void> {
    state.generation += 1;
    await this.writeAtomic(this.statePath, state);
  }

  private async writeAtomic(destination: string, body: unknown): Promise<void> {
    const temporary = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${randomUUID()}.tmp`,
    );
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(JSON.stringify(body));
      await this.filesystem.syncFile(handle);
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, destination);
      await this.filesystem.syncDirectory(path.dirname(destination));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** A dead process is evidence of interruption, never evidence of success or a terminal time. */
  private async recoverDeadSessionOwners(): Promise<void> {
    await this.withLock(async () =>
      this.recoverDeadSessions(await this.readState()),
    );
  }

  private async recoverDeadSessions(state: StoreState): Promise<void> {
    let changed = false;
    for (const session of Object.values(state.sessions)) {
      if (!session.owner || this.processIsAlive(session.owner.pid)) continue;
      changed = (await this.interruptSessionRecords(state, session)) || changed;
      session.owner = null;
      session.updated_at = new Date().toISOString();
      changed = true;
    }
    if (changed) await this.commitState(state);
  }

  private async interruptSessionRecords(
    state: StoreState,
    session: StoredSession,
  ): Promise<boolean> {
    let changed = false;
    for (const [id, head] of Object.entries(state.heads)) {
      const record = (await this.readRecord(id, head.revision)).payload;
      if (record.session_id !== session.session_id) continue;
      const interrupted = this.interruptedRecord(record);
      if (!interrupted) continue;
      await this.commitRecord(state, interrupted);
      changed = true;
    }
    return changed;
  }

  private interruptedRecord(record: MetricRecord): MetricRecord | null {
    const diagnostic = 'owner_interrupted_before_terminal_evidence';
    if (
      record.record_type === 'model_attempt' &&
      !['completed', 'failed', 'interrupted'].includes(record.lifecycle.state)
    ) {
      return {
        ...record,
        revision: record.revision + 1,
        lifecycle: {
          ...record.lifecycle,
          state: 'interrupted',
          ended_at: null,
        },
        outcome: 'interrupted',
        completeness: { ...record.completeness, history: 'partial' },
        diagnostics: [...new Set([...record.diagnostics, diagnostic])],
      };
    }
    if (
      record.record_type === 'invocation' &&
      record.lifecycle.state === 'running'
    ) {
      return {
        ...record,
        revision: record.revision + 1,
        lifecycle: {
          ...record.lifecycle,
          state: 'interrupted',
          ended_at: null,
        },
        diagnostics: [...new Set([...record.diagnostics, diagnostic])],
      };
    }
    return null;
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const nonce = randomUUID();
    const deadline = Date.now() + 2_000;
    for (;;) {
      try {
        await fs.mkdir(this.lockPath);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          (error as NodeJS.ErrnoException).code !== 'EEXIST'
        )
          throw error;
        await this.recoverStaleLock();
        if (Date.now() >= deadline)
          throw new Error('Metrics metadata lock is held by a live owner');
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      try {
        await fs.writeFile(
          this.lockOwnerPath,
          JSON.stringify({ pid: process.pid, nonce }),
          { flag: 'wx' },
        );
      } catch (error) {
        await fs
          .rm(this.lockPath, { recursive: true, force: true })
          .catch(() => undefined);
        throw error;
      }
      try {
        return await action();
      } finally {
        await this.releaseLock(nonce);
      }
    }
  }

  private async recoverStaleLock(): Promise<void> {
    const contents = await fs
      .readFile(this.lockOwnerPath, 'utf8')
      .catch(() => null);
    if (!contents) {
      await this.removeStaleIncompleteLock(null);
      return;
    }
    let owner: { pid?: number; nonce?: string };
    try {
      owner = JSON.parse(contents);
    } catch {
      await this.removeStaleIncompleteLock(contents);
      return;
    }
    const pid = owner.pid;
    if (!(typeof pid === 'number' && Number.isInteger(pid) && owner.nonce)) {
      await this.removeStaleIncompleteLock(contents);
      return;
    }
    if (this.processIsAlive(pid)) return;
    const current = await fs
      .readFile(this.lockOwnerPath, 'utf8')
      .catch(() => null);
    if (current === contents)
      await fs.rm(this.lockPath, { recursive: true, force: true });
  }

  private async releaseLock(nonce: string): Promise<void> {
    const held = await fs.readFile(this.lockOwnerPath, 'utf8').catch(() => '');
    if (held.includes(nonce))
      await fs.rm(this.lockPath, { recursive: true, force: true });
  }

  private async removeStaleIncompleteLock(
    expectedOwnerContents: string | null,
  ): Promise<void> {
    const stat = await fs.stat(this.lockPath).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < INCOMPLETE_LOCK_STALE_MS) return;
    const current = await fs
      .readFile(this.lockOwnerPath, 'utf8')
      .catch(() => null);
    if (current === expectedOwnerContents)
      await fs.rm(this.lockPath, { recursive: true, force: true });
  }

  private processIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return Boolean(
        typeof error === 'object' &&
          error &&
          (error as NodeJS.ErrnoException).code === 'EPERM',
      );
    }
  }
}

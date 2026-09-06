// biome-ignore lint/nursery/noExcessiveLinesPerFile: one transactional storage boundary keeps commit, recovery, and locking invariants together.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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
}

interface StoreIdentity {
  storage_version: number;
  store_id: string;
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
  };
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT',
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

  async commit(records: MetricRecord[]): Promise<void> {
    await this.withLock(async () => {
      const state = await this.readState();
      for (const record of records) await this.commitRecord(state, record);
      await this.commitState(state);
    });
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
      throw new Error(`Corrupt metrics record: ${id}:${revision}`);
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

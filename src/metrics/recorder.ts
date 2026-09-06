import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSnapshot } from './projections.js';
import {
  MetricsStore,
  type StoredSession,
  type StoreFilesystem,
} from './store.js';
import type { Invocation, ModelAttempt } from './types.js';

export interface PublicationResult {
  state: 'published' | 'degraded' | 'unavailable';
  snapshot_id: string | null;
  owner_invocation_id: string | null;
  artifact_path: string | null;
  reasons: string[];
}

type SnapshotFilesystem = Pick<typeof fs, 'mkdir' | 'open' | 'rename' | 'rm'>;

/** Lifecycle facade: persistence failure is reported to callers, never converted into validation failure. */
export class MetricsRecorder {
  private constructor(
    readonly store: MetricsStore,
    readonly logDir: string,
    private readonly snapshotFilesystem: SnapshotFilesystem = fs,
  ) {}

  static async open(
    logDir: string,
    filesystem?: StoreFilesystem,
  ): Promise<MetricsRecorder> {
    return new MetricsRecorder(
      await MetricsStore.open(logDir, filesystem),
      path.resolve(logDir),
    );
  }

  static async openExisting(
    logDir: string,
    filesystem?: StoreFilesystem,
  ): Promise<MetricsRecorder> {
    return new MetricsRecorder(
      await MetricsStore.openExisting(logDir, filesystem),
      path.resolve(logDir),
    );
  }

  async createSession(): Promise<StoredSession> {
    return this.store.createSession();
  }
  async openOrCreateActiveSession(): Promise<StoredSession> {
    const active = await this.store.findActiveSession();
    return active
      ? this.store.joinSession(active.session_id)
      : this.store.createSession();
  }
  async joinSession(sessionId: string): Promise<StoredSession> {
    return this.store.joinSession(sessionId);
  }
  async closeSession(sessionId: string): Promise<void> {
    await this.store.closeSession(sessionId);
  }

  async beginSessionClose(sessionId: string, closeId: string): Promise<void> {
    await this.store.beginSessionClose(sessionId, closeId);
  }

  async completeSessionClose(
    sessionId: string,
    closeId: string,
  ): Promise<void> {
    await this.store.completeSessionClose(sessionId, closeId);
  }
  async recordInvocation(record: Invocation): Promise<void> {
    await this.store.commit([record]);
  }

  async prepareAttempt(record: ModelAttempt): Promise<void> {
    const session = await this.store.readSession(record.session_id);
    if (!session || session.state !== 'active')
      throw new Error('Attempt cannot join a closed metrics session');
    await this.store.commitAttemptWithParent(record);
  }

  async updateAttempt(record: ModelAttempt): Promise<void> {
    await this.store.commit([record]);
  }
  async updateInvocation(record: Invocation): Promise<void> {
    await this.store.commit([record]);
  }
  async readCommittedSession(sessionId: string) {
    return this.store.readCommittedSession(sessionId);
  }

  async publishSnapshot(
    sessionId: string,
    invocationId: string,
  ): Promise<PublicationResult> {
    try {
      const session = await this.store.readSession(sessionId);
      if (!session)
        return {
          state: 'unavailable',
          snapshot_id: null,
          owner_invocation_id: null,
          artifact_path: null,
          reasons: ['unknown_session'],
        };
      const records = await this.store.readCommittedSession(sessionId);
      const current = records.invocations.find(
        (item) => item.invocation_id === invocationId,
      );
      if (!current)
        return {
          state: 'unavailable',
          snapshot_id: null,
          owner_invocation_id: null,
          artifact_path: null,
          reasons: ['unknown_invocation'],
        };
      const snapshot = projectSnapshot(
        sessionId,
        invocationId,
        records.attempts.filter((item) => item.invocation_id === invocationId),
        records.attempts,
      );
      snapshot.invocations = records.invocations;
      snapshot.session.state = session.state;
      const artifactPath = path.join(this.logDir, 'validation-metrics.json');
      await this.writePublishedSnapshot(artifactPath, snapshot);
      return {
        state: 'published',
        snapshot_id: snapshot.snapshot_id,
        owner_invocation_id: invocationId,
        artifact_path: artifactPath,
        reasons: [],
      };
    } catch (error) {
      return {
        state: 'degraded',
        snapshot_id: null,
        owner_invocation_id: null,
        artifact_path: null,
        reasons: [
          error instanceof Error ? error.message : 'publication_failed',
        ],
      };
    }
  }

  async publishClosedSessionSnapshot(sessionId: string): Promise<{
    snapshot: unknown;
    artifactPath: string;
  }> {
    const session = await this.store.readSession(sessionId);
    if (!session) throw new Error('unknown_session');
    const records = await this.store.readCommittedSession(sessionId);
    const invocation = [...records.invocations]
      .sort((left, right) =>
        `${left.lifecycle.ended_at ?? left.lifecycle.started_at ?? ''}${left.invocation_id}`.localeCompare(
          `${right.lifecycle.ended_at ?? right.lifecycle.started_at ?? ''}${right.invocation_id}`,
        ),
      )
      .at(-1);
    const snapshot = projectSnapshot(
      sessionId,
      invocation?.invocation_id ?? sessionId,
      invocation
        ? records.attempts.filter(
            (attempt) => attempt.invocation_id === invocation.invocation_id,
          )
        : [],
      records.attempts,
    );
    snapshot.invocations = records.invocations;
    snapshot.session.state = 'closed';
    const artifactPath = path.join(this.logDir, 'validation-metrics.json');
    await this.writePublishedSnapshot(artifactPath, snapshot);
    return { snapshot, artifactPath };
  }

  private async writePublishedSnapshot(
    destination: string,
    snapshot: unknown,
  ): Promise<void> {
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await this.snapshotFilesystem.mkdir(path.dirname(destination), {
      recursive: true,
    });
    let handle: fs.FileHandle | undefined;
    try {
      handle = await this.snapshotFilesystem.open(temporary, 'wx');
      await handle.writeFile(JSON.stringify(snapshot));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.snapshotFilesystem.rename(temporary, destination);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await this.snapshotFilesystem
        .rm(temporary, { force: true })
        .catch(() => undefined);
      throw error;
    }
  }
}

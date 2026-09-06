import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { mkdtemp, open, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsRecorder } from '../../src/metrics/recorder.js';
import type { StoreFilesystem } from '../../src/metrics/store.js';
import type { Invocation, ModelAttempt } from '../../src/metrics/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryLogDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-metrics-'));
  temporaryDirectories.push(dir);
  return dir;
}

function invocation(id: string, sessionId: string): Invocation {
  return {
    record_type: 'invocation', invocation_id: id, revision: 1, measurement_schema_version: 1,
    session_id: sessionId,
    lifecycle: { state: 'running', started_at: '2026-09-06T12:00:00.000Z', ended_at: null },
    attempt_ids: [], zero_dispatch: false, diagnostics: [],
  };
}

function attempt(id: string, sessionId: string, invocationId: string): ModelAttempt {
  const unavailable = { availability: 'unavailable' as const, value: null, reason: 'not_reported', source: null, origin: null, precision: null, derivation: null, included_in: null };
  return {
    record_type: 'model_attempt', attempt_id: id, revision: 1, measurement_schema_version: 1,
    session_id: sessionId, invocation_id: invocationId,
    lifecycle: { state: 'prepared', started_at: '2026-09-06T12:00:01.000Z', ended_at: null },
    adapter: 'fixture', outcome: 'unknown',
    requested_identity: { adapter: 'fixture', model: null, provider: null, effort: null, provenance: 'configuration' },
    resolved_identity: { adapter: 'fixture', model: null, provider: null, effort: null, provenance: 'launch_resolution' },
    observed_identities: [], observed_identity_availability: { availability: 'unavailable', reason: 'not_reported' },
    tokens: { input_total: unavailable, input_uncached: unavailable, cache_read: unavailable, cache_write: unavailable, output: unavailable, reasoning: unavailable, provider_total: unavailable, normalized_total: unavailable },
    provider_native_usage: [],
    completeness: { history: 'complete', collection: 'unavailable', canonical_fields: 'unavailable', normalized_total: 'unavailable', per_model_attribution: 'unavailable' },
    allocations: [], unallocated_usage: null, provider_reported_costs: [],
    provenance: { producer_version: 'test', build: { availability: 'unavailable', value: null, reason: 'not_injected' }, adapter_mapping_version: 'fixture-v1', cli_version: { availability: 'unavailable', value: null, reason: 'not_reported' }, source_format_version: { availability: 'unavailable', value: null, reason: 'not_reported' } },
    diagnostics: [],
  };
}

describe('durable metrics recorder', () => {
  test('commits prepared attempts and parent membership together across concurrent writers', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();
    await recorder.recordInvocation(invocation('invocation-1', session.session_id));

    await Promise.all([
      recorder.prepareAttempt(attempt('attempt-1', session.session_id, 'invocation-1')),
      recorder.prepareAttempt(attempt('attempt-2', session.session_id, 'invocation-1')),
    ]);

    const records = await recorder.readCommittedSession(session.session_id);
    expect(records.attempts.map((record) => record.attempt_id).sort()).toEqual(['attempt-1', 'attempt-2']);
    expect(records.invocations[0]?.attempt_ids.sort()).toEqual(['attempt-1', 'attempt-2']);
    expect(await readFile(path.join(logDir, '.metrics', 'records', 'attempt-1', '1.json'), 'utf8')).toContain('attempt-1');
  });

  test('publishes only a complete atomically-replaced snapshot owned by its current invocation', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();
    await recorder.recordInvocation(invocation('invocation-1', session.session_id));

    const publication = await recorder.publishSnapshot(session.session_id, 'invocation-1');
    expect(publication.state).toBe('published');
    expect(publication.owner_invocation_id).toBe('invocation-1');
    const snapshot = JSON.parse(await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'));
    expect(snapshot.current_invocation_id).toBe('invocation-1');
    expect(snapshot.snapshot_id).toBe(publication.snapshot_id);
  });

  test('recovers a dead owner without inventing completion time, usage, or success', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();
    await recorder.recordInvocation(invocation('invocation-1', session.session_id));
    await recorder.prepareAttempt(attempt('attempt-1', session.session_id, 'invocation-1'));

    const statePath = path.join(logDir, '.metrics', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.sessions[session.session_id].owner = { pid: 999_999_999, nonce: 'dead-owner' };
    await writeFile(statePath, JSON.stringify(state));

    const recovered = await MetricsRecorder.open(logDir);
    const records = await recovered.readCommittedSession(session.session_id);
    expect(records.attempts[0]).toMatchObject({ revision: 2, lifecycle: { state: 'interrupted', ended_at: null }, outcome: 'interrupted' });
    expect(records.attempts[0]?.tokens.normalized_total.value).toBeNull();
  });

  test('does not publish an orphan revision when a required metadata flush fails', async () => {
    let syncCount = 0;
    let failOnSync = Number.POSITIVE_INFINITY;
    const filesystem: StoreFilesystem = {
      async syncFile(handle) {
        syncCount += 1;
        if (syncCount === failOnSync) throw new Error('injected required flush failure');
        await handle.sync();
      },
      async syncDirectory(directory) {
        const handle = await open(directory, 'r');
        await handle.sync();
        await handle.close();
      },
    };
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir, filesystem);
    const session = await recorder.createSession();
    await recorder.recordInvocation(invocation('invocation-1', session.session_id));
    failOnSync = syncCount + 2; // attempt revision flushes, then its atomic parent revision must fail.

    await expect(recorder.prepareAttempt(attempt('attempt-1', session.session_id, 'invocation-1'))).rejects.toThrow('injected required flush failure');

    const recovered = await MetricsRecorder.open(logDir);
    const records = await recovered.readCommittedSession(session.session_id);
    expect(records.attempts).toEqual([]);
    expect(records.invocations[0]?.attempt_ids).toEqual([]);
  });

  test('will not join or dispatch into a closed session', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();
    await recorder.recordInvocation(invocation('invocation-1', session.session_id));
    await recorder.closeSession(session.session_id);

    await expect(recorder.joinSession(session.session_id)).rejects.toThrow('closed metrics session');
    await expect(recorder.prepareAttempt(attempt('attempt-1', session.session_id, 'invocation-1'))).rejects.toThrow('closed metrics session');
    await expect(recorder.store.commitAttemptWithParent(attempt('attempt-2', session.session_id, 'invocation-1'))).rejects.toThrow('closed metrics session');
  });

  test('recovers an abandoned, incomplete metadata-lock directory', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    const lockPath = path.join(logDir, '.metrics', 'metadata.lock');
    await fs.mkdir(lockPath);
    const stale = new Date(Date.now() - 60_000);
    await utimes(lockPath, stale, stale);

    await expect(recorder.createSession()).resolves.toMatchObject({ state: 'active' });
  });

  test('closes a failed snapshot temporary handle before removing it', async () => {
    const logDir = await temporaryLogDir();
    const recorder = await MetricsRecorder.open(logDir);
    let closeCalls = 0;
    (recorder as unknown as { snapshotFilesystem: { mkdir: typeof fs.mkdir; open: typeof fs.open; rename: typeof fs.rename; rm: typeof fs.rm } }).snapshotFilesystem = {
      mkdir: fs.mkdir,
      open: async () => ({
        writeFile: async () => { throw new Error('injected snapshot write failure'); },
        sync: async () => undefined,
        close: async () => { closeCalls += 1; },
      } as unknown as fs.FileHandle),
      rename: fs.rename,
      rm: fs.rm,
    };
    await expect((recorder as unknown as { writePublishedSnapshot(path: string, snapshot: unknown): Promise<void> }).writePublishedSnapshot(path.join(logDir, 'validation-metrics.json'), { snapshot_id: 'fixture' })).rejects.toThrow('injected snapshot write failure');
    expect(closeCalls).toBe(1);
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsStore } from '../../src/metrics/store.js';
import type { Invocation } from '../../src/metrics/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryLogDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'agent-validator-delivery-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function invocation(id: string, context: string): Invocation {
  return {
    record_type: 'invocation',
    invocation_id: id,
    revision: 1,
    measurement_schema_version: 1,
    session_id: 'session-1',
    lifecycle: {
      state: 'completed',
      started_at: '2026-09-06T12:00:00.000Z',
      ended_at: '2026-09-06T12:00:01.000Z',
    },
    attempt_ids: [],
    zero_dispatch: true,
    diagnostics: [],
    consumer_context: { consumer: 'agent-runner', context_id: context },
  };
}

describe('metrics delivery receipts', () => {
  test('fails closed without modifying populated pre-index development stores', async () => {
    const logDir = await temporaryLogDir();
    const store = await MetricsStore.open(logDir);
    await store.commit([invocation('committed', 'context-a')]);
    const statePath = path.join(logDir, '.metrics/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    delete state.record_index;
    const original = JSON.stringify(state);
    await writeFile(statePath, original);
    await expect(store.pendingInventory()).rejects.toThrow('Unsupported unindexed');
    expect(await readFile(statePath, 'utf8')).toBe(original);
  });

  test('rejects unsafe indexed record paths before reading any payload', async () => {
    const logDir = await temporaryLogDir();
    const store = await MetricsStore.open(logDir);
    await store.commit([invocation('committed', 'context-a')]);
    const statePath = path.join(logDir, '.metrics/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const entry = state.record_index['invocation:committed:1'];
    entry.record_id = '../outside';
    state.record_index = { 'invocation:../outside:1': entry };
    await writeFile(statePath, JSON.stringify(state));
    await expect(store.pendingInventory()).rejects.toThrow('Corrupt metrics record index');
  });

  test('selects committed metadata before reading bounded payloads and inventories without payload reads', async () => {
    const logDir = await temporaryLogDir();
    const store = await MetricsStore.open(logDir);
    await store.commit([invocation('z-first', 'context-a')]);
    await store.commit([invocation('a-later', 'context-a'), invocation('other', 'context-b')]);
    // Unselected payload corruption cannot force whole-backlog payload reads.
    await writeFile(path.join(logDir, '.metrics/records/a-later/1.json'), '{broken');
    await writeFile(path.join(logDir, '.metrics/records/other/1.json'), '{broken');
    const inventory = await store.pendingInventory();
    expect(inventory.contexts.map((entry) => entry.pending_revision_count)).toEqual([2, 1]);
    const batch = await store.exportPending({ consumer: 'agent-runner', context: 'context-a', protocolVersion: 1, measurementVersions: [1], maxRecords: 1 });
    expect(batch.records.map((record) => record.record_id)).toEqual(['z-first']);
    expect(batch.batch.remaining_revision_count).toBe(1);
  });

  test('does not export an orphan payload outside the committed revision index', async () => {
    const logDir = await temporaryLogDir();
    const store = await MetricsStore.open(logDir);
    await store.commit([invocation('committed', 'context-a')]);
    const original = await readFile(path.join(logDir, '.metrics/records/committed/1.json'), 'utf8');
    await mkdir(path.join(logDir, '.metrics/records/orphan'));
    await writeFile(path.join(logDir, '.metrics/records/orphan/1.json'), original);
    const result = await store.exportPending({ consumer: 'agent-runner', context: 'context-a', protocolVersion: 1, measurementVersions: [1] });
    expect(result.records).toHaveLength(1);
  });

  test('rejects malformed disposition metadata rather than pretending compatible state', async () => {
    const logDir = await temporaryLogDir();
    const store = await MetricsStore.open(logDir);
    const statePath = path.join(logDir, '.metrics/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.dispositions = [];
    await writeFile(statePath, JSON.stringify(state));
    await expect(store.pendingInventory()).rejects.toThrow('Corrupt');
  });
  test('exports a pending scoped record non-consumingly and acknowledges only its receipt', async () => {
    const store = await MetricsStore.open(await temporaryLogDir());
    await store.commit([invocation('invocation-1', 'context-a')]);

    const first = await store.exportPending({
      consumer: 'agent-runner',
      context: 'context-a',
      protocolVersion: 1,
      measurementVersions: [1],
    });
    const replay = await store.exportPending({
      consumer: 'agent-runner',
      context: 'context-a',
      protocolVersion: 1,
      measurementVersions: [1],
    });

    expect(first.evidence_state).toBe('pending');
    expect(first.records).toHaveLength(1);
    expect(replay.records).toEqual(first.records);
    expect(replay.receipt).toBe(first.receipt);

    await store.acknowledgeReceipt({
      consumer: 'agent-runner',
      context: 'context-a',
      protocolVersion: 1,
      receipt: first.receipt!,
    });
    const afterAcknowledgment = await store.exportPending({
      consumer: 'agent-runner',
      context: 'context-a',
      protocolVersion: 1,
      measurementVersions: [1],
    });

    expect(afterAcknowledgment.evidence_state).toBe('previously_acknowledged');
    expect(afterAcknowledgment.records).toEqual([]);
  });

  test('keeps dispositions distinct for record types sharing an identifier', async () => {
    const store = await MetricsStore.open(await temporaryLogDir());
    const key = (store as unknown as {
      revisionKey(record: { record_type: string; record_id: string; revision: number }): string;
    }).revisionKey;

    expect(key.call(store, { record_type: 'invocation', record_id: 'shared', revision: 1 }))
      .not.toBe(key.call(store, { record_type: 'model_attempt', record_id: 'shared', revision: 1 }));
  });

  test('rejects a discard receipt that was already acknowledged', async () => {
    const store = await MetricsStore.open(await temporaryLogDir());
    await store.commit([invocation('invocation-1', 'context-a')]);
    const exported = await store.exportPending({
      consumer: 'agent-runner', context: 'context-a', protocolVersion: 1, measurementVersions: [1],
    });
    await store.acknowledgeReceipt({
      consumer: 'agent-runner', context: 'context-a', protocolVersion: 1, receipt: exported.receipt!,
    });

    await expect(store.discardReceipt({
      consumer: 'agent-runner', context: 'context-a', protocolVersion: 1, receipt: exported.receipt!,
    })).rejects.toThrow('conflicting disposition');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
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

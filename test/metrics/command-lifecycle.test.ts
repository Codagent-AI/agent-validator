import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CommandMetricsLifecycle } from '../../src/metrics/command-lifecycle.js';
import { createUnavailableTelemetry } from '../../src/cli-adapters/shared.js';

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
    path.join(os.tmpdir(), 'agent-validator-command-metrics-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe('command metrics lifecycle', () => {
  test('publishes a terminal zero-dispatch invocation owned by this command', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('run');

    await lifecycle.associate(logDir);
    const telemetry = await lifecycle.finalize('no_changes');

    expect(telemetry.invocation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
    expect(telemetry.session_id).not.toBeNull();
    expect(telemetry.publication).toMatchObject({
      state: 'published',
      owner_invocation_id: telemetry.invocation_id,
    });
    const snapshot = JSON.parse(
      await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'),
    );
    expect(snapshot.current_invocation_id).toBe(telemetry.invocation_id);
    expect(snapshot.attempts).toEqual([]);
    expect(snapshot.invocations[0]).toMatchObject({
      invocation_id: telemetry.invocation_id,
      zero_dispatch: true,
      lifecycle: { state: 'completed' },
    });
  });

  test('keeps a pre-storage invocation explicit without inventing an artifact', async () => {
    const lifecycle = new CommandMetricsLifecycle('review');

    const telemetry = await lifecycle.finalize('error');

    expect(telemetry).toMatchObject({
      session_id: null,
      artifact_path: null,
      publication: {
        state: 'unavailable',
        owner_invocation_id: null,
      },
    });
  });

  test('retains an actual dispatch under its invocation and writes no extra attempt on finalization', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);

    const prepared = await lifecycle.prepareAttempt({
      adapter: 'fixture',
      gate: 'review-source',
      slot: 1,
      telemetry: createUnavailableTelemetry('fixture'),
    });
    await lifecycle.finalizeAttempt(
      prepared,
      createUnavailableTelemetry('fixture'),
      'passed',
    );
    const telemetry = await lifecycle.finalize('passed');
    const snapshot = JSON.parse(
      await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'),
    );

    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.attempts[0]).toMatchObject({
      attempt_id: prepared.attempt_id,
      invocation_id: telemetry.invocation_id,
      lifecycle: { state: 'completed' },
    });
  });
});

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CommandMetricsLifecycle } from '../../src/metrics/command-lifecycle.js';
import { createUnavailableTelemetry, observedMeasurement } from '../../src/cli-adapters/shared.js';
import { MetricsStore, type StoreFilesystem } from '../../src/metrics/store.js';
import { CodexAdapter } from '../../src/cli-adapters/codex.js';
import { AdapterExecutionFailure, type runStreamingCommand } from '../../src/cli-adapters/shared.js';
import { invokeAdapter } from '../../src/gates/review-runtime-helpers.js';

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

function storeFilesystem(beforeFileSync: () => Promise<void>): StoreFilesystem {
  return {
    async syncFile(handle) {
      await beforeFileSync();
      await handle.sync();
    },
    async syncDirectory(directory) {
      const handle = await open(directory, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    },
  };
}

/** Every commit flushes two files, so each commit costs about twice this delay. */
function slowStoreFilesystem(delayMs: number): StoreFilesystem {
  return storeFilesystem(() => new Promise((resolve) => setTimeout(resolve, delayMs)));
}

function outputTelemetry(output: number) {
  const telemetry = createUnavailableTelemetry('claude');
  telemetry.tokens.output = observedMeasurement(output, 'provider_event');
  telemetry.completeness.collection = 'partial';
  return telemetry;
}

async function committedAttempts(logDir: string, sessionId: string | null) {
  const store = await MetricsStore.openExisting(logDir);
  return (await store.readCommittedSession(sessionId ?? '')).attempts;
}

describe('command metrics lifecycle', () => {
  test.each(['\n', ''])('persists failed collector usage through the review runtime with final delimiter %j', async (delimiter) => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);
    const prepared = await lifecycle.prepareAttempt({ adapter: 'codex', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('codex') });
    const stream: typeof runStreamingCommand = async (opts) => {
      try {
        opts.onStdout?.(`{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}${delimiter}`);
        throw new Error('controlled exit');
      } finally { await opts.cleanup(); }
    };
    const adapter = new CodexAdapter(stream);
    expect((adapter as unknown as { streamCommand: typeof stream }).streamCommand).toBe(stream);
    const config = { name: 'review' } as Parameters<typeof invokeAdapter>[3];
    try {
      await invokeAdapter(adapter, 'synthetic fixture', '', config, undefined, async () => {}, {
        attemptId: prepared.attempt_id,
        onTelemetry: (telemetry) => { void lifecycle.observeAttempt(prepared, telemetry); },
      });
      throw new Error('expected controlled exit');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterExecutionFailure);
      await lifecycle.finalizeAttempt(prepared, (error as AdapterExecutionFailure).telemetry, 'error');
    }
    await lifecycle.finalize('error');
    const snapshot = JSON.parse(await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'));
    expect(snapshot.attempts[0]).toMatchObject({ attempt_id: prepared.attempt_id, revision: 3, tokens: { output: { value: 3 } } });
    expect(snapshot.aggregates.current_invocation.tokens.output.coverage.complete).toBe(false);
  });
  test('rejects non-allowlisted partial evidence without persisting its payload', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);
    const telemetry = createUnavailableTelemetry('fixture');
    const prepared = await lifecycle.prepareAttempt({ adapter: 'fixture', gate: 'review', slot: 1, telemetry });
    telemetry.provider_native_usage.push({ source: 'provider_event', name: 'prompt', value: 'synthetic-secret-canary' });
    await lifecycle.observeAttempt(prepared, telemetry);
    const result = await lifecycle.finalize('error');
    expect(result.publication.state).toBe('degraded');
    const snapshot = await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8');
    expect(snapshot).not.toContain('synthetic-secret-canary');
  });
  test('persists partial replacements under the prepared ID and ignores late evidence after terminal failure', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review', { consumer: 'runner', context_id: 'partial' });
    await lifecycle.associate(logDir);
    const unavailable = createUnavailableTelemetry('fixture');
    const prepared = await lifecycle.prepareAttempt({ adapter: 'fixture', gate: 'review', slot: 1, telemetry: unavailable });
    const partial = createUnavailableTelemetry('fixture');
    partial.tokens.output = { ...observedMeasurement(7, 'provider_event'), availability: 'partial', reason: 'truncated_source' } as typeof partial.tokens.output;
    partial.completeness.collection = 'partial';
    await lifecycle.observeAttempt(prepared, partial);
    const store = await MetricsStore.openExisting(logDir);
    const intermediate = await store!.exportPending({ consumer: 'runner', context: 'partial', protocolVersion: 1, measurementVersions: [1] });
    expect(intermediate.records.filter((record) => record.record_type === 'model_attempt').at(-1)?.payload).toMatchObject({ attempt_id: prepared.attempt_id, revision: 2, lifecycle: { state: 'running' }, tokens: { output: { availability: 'partial', value: 7, reason: 'truncated_source' } } });
    await lifecycle.finalizeAttempt(prepared, unavailable, 'error');
    partial.tokens.output = observedMeasurement(999, 'provider_event');
    await lifecycle.observeAttempt(prepared, partial);
    await lifecycle.finalize('error');
    const snapshot = JSON.parse(await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'));
    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.attempts[0]).toMatchObject({ revision: 3, lifecycle: { state: 'failed' }, tokens: { output: { value: 7 } }, completeness: { collection: 'partial' } });
    expect(snapshot.aggregates.current_invocation.tokens.output).toMatchObject({ availability: 'partial', value: 7, coverage: { partial_attempt_ids: [prepared.attempt_id], missing_attempt_ids: [], complete: false } });
  });
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

  test('degrades publication rather than claiming zero dispatch after attempt persistence fails', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);
    const recorder = (lifecycle as unknown as {
      recorder: { prepareAttempt: () => Promise<void> };
    }).recorder;
    recorder.prepareAttempt = async () => {
      throw new Error('injected attempt persistence failure');
    };

    await lifecycle.prepareAttempt({
      adapter: 'fixture',
      gate: 'review-source',
      slot: 1,
      telemetry: createUnavailableTelemetry('fixture'),
    });
    const telemetry = await lifecycle.finalize('passed');
    const snapshot = JSON.parse(
      await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8'),
    );

    expect(telemetry.publication).toMatchObject({
      state: 'degraded',
      reasons: ['attempt_persistence_failed'],
    });
    expect(snapshot.invocations[0]).toMatchObject({
      zero_dispatch: false,
      diagnostics: ['attempt_persistence_failed'],
    });
  });

  test('parallel finalization keeps a terminal attempt while a sibling bursts live progress on slow storage', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review', null, { filesystem: slowStoreFilesystem(150) });
    await lifecycle.associate(logDir);
    const bursting = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude') });
    const quiet = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 2, telemetry: createUnavailableTelemetry('claude') });
    for (let output = 1; output <= 10; output += 1) void lifecycle.observeAttempt(bursting, outputTelemetry(output));
    // The sibling's burst already holds the store when the quiet review finishes.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await Promise.all([
      lifecycle.finalizeAttempt(bursting, outputTelemetry(11), 'passed'),
      lifecycle.finalizeAttempt(quiet, outputTelemetry(5), 'passed'),
    ]);
    const telemetry = await lifecycle.finalize('passed');

    const attempts = await committedAttempts(logDir, telemetry.session_id);
    const terminal = (attemptId: string) => attempts.find((item) => item.attempt_id === attemptId);
    expect(terminal(quiet.attempt_id)).toMatchObject({ lifecycle: { state: 'completed' }, outcome: 'passed', tokens: { output: { value: 5 } } });
    expect(terminal(bursting.attempt_id)).toMatchObject({ lifecycle: { state: 'completed' }, outcome: 'passed', tokens: { output: { value: 11 } } });
    expect(telemetry.publication).toMatchObject({ state: 'published', reasons: [] });
  }, 20_000);

  test('coalesces queued live progress and lets the terminal write supersede it', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);
    const prepared = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude') });
    const progress = Array.from({ length: 10 }, (_, index) => lifecycle.observeAttempt(prepared, outputTelemetry(index + 1)));

    await lifecycle.finalizeAttempt(prepared, outputTelemetry(20), 'passed');
    await Promise.all(progress);
    const telemetry = await lifecycle.finalize('passed');

    const [attempt] = await committedAttempts(logDir, telemetry.session_id);
    expect(attempt).toMatchObject({ revision: 2, lifecycle: { state: 'completed' }, tokens: { output: { value: 20 } } });
  });

  test('a terminal failure without evidence keeps the partial evidence of the progress it superseded', async () => {
    const logDir = await temporaryLogDir();
    const lifecycle = new CommandMetricsLifecycle('review');
    await lifecycle.associate(logDir);
    const prepared = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude') });
    void lifecycle.observeAttempt(prepared, outputTelemetry(7));

    await lifecycle.finalizeAttempt(prepared, createUnavailableTelemetry('claude'), 'error');
    const telemetry = await lifecycle.finalize('error');

    const [attempt] = await committedAttempts(logDir, telemetry.session_id);
    expect(attempt).toMatchObject({ lifecycle: { state: 'failed' }, tokens: { output: { value: 7 } }, completeness: { collection: 'partial' } });
  });

  test('retries a transiently failing terminal write before publishing', async () => {
    const logDir = await temporaryLogDir();
    let failures = 0;
    const lifecycle = new CommandMetricsLifecycle('review', null, {
      filesystem: storeFilesystem(async () => {
        if (failures === 0) return;
        failures -= 1;
        throw new Error('injected transient flush failure');
      }),
      finalWriteRetryDelaysMs: [1, 1],
    });
    await lifecycle.associate(logDir);
    const prepared = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude') });
    failures = 1;

    await lifecycle.finalizeAttempt(prepared, outputTelemetry(3), 'passed');
    const telemetry = await lifecycle.finalize('passed');

    expect(telemetry.publication).toMatchObject({ state: 'published', reasons: [] });
    const [attempt] = await committedAttempts(logDir, telemetry.session_id);
    expect(attempt).toMatchObject({ lifecycle: { state: 'completed' }, tokens: { output: { value: 3 } } });
  });

  test('warns with the saved reasons when the terminal write keeps failing', async () => {
    const logDir = await temporaryLogDir();
    let failing = false;
    const lifecycle = new CommandMetricsLifecycle('review', null, {
      filesystem: storeFilesystem(async () => {
        if (failing) throw new Error('injected persistent flush failure');
      }),
      finalWriteRetryDelaysMs: [1, 1],
    });
    await lifecycle.associate(logDir);
    const prepared = await lifecycle.prepareAttempt({ adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude') });
    failing = true;
    await lifecycle.finalizeAttempt(prepared, outputTelemetry(3), 'passed');
    failing = false;
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const telemetry = await lifecycle.finalize('passed');

      expect(telemetry.publication).toMatchObject({ state: 'degraded', reasons: ['attempt_persistence_failed'] });
      const warnings = warn.mock.calls.map((call) => String(call[0]));
      expect(warnings).toEqual([expect.stringContaining('injected persistent flush failure')]);
    } finally {
      warn.mockRestore();
    }
  });
});

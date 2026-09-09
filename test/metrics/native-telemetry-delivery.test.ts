import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeOtelTelemetry } from '../../src/cli-adapters/claude-otel.js';
import { parseCodexTelemetry } from '../../src/cli-adapters/codex.js';
import { createUnavailableTelemetry } from '../../src/cli-adapters/shared.js';
import { CommandMetricsLifecycle } from '../../src/metrics/command-lifecycle.js';
import { MetricsStore } from '../../src/metrics/store.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
});

test('recorded Claude accounting survives snapshot and consumer export without changing native input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'validator-native-delivery-'));
  directories.push(directory);
  const lifecycle = new CommandMetricsLifecycle('review', { consumer: 'runner', context_id: 'native-fixture' });
  await lifecycle.associate(directory);
  const prepared = await lifecycle.prepareAttempt({adapter: 'claude', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('claude')});
  const raw = await readFile(new URL('../cli-adapters/fixtures/native-telemetry/claude-2.1.261-cache-write.txt', import.meta.url), 'utf8');
  const telemetry = parseClaudeOtelTelemetry(raw);
  await lifecycle.finalizeAttempt(prepared, telemetry, 'passed');
  await lifecycle.finalize('passed');
  const snapshot = JSON.parse(await readFile(path.join(directory, 'validation-metrics.json'), 'utf8'));
  const attempt = snapshot.attempts[0];
  expect(attempt.tokens.input_total).toMatchObject({value: 7511, origin: 'derived'});
  expect(attempt.tokens.input_uncached.value).toBe(3);
  expect(attempt.tokens.output.value).toBe(4);
  expect(attempt.provider_native_usage).toContainEqual({source: 'provider_event', name: 'claude_otel_input', value: 3});
  const store = await MetricsStore.openExisting(directory);
  const exported = await store!.exportPending({consumer: 'runner', context: 'native-fixture', protocolVersion: 1, measurementVersions: [1]});
  const head = exported.records.filter(record => record.record_type === 'model_attempt').at(-1);
  expect(head?.payload).toEqual(attempt);
  expect(JSON.stringify(head)).not.toContain('cost_usd'); // Raw capture payloads are not durable measurements.
});

test('recorded Codex cached-input evidence is accepted by durable recording', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'validator-native-delivery-'));
  directories.push(directory);
  const lifecycle = new CommandMetricsLifecycle('review');
  await lifecycle.associate(directory);
  const prepared = await lifecycle.prepareAttempt({adapter: 'codex', gate: 'review', slot: 1, telemetry: createUnavailableTelemetry('codex')});
  const raw = await readFile(new URL('../cli-adapters/fixtures/native-telemetry/codex-0.153.4.jsonl', import.meta.url), 'utf8');
  await lifecycle.finalizeAttempt(prepared, parseCodexTelemetry(raw), 'passed');
  await lifecycle.finalize('passed');
  const snapshot = JSON.parse(await readFile(path.join(directory, 'validation-metrics.json'), 'utf8'));
  expect(snapshot.attempts[0].tokens.input_total.value).toBe(12766);
  expect(snapshot.attempts[0].tokens.cache_read.value).toBe(5888);
  expect(snapshot.attempts[0].provider_native_usage).toContainEqual({source: 'provider_event', name: 'cached_input_tokens', value: 5888});
});

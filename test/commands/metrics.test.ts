import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsStore } from '../../src/metrics/store.js';
import type { Invocation } from '../../src/metrics/types.js';

function invocation(): Invocation {
  return {
    record_type: 'invocation', invocation_id: 'large-invocation', revision: 1, measurement_schema_version: 1,
    session_id: 'session-1', lifecycle: { state: 'completed', started_at: '2026-09-06T12:00:00.000Z', ended_at: '2026-09-06T12:00:01.000Z' },
    attempt_ids: [], zero_dispatch: true, diagnostics: ['x'.repeat(1_100_000)],
    consumer_context: { consumer: 'agent-runner', context_id: 'context-a' },
  };
}

test('metrics capabilities is config-independent structured JSON', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'capabilities'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: true,
    operation: 'capabilities',
    protocol_version: 1,
    capabilities_version: 1,
  });
});

test('metrics argument failures remain one structured stdout response', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'export'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({
    ok: false,
    operation: 'export',
    error: { code: 'invalid_arguments' },
  });
});

test('metrics export accepts a caller batch budget above the default', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const project = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-metrics-cli-'));
  try {
    await mkdir(path.join(project, '.validator'));
    await writeFile(path.join(project, '.validator', 'config.yml'), 'log_dir: logs\n');
    const store = await MetricsStore.open(path.join(project, 'logs'));
    await store.commit([invocation()]);
    const child = Bun.spawn({
      cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'export', '--project', project, '--consumer', 'agent-runner', '--context', 'context-a', '--protocol-version', '1', '--measurement-version', '1', '--max-bytes', '2000000'],
      cwd: root, stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(stdout).records).toHaveLength(1);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('invalid receipts retain their protocol error code', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const project = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-metrics-cli-'));
  try {
    await mkdir(path.join(project, '.validator'));
    await writeFile(path.join(project, '.validator', 'config.yml'), 'log_dir: logs\n');
    await MetricsStore.open(path.join(project, 'logs'));
    const child = Bun.spawn({
      cmd: [process.execPath, path.join(root, 'src/index.ts'), 'metrics', 'acknowledge', '--project', project, '--consumer', 'agent-runner', '--context', 'context-a', '--protocol-version', '1', '--receipt', 'missing'],
      cwd: root, stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(1);
    expect(JSON.parse(stdout).error.code).toBe('invalid_receipt');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsRecorder } from '../../src/metrics/recorder.js';
import type { Invocation } from '../../src/metrics/types.js';

test('independent writers retain every commit while an independent reader sees complete snapshots', async () => {
  const logDir = await mkdtemp(path.join(os.tmpdir(), 'validator-process-metrics-'));
  const recorder = await MetricsRecorder.open(logDir);
  const session = await recorder.createSession();
  const original: Invocation = {
    record_type: 'invocation', invocation_id: 'parent', revision: 1, measurement_schema_version: 1,
    session_id: session.session_id, lifecycle: { state: 'completed', started_at: '2026-09-06T12:00:00.000Z', ended_at: '2026-09-06T12:00:01.000Z' },
    attempt_ids: [], zero_dispatch: true, diagnostics: [],
  };
  await recorder.recordInvocation(original);
  await recorder.publishSnapshot(session.session_id, 'parent');
  const modulePath = path.resolve(import.meta.dir, '../../src/metrics/store.ts');
  const children = ['writer-a', 'writer-b', 'reader'].map((role) => {
    const source = `
      import fs from 'node:fs/promises';
      import { MetricsStore } from ${JSON.stringify(modulePath)};
      const dir = ${JSON.stringify(logDir)};
      const store = await MetricsStore.openExisting(dir);
      console.log('ready');
      for await (const chunk of process.stdin) { break; }
      for (let i = 0; i < 12; i++) {
        if (${JSON.stringify(role)} === 'reader') {
          const snapshot = JSON.parse(await fs.readFile(dir + '/validation-metrics.json', 'utf8'));
          if (snapshot.current_invocation_id !== 'parent' || !snapshot.snapshot_id) throw new Error('invalid snapshot');
        } else {
          await store.commit([{ ...${JSON.stringify(original)}, invocation_id: ${JSON.stringify(role)} + '-' + i }]);
        }
      }
    `;
    return Bun.spawn({ cmd: [process.execPath, '--eval', source], stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  });
  try {
    await Promise.all(children.map(async (child) => {
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain('ready');
      reader.releaseLock();
    }));
    for (const child of children) { child.stdin.write('start\n'); child.stdin.end(); }
    for (let i = 0; i < 12; i++) {
      expect((await recorder.publishSnapshot(session.session_id, 'parent')).state).toBe('published');
    }
    for (const child of children) {
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited, stderr).toBe(0);
    }
    const records = await recorder.readCommittedSession(session.session_id);
    expect(records.invocations).toHaveLength(25);
  } finally {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exited));
    await rm(logDir, { recursive: true, force: true });
  }
}, 10_000);

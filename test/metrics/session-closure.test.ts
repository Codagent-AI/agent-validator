import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeMeasuredSession } from '../../src/metrics/session-closure.js';
import { recoverPendingSessionClosures } from '../../src/metrics/session-closure.js';
import { MetricsRecorder } from '../../src/metrics/recorder.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function logDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-close-'));
  directories.push(directory);
  return directory;
}

describe('measured session closure', () => {
  test('closes an active metrics-only session once and archives its immutable snapshot', async () => {
    const logDir = await logDirectory();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();

    await closeMeasuredSession(logDir, 2);

    const closed = await recorder.store.readSession(session.session_id);
    expect(closed?.state).toBe('closed');
    const archived = JSON.parse(await readFile(path.join(logDir, 'previous', 'validation-metrics.json'), 'utf8'));
    expect(archived.session.session_id).toBe(session.session_id);

    await closeMeasuredSession(logDir, 2);
    expect(await readFile(path.join(logDir, 'previous', 'validation-metrics.json'), 'utf8')).toContain(session.session_id);
    await expect(readFile(path.join(logDir, 'previous.1', 'validation-metrics.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('uses depth zero without rotating existing archives while retaining latest and pending records', async () => {
    const logDir = await logDirectory();
    await writeFile(path.join(logDir, 'current.1.log'), 'current');
    await writeFile(path.join(logDir, 'validation-metrics.json'), '{"old":true}');
    await writeFile(path.join(logDir, 'previous-marker'), 'not an archive');
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();

    await closeMeasuredSession(logDir, 0);

    expect((await recorder.store.readSession(session.session_id))?.state).toBe('closed');
    await expect(readFile(path.join(logDir, 'current.1.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(logDir, 'validation-metrics.json'), 'utf8')).toContain(session.session_id);
    expect(await readFile(path.join(logDir, 'previous-marker'), 'utf8')).toBe('not an archive');
    await expect(readFile(path.join(logDir, 'previous', 'validation-metrics.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('recovers a staged close without rediscovering or rotating it twice', async () => {
    const logDir = await logDirectory();
    const recorder = await MetricsRecorder.open(logDir);
    const session = await recorder.createSession();
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d1';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    const publication = await recorder.publishClosedSessionSnapshot(session.session_id);
    await recorder.beginSessionClose(session.session_id, closeId);
    await mkdir(path.join(staging, 'files'), { recursive: true });
    await writeFile(path.join(staging, 'files', 'frozen.1.log'), 'frozen');
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: session.session_id,
        max_previous_logs: 2,
        ordinary: [{ name: 'frozen.1.log', size: 6, mtime_ms: 1 }],
        snapshot: JSON.parse(await readFile(publication.artifactPath, 'utf8')),
        phase: 'staged',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toEqual([]);
    expect((await recorder.store.readSession(session.session_id))?.state).toBe('closed');
    expect(await readFile(path.join(logDir, 'previous', 'frozen.1.log'), 'utf8')).toBe('frozen');
    expect(await readFile(path.join(logDir, 'previous', 'validation-metrics.json'), 'utf8')).toContain(session.session_id);
  });
});

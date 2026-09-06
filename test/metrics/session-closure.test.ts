import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
  for (const linkedComponent of ['staging', 'closures', '.metrics']) {
    test(`rejects a symlinked ${linkedComponent} root before reading or moving closure evidence`, async () => {
      const parent = await logDirectory();
      const logDir = path.join(parent, 'logs');
      const external = path.join(parent, 'external');
      const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d7';
      const staging = path.join(logDir, '.metrics', 'closures', closeId);
      const link = linkedComponent === 'staging' ? staging : linkedComponent === 'closures' ? path.dirname(staging) : path.join(logDir, '.metrics');
      await mkdir(path.dirname(link), { recursive: true });
      await mkdir(external);
      await symlink(external, link);
      await mkdir(staging, { recursive: true });
      await mkdir(path.join(logDir, 'previous'), { recursive: true });
      await writeFile(path.join(logDir, 'previous', 'archive.log'), 'archive');
      const journal = JSON.stringify({ close_id: closeId, session_id: null, max_previous_logs: 1, ordinary: [], archive_directories: ['previous'], archive_operations: [{ source: 'previous', destination: 'evicted/previous', state: 'pending' }], snapshot: null, snapshot_digest: null, phase: 'staged' });
      await writeFile(path.join(staging, 'journal.json'), journal);
      const result = await recoverPendingSessionClosures(logDir);
      expect(result.warnings).toHaveLength(1);
      expect(await readFile(path.join(logDir, 'previous', 'archive.log'), 'utf8')).toBe('archive');
      expect(await readFile(path.join(staging, 'journal.json'), 'utf8')).toBe(journal);
    });
  }
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

  test('recovers after a shifted archive exists before its journal operation is marked complete', async () => {
    const logDir = await logDirectory();
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d2';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    await mkdir(path.join(logDir, 'previous'), { recursive: true });
    await mkdir(path.join(logDir, 'previous.2'), { recursive: true });
    await mkdir(path.join(staging, 'files'), { recursive: true });
    await writeFile(path.join(logDir, 'previous', 'newer.log'), 'newer');
    await writeFile(path.join(logDir, 'previous.2', 'shifted.log'), 'shifted');
    await writeFile(path.join(staging, 'files', 'current.log'), 'current');
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: null,
        max_previous_logs: 3,
        ordinary: [{ name: 'current.log', size: 7, mtime_ms: 1 }],
        archive_directories: ['previous', 'previous.1', 'previous.2'],
        archive_operations: [
          { source: 'previous.2', destination: 'evicted/previous.2', state: 'done' },
          { source: 'previous.1', destination: 'previous.2', state: 'pending' },
          { source: 'previous', destination: 'previous.1', state: 'pending' },
        ],
        snapshot: null,
        snapshot_digest: null,
        phase: 'staged',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toEqual([]);
    expect(await readFile(path.join(logDir, 'previous.2', 'shifted.log'), 'utf8')).toBe('shifted');
    expect(await readFile(path.join(logDir, 'previous.1', 'newer.log'), 'utf8')).toBe('newer');
    expect(await readFile(path.join(logDir, 'previous', 'current.log'), 'utf8')).toBe('current');
  });

  test('reports a malformed closure journal as degraded recovery instead of throwing', async () => {
    const logDir = await logDirectory();
    const journal = path.join(logDir, '.metrics', 'closures', 'broken', 'journal.json');
    await mkdir(path.dirname(journal), { recursive: true });
    await writeFile(journal, '{not-json');

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('broken');
  });

  test('rejects a closure journal archive operation that escapes the log directory', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-close-parent-'));
    directories.push(parent);
    const logDir = path.join(parent, 'logs');
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d3';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    const escaped = path.join(parent, 'escaped');
    await mkdir(path.join(logDir, 'previous'), { recursive: true });
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(logDir, 'previous', 'archive.log'), 'archive');
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: null,
        max_previous_logs: 3,
        ordinary: [],
        archive_directories: ['previous'],
        archive_operations: [
          { source: 'previous', destination: '../escaped', state: 'pending' },
        ],
        snapshot: null,
        snapshot_digest: null,
        phase: 'staged',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('invalid closure journal');
    expect(await readFile(path.join(logDir, 'previous', 'archive.log'), 'utf8')).toBe('archive');
    await expect(readFile(path.join(escaped, 'archive.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects a closure journal archive destination with a symlinked staging component', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-close-parent-'));
    directories.push(parent);
    const logDir = path.join(parent, 'logs');
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d5';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    const external = path.join(parent, 'external');
    await mkdir(path.join(logDir, 'previous'), { recursive: true });
    await mkdir(staging, { recursive: true });
    await mkdir(external);
    await symlink(external, path.join(staging, 'evicted'));
    await writeFile(path.join(logDir, 'previous', 'archive.log'), 'archive');
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: null,
        max_previous_logs: 3,
        ordinary: [],
        archive_directories: ['previous'],
        archive_operations: [
          { source: 'previous', destination: 'evicted/previous', state: 'pending' },
        ],
        snapshot: null,
        snapshot_digest: null,
        phase: 'staged',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toHaveLength(1);
    expect(await readFile(path.join(logDir, 'previous', 'archive.log'), 'utf8')).toBe('archive');
    await expect(readFile(path.join(external, 'previous', 'archive.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects a closure journal ordinary-file inventory that escapes the log directory', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-close-parent-'));
    directories.push(parent);
    const logDir = path.join(parent, 'logs');
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d4';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    const external = path.join(parent, 'external.log');
    await mkdir(staging, { recursive: true });
    await writeFile(external, 'external');
    const metadata = await stat(external);
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: null,
        max_previous_logs: 3,
        ordinary: [
          {
            name: '../external.log',
            size: metadata.size,
            mtime_ms: metadata.mtimeMs,
          },
        ],
        archive_directories: [],
        archive_operations: [],
        snapshot: null,
        snapshot_digest: null,
        phase: 'closing',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('invalid closure journal');
    expect(await readFile(external, 'utf8')).toBe('external');
  });

  test('rejects a symlinked staging files directory before moving ordinary logs', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'agent-validator-close-parent-'));
    directories.push(parent);
    const logDir = path.join(parent, 'logs');
    const closeId = 'f4d0273d-a7d4-42c7-97ee-00b1eb7348d6';
    const staging = path.join(logDir, '.metrics', 'closures', closeId);
    const external = path.join(parent, 'external');
    await mkdir(staging, { recursive: true });
    await mkdir(external);
    await symlink(external, path.join(staging, 'files'));
    await writeFile(path.join(logDir, 'current.log'), 'current');
    const metadata = await stat(path.join(logDir, 'current.log'));
    await writeFile(
      path.join(staging, 'journal.json'),
      JSON.stringify({
        close_id: closeId,
        session_id: null,
        max_previous_logs: 3,
        ordinary: [
          {
            name: 'current.log',
            size: metadata.size,
            mtime_ms: metadata.mtimeMs,
          },
        ],
        archive_directories: [],
        archive_operations: [],
        snapshot: null,
        snapshot_digest: null,
        phase: 'closing',
      }),
    );

    const result = await recoverPendingSessionClosures(logDir);

    expect(result.warnings).toHaveLength(1);
    expect(await readFile(path.join(logDir, 'current.log'), 'utf8')).toBe('current');
    await expect(readFile(path.join(external, 'current.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('evicts every archive beyond a reduced retention depth', async () => {
    const logDir = await logDirectory();
    for (const name of ['previous', 'previous.1', 'previous.2', 'previous.3']) {
      await mkdir(path.join(logDir, name), { recursive: true });
      await writeFile(path.join(logDir, name, 'archive.log'), name);
    }
    await writeFile(path.join(logDir, 'current.log'), 'current');

    await closeMeasuredSession(logDir, 2);

    expect(await readFile(path.join(logDir, 'previous', 'current.log'), 'utf8')).toBe('current');
    expect(await readFile(path.join(logDir, 'previous.1', 'archive.log'), 'utf8')).toBe('previous');
    await expect(readFile(path.join(logDir, 'previous.2', 'archive.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(logDir, 'previous.3', 'archive.log'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

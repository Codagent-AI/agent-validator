import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MetricsRecorder } from './recorder.js';

interface InventoryEntry {
  name: string;
  size: number;
  mtime_ms: number;
}

interface ClosureJournal {
  close_id: string;
  session_id: string | null;
  max_previous_logs: number;
  ordinary: InventoryEntry[];
  archive_directories: string[];
  snapshot: unknown | null;
  snapshot_digest: string | null;
  phase: 'closing' | 'staged' | 'rotated' | 'published' | 'closed';
}

export interface SessionClosureResult {
  closed: boolean;
  close_id: string | null;
  warnings: string[];
}

const snapshotName = 'validation-metrics.json';

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

async function exists(target: string): Promise<boolean> {
  return fs
    .lstat(target)
    .then(() => true)
    .catch(() => false);
}

function ordinaryName(name: string): boolean {
  return (
    (name.endsWith('.log') || name.endsWith('.json')) &&
    name !== snapshotName &&
    !name.startsWith('.') &&
    !name.startsWith('previous')
  );
}

async function inventory(logDir: string): Promise<InventoryEntry[]> {
  const names = await fs.readdir(logDir);
  const entries = await Promise.all(
    names.filter(ordinaryName).map(async (name) => {
      const stat = await fs.stat(path.join(logDir, name));
      return { name, size: stat.size, mtime_ms: stat.mtimeMs };
    }),
  );
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function archiveInventory(logDir: string): Promise<string[]> {
  return (await fs.readdir(logDir))
    .filter((name) => /^previous(?:\.\d+)?$/.test(name))
    .sort();
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function writeAtomic(destination: string, body: unknown): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(body));
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, destination);
    const directory = await fs.open(path.dirname(destination), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJournal(
  journalPath: string,
): Promise<ClosureJournal | null> {
  try {
    return JSON.parse(await fs.readFile(journalPath, 'utf8')) as ClosureJournal;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function moveFrozenFiles(
  logDir: string,
  staging: string,
  entries: InventoryEntry[],
): Promise<void> {
  const files = path.join(staging, 'files');
  await fs.mkdir(files, { recursive: true });
  for (const entry of entries) {
    const source = path.join(logDir, entry.name);
    const staged = path.join(files, entry.name);
    if (await exists(staged)) continue;
    const stat = await fs.stat(source).catch((error) => {
      if (isMissing(error))
        throw new Error(`closure inventory conflict: missing ${entry.name}`);
      throw error;
    });
    if (stat.size !== entry.size || stat.mtimeMs !== entry.mtime_ms)
      throw new Error(`closure inventory conflict: changed ${entry.name}`);
    await fs.rename(source, staged);
  }
}

async function rotateArchives(
  logDir: string,
  staging: string,
  depth: number,
): Promise<void> {
  if (depth === 0) return;
  const evicted = path.join(staging, 'evicted');
  const oldest = depth === 1 ? 'previous' : `previous.${depth - 1}`;
  const oldestPath = path.join(logDir, oldest);
  if (await exists(oldestPath)) {
    await fs.mkdir(evicted, { recursive: true });
    await fs.rename(oldestPath, path.join(evicted, oldest));
  }
  for (let index = depth - 2; index >= 0; index -= 1) {
    const from = path.join(
      logDir,
      index === 0 ? 'previous' : `previous.${index}`,
    );
    const to = path.join(logDir, `previous.${index + 1}`);
    if (await exists(from)) {
      if (await exists(to))
        throw new Error(`closure archive conflict: ${path.basename(to)}`);
      await fs.rename(from, to);
    }
  }
  await fs.mkdir(path.join(logDir, 'previous'), { recursive: true });
}

async function continueClosure(
  logDir: string,
  staging: string,
  journalPath: string,
  journal: ClosureJournal,
  recorder: MetricsRecorder | null,
): Promise<void> {
  if (journal.session_id && recorder) {
    const session = await recorder.store.readSession(journal.session_id);
    if (!session)
      throw new Error(`closure session missing: ${journal.session_id}`);
    if (session.state === 'active')
      await recorder.beginSessionClose(journal.session_id, journal.close_id);
    if (journal.snapshot === null) {
      const publication = await recorder.publishClosedSessionSnapshot(
        journal.session_id,
      );
      journal.snapshot = publication.snapshot;
      journal.snapshot_digest = digest(publication.snapshot);
      await writeAtomic(journalPath, journal);
    }
  }
  if (journal.phase === 'closing') {
    await moveFrozenFiles(logDir, staging, journal.ordinary);
    journal.phase = 'staged';
    await writeAtomic(journalPath, journal);
  }
  if (journal.phase === 'staged') {
    await rotateArchives(logDir, staging, journal.max_previous_logs);
    journal.phase = 'rotated';
    await writeAtomic(journalPath, journal);
  }
  if (journal.phase === 'rotated') {
    await installArchive(staging, logDir, journal);
    journal.phase = 'published';
    await writeAtomic(journalPath, journal);
  }
  if (journal.phase === 'published') {
    if (journal.session_id && recorder)
      await recorder.completeSessionClose(journal.session_id, journal.close_id);
    journal.phase = 'closed';
    await writeAtomic(journalPath, journal);
  }
}

/** Continue a frozen close before a new validation associates a session. */
export async function recoverPendingSessionClosures(
  logDir: string,
): Promise<SessionClosureResult> {
  const closures = path.join(logDir, '.metrics', 'closures');
  let names: string[];
  try {
    names = await fs.readdir(closures);
  } catch (error) {
    if (isMissing(error))
      return { closed: false, close_id: null, warnings: [] };
    return {
      closed: false,
      close_id: null,
      warnings: [
        error instanceof Error ? error.message : 'closure recovery unavailable',
      ],
    };
  }
  for (const name of names.sort()) {
    const result = await recoverOneClosure(logDir, closures, name);
    if (result) return result;
  }
  return { closed: false, close_id: null, warnings: [] };
}

async function recoverOneClosure(
  logDir: string,
  closures: string,
  name: string,
): Promise<SessionClosureResult | null> {
  const staging = path.join(closures, name);
  const journalPath = path.join(staging, 'journal.json');
  const journal = await readJournal(journalPath);
  if (!journal || journal.phase === 'closed') return null;
  let recorder: MetricsRecorder | null = null;
  if (journal.session_id) {
    try {
      recorder = await MetricsRecorder.openExisting(logDir);
    } catch (error) {
      return {
        closed: false,
        close_id: null,
        warnings: [
          error instanceof Error
            ? error.message
            : 'metrics storage unavailable',
        ],
      };
    }
  }
  try {
    await continueClosure(logDir, staging, journalPath, journal, recorder);
    return null;
  } catch (error) {
    return {
      closed: false,
      close_id: journal.close_id,
      warnings: [
        error instanceof Error ? error.message : 'closure recovery failed',
      ],
    };
  }
}

async function installArchive(
  staging: string,
  logDir: string,
  journal: ClosureJournal,
): Promise<void> {
  if (journal.max_previous_logs === 0) {
    await fs.rm(path.join(staging, 'files'), { recursive: true, force: true });
    return;
  }
  const previous = path.join(logDir, 'previous');
  const files = path.join(staging, 'files');
  for (const entry of journal.ordinary) {
    const staged = path.join(files, entry.name);
    const target = path.join(previous, entry.name);
    if (await exists(staged)) await fs.rename(staged, target);
  }
  if (journal.snapshot !== null) {
    if (
      typeof journal.snapshot_digest === 'string' &&
      digest(journal.snapshot) !== journal.snapshot_digest
    )
      throw new Error('closure snapshot digest conflict');
    const stagedSnapshot = path.join(staging, snapshotName);
    if (
      !(
        (await exists(stagedSnapshot)) ||
        (await exists(path.join(previous, snapshotName)))
      )
    )
      await writeAtomic(stagedSnapshot, journal.snapshot);
    if (await exists(stagedSnapshot))
      await fs.rename(stagedSnapshot, path.join(previous, snapshotName));
  }
}

/**
 * Runs under the validation run lock. The durable journal means a retried clean
 * only continues its frozen transaction; it never rediscovers newer root logs.
 */
export async function closeMeasuredSession(
  logDir: string,
  maxPreviousLogs: number,
): Promise<SessionClosureResult> {
  if (!(await exists(logDir)))
    return { closed: false, close_id: null, warnings: [] };
  const recovered = await recoverPendingSessionClosures(logDir);
  if (recovered.warnings.length > 0) return recovered;
  let recorder: MetricsRecorder | null = null;
  try {
    recorder = await MetricsRecorder.openExisting(logDir);
  } catch (error) {
    if (!isMissing(error))
      return {
        closed: false,
        close_id: null,
        warnings: [
          error instanceof Error
            ? error.message
            : 'metrics storage unavailable',
        ],
      };
  }
  const active = (await recorder?.store.findActiveSession()) ?? null;
  const ordinary = await inventory(logDir);
  if (!active && ordinary.length === 0)
    return { closed: false, close_id: null, warnings: [] };

  const closeId = randomUUID();
  const staging = path.join(logDir, '.metrics', 'closures', closeId);
  const journalPath = path.join(staging, 'journal.json');
  const journal: ClosureJournal = {
    close_id: closeId,
    session_id: active?.session_id ?? null,
    max_previous_logs: maxPreviousLogs,
    ordinary,
    archive_directories: await archiveInventory(logDir),
    snapshot: null,
    snapshot_digest: null,
    phase: 'closing',
  };
  await writeAtomic(journalPath, journal);
  await continueClosure(logDir, staging, journalPath, journal, recorder);
  return { closed: Boolean(active), close_id: closeId, warnings: [] };
}

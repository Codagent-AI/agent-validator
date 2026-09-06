import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ensureSafeDirectory,
  moveArchiveDirectory,
  operationPath,
} from './closure-paths.js';
import { isMissingFileError } from './errors.js';
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
  archive_operations?: ArchiveOperation[];
  snapshot: unknown | null;
  snapshot_digest: string | null;
  phase: 'closing' | 'staged' | 'rotated' | 'published' | 'closed';
}

interface ArchiveOperation {
  source: string;
  destination: string;
  state: 'pending' | 'started' | 'done';
}

export interface SessionClosureResult {
  closed: boolean;
  close_id: string | null;
  warnings: string[];
}

const snapshotName = 'validation-metrics.json';

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
    const journal = JSON.parse(
      await fs.readFile(journalPath, 'utf8'),
    ) as ClosureJournal;
    validateJournal(journal);
    return journal;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function archiveName(value: unknown): value is string {
  return (
    typeof value === 'string' && /^previous(?:\.(?:0|[1-9]\d*))?$/.test(value)
  );
}

function expectedArchiveDestination(source: string): string {
  return source === 'previous'
    ? 'previous.1'
    : `previous.${Number(source.slice('previous.'.length)) + 1}`;
}

function invalidJournal(message: string): Error {
  return new Error(`invalid closure journal: ${message}`);
}

function ordinaryEntry(value: unknown): value is InventoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as InventoryEntry;
  return (
    typeof entry.name === 'string' &&
    path.basename(entry.name) === entry.name &&
    !entry.name.includes('\\') &&
    !entry.name.includes('\0') &&
    ordinaryName(entry.name) &&
    Number.isFinite(entry.size) &&
    entry.size >= 0 &&
    Number.isFinite(entry.mtime_ms) &&
    entry.mtime_ms >= 0
  );
}

function validateJournal(journal: ClosureJournal): void {
  const validOrdinary =
    Array.isArray(journal.ordinary) && journal.ordinary.every(ordinaryEntry);
  if (!validOrdinary) throw invalidJournal('invalid ordinary file inventory');
  if (
    journal.archive_directories !== undefined &&
    !(
      Array.isArray(journal.archive_directories) &&
      journal.archive_directories.every(archiveName)
    )
  )
    throw invalidJournal('invalid archive directory');
  if (journal.archive_operations === undefined) return;
  if (!Array.isArray(journal.archive_operations))
    throw invalidJournal('invalid archive operations');
  for (const operation of journal.archive_operations) {
    if (
      !operation ||
      typeof operation !== 'object' ||
      !archiveName(operation.source) ||
      typeof operation.destination !== 'string' ||
      !['pending', 'started', 'done'].includes(operation.state)
    )
      throw invalidJournal('invalid archive operation');
    const expected = expectedArchiveDestination(operation.source);
    if (
      operation.destination !== expected &&
      operation.destination !== `evicted/${operation.source}`
    )
      throw invalidJournal('invalid archive destination');
  }
}

async function moveFrozenFiles(
  logDir: string,
  staging: string,
  entries: InventoryEntry[],
): Promise<void> {
  const files = path.join(staging, 'files');
  await ensureSafeDirectory(logDir, files);
  for (const entry of entries) {
    const source = path.join(logDir, entry.name);
    const staged = path.join(files, entry.name);
    if (await exists(staged)) continue;
    const stat = await fs.stat(source).catch((error) => {
      if (isMissingFileError(error))
        throw new Error(`closure inventory conflict: missing ${entry.name}`);
      throw error;
    });
    if (stat.size !== entry.size || stat.mtimeMs !== entry.mtime_ms)
      throw new Error(`closure inventory conflict: changed ${entry.name}`);
    await fs.rename(source, staged);
  }
}

function archiveIndex(name: string): number {
  return name === 'previous' ? 0 : Number(name.slice('previous.'.length));
}

function archiveOperations(
  archives: string[],
  depth: number,
): ArchiveOperation[] {
  if (depth === 0) return [];
  const indexed = archives
    .map((name) => ({ name, index: archiveIndex(name) }))
    .sort((left, right) => right.index - left.index);
  return [
    ...indexed
      .filter(({ index }) => index >= depth - 1)
      .map(({ name }) => ({
        source: name,
        destination: path.join('evicted', name),
        state: 'pending' as const,
      })),
    ...indexed
      .filter(({ index }) => index < depth - 1)
      .map(({ name, index }) => ({
        source: name,
        destination: `previous.${index + 1}`,
        state: 'pending' as const,
      })),
  ];
}

async function rotateArchives(
  logDir: string,
  staging: string,
  journalPath: string,
  journal: ClosureJournal,
): Promise<void> {
  journal.archive_operations ??= archiveOperations(
    journal.archive_directories ?? [],
    journal.max_previous_logs,
  );
  await writeAtomic(journalPath, journal);
  for (const operation of journal.archive_operations) {
    if (operation.state === 'done') continue;
    operation.state = 'started';
    await writeAtomic(journalPath, journal);
    const source = operationPath(logDir, staging, operation.source);
    const destination = operationPath(logDir, staging, operation.destination);
    await moveArchiveDirectory(
      source,
      destination,
      logDir,
      operation.source,
      operation.destination,
    );
    operation.state = 'done';
    await writeAtomic(journalPath, journal);
  }
  if (journal.max_previous_logs > 0)
    await ensureSafeDirectory(logDir, path.join(logDir, 'previous'));
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
    await rotateArchives(logDir, staging, journalPath, journal);
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
    await ensureSafeDirectory(logDir, closures);
  } catch (error) {
    if (isMissingFileError(error))
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
  try {
    await ensureSafeDirectory(logDir, staging);
    const journal = await readJournal(journalPath);
    if (!journal || journal.phase === 'closed') return null;
    let recorder: MetricsRecorder | null = null;
    if (journal.session_id) {
      recorder = await MetricsRecorder.openExisting(logDir);
    }
    await continueClosure(logDir, staging, journalPath, journal, recorder);
    return null;
  } catch (error) {
    return {
      closed: false,
      close_id: null,
      warnings: [
        `closure ${name}: ${error instanceof Error ? error.message : 'recovery failed'}`,
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
  await ensureSafeDirectory(logDir, files);
  await ensureSafeDirectory(logDir, previous);
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
    if (!isMissingFileError(error))
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
  const archives = await archiveInventory(logDir);
  await ensureSafeDirectory(logDir, staging);
  const journal: ClosureJournal = {
    close_id: closeId,
    session_id: active?.session_id ?? null,
    max_previous_logs: maxPreviousLogs,
    ordinary,
    archive_directories: archives,
    archive_operations: archiveOperations(archives, maxPreviousLogs),
    snapshot: null,
    snapshot_digest: null,
    phase: 'closing',
  };
  await writeAtomic(journalPath, journal);
  await continueClosure(logDir, staging, journalPath, journal, recorder);
  return { closed: Boolean(active), close_id: closeId, warnings: [] };
}

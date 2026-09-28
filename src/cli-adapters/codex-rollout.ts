import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  isSafeCodexProviderId,
  resolveCodexHome,
} from './codex-identity-utils.js';
import { SAFE_MODEL_ID_PATTERN } from './model-resolution.js';

export interface CodexObservedIdentity {
  model: string | null;
  provider: string | null;
  reason: string | null;
}

const SAFE_THREAD_ID = /^[A-Za-z0-9-]+$/;

export function extractCodexThreadId(raw: string): string | null {
  for (const line of raw.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (
        event?.type === 'thread.started' &&
        typeof event.thread_id === 'string' &&
        SAFE_THREAD_ID.test(event.thread_id)
      )
        return event.thread_id;
    } catch {
      // Other output lines need not be JSON.
    }
  }
  return null;
}

async function datedDirectories(root: string): Promise<string[]> {
  const years = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 10);
  const days: string[] = [];
  for (const year of years) {
    const yearPath = path.join(root, year);
    const months = (await readdir(yearPath, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && /^(0[1-9]|1[0-2])$/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      const dates = (await readdir(monthPath, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isDirectory() &&
            /^(0[1-9]|[12][0-9]|3[01])$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const day of dates) days.push(path.join(monthPath, day));
    }
  }
  return days;
}

async function findRollout(
  root: string,
  threadId: string,
): Promise<string | null> {
  for (const day of await datedDirectories(root)) {
    let files: string[];
    try {
      files = await readdir(day);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const name = files
      .filter(
        (file) =>
          file.startsWith('rollout-') && file.endsWith(`-${threadId}.jsonl`),
      )
      .sort()
      .reverse()[0];
    if (name) return path.join(day, name);
  }
  return null;
}

function validateRolloutIdentity(
  turnModel: unknown,
  sessionModel: unknown,
  provider: unknown,
): CodexObservedIdentity {
  const model = turnModel ?? sessionModel;
  if (model === undefined || model === null)
    return {
      model: null,
      provider: null,
      reason: 'codex_rollout_model_missing',
    };
  if (typeof model !== 'string' || !SAFE_MODEL_ID_PATTERN.test(model))
    return {
      model: null,
      provider: null,
      reason: 'codex_rollout_model_invalid',
    };
  if (
    provider !== undefined &&
    provider !== null &&
    (typeof provider !== 'string' || !isSafeCodexProviderId(provider))
  )
    return { model, provider: null, reason: 'codex_rollout_provider_invalid' };
  return { model, provider: provider ?? null, reason: null };
}

function appendBoundedPiece(
  state: { pending: string; skipping: boolean },
  piece: string,
): void {
  if (state.skipping) return;
  if (state.pending.length + piece.length > 8 * 1024 * 1024) {
    state.pending = '';
    state.skipping = true;
  } else {
    state.pending += piece;
  }
}

async function* boundedRolloutLines(
  file: string,
): AsyncGenerator<{ line: string; complete: boolean }> {
  const state = { pending: '', skipping: false };
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf('\n', start);
      const piece = chunk.slice(start, end === -1 ? undefined : end);
      appendBoundedPiece(state, piece);
      if (end === -1) break;
      if (!state.skipping) yield { line: state.pending, complete: true };
      state.pending = '';
      state.skipping = false;
      start = end + 1;
    }
  }
  // A failed Codex run may leave its final JSONL record unfinished.
  if (state.pending.trim() && !state.skipping)
    yield { line: state.pending, complete: false };
}

async function parseRollout(file: string): Promise<CodexObservedIdentity> {
  let turnModel: unknown;
  let sessionModel: unknown;
  let provider: unknown;
  const processLine = (line: string) => {
    if (!line.trim()) return;
    const record = JSON.parse(line);
    if (record?.type === 'session_meta') {
      sessionModel = record.payload?.model;
      provider = record.payload?.model_provider;
    } else if (record?.type === 'turn_context') {
      turnModel = record.payload?.model;
    }
  };
  for await (const { line, complete } of boundedRolloutLines(file)) {
    if (complete) {
      processLine(line);
      continue;
    }
    try {
      processLine(line);
    } catch {
      // Complete records before the unfinished final line remain evidence.
    }
  }
  return validateRolloutIdentity(turnModel, sessionModel, provider);
}

export async function readCodexObservedIdentity({
  threadId,
  env = process.env,
  cwd = process.cwd(),
}: {
  threadId: string | null;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): Promise<CodexObservedIdentity> {
  if (!(threadId && SAFE_THREAD_ID.test(threadId)))
    return { model: null, provider: null, reason: 'codex_thread_id_missing' };
  try {
    const file = await findRollout(
      path.join(resolveCodexHome(env, cwd), 'sessions'),
      threadId,
    );
    if (!file)
      return { model: null, provider: null, reason: 'codex_rollout_not_found' };
    return await parseRollout(file);
  } catch (error) {
    return {
      model: null,
      provider: null,
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'codex_rollout_not_found'
          : 'codex_rollout_unreadable',
    };
  }
}

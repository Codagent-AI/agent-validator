import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import packageJson from '../../package.json' with { type: 'json' };
import type { LoadedConfig } from '../config/types.js';
import type { ValidatorStatus } from '../types/validator-status.js';
import {
  getCurrentCommit,
  hasWorkingTreeChanges,
  readExecutionState,
} from './execution-state.js';

export type TrustRecordSource =
  | 'validated'
  | 'manual-skip'
  | 'ledger-reconciled';

export interface ScopeDescriptor {
  command: 'run' | 'check' | 'review' | 'skip';
  gates: string[];
  entry_points: string[];
  cli_overrides: Record<string, unknown>;
}

export interface TrustRecord {
  commit: string | null;
  tree: string;
  config_hash: string;
  scope: ScopeDescriptor;
  scope_hash: string;
  validator_version: string;
  source: TrustRecordSource;
  status: string;
  trusted: boolean;
  created_at: string;
  working_tree_ref?: string;
}

export interface TrustLookupResult {
  trusted: boolean;
  matchType: 'commit' | 'tree' | null;
  record?: TrustRecord;
}

interface GitResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
    });
    child.on('close', (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', reject);
  });
}

async function gitStdout(args: string[]): Promise<string> {
  const result = await runGit(args);
  if (result.code === 0) return result.stdout;
  const detail = result.stderr ? `: ${result.stderr}` : '';
  throw new Error(
    `git ${args.join(' ')} failed with code ${result.code}${detail}`,
  );
}

export async function getLedgerPath(): Promise<string> {
  const commonDir = await gitStdout(['rev-parse', '--git-common-dir']);
  return path.join(commonDir, 'agent-validator', 'trusted-snapshots.jsonl');
}

export async function appendRecord(record: TrustRecord): Promise<void> {
  try {
    const ledgerPath = await getLedgerPath();
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    const handle = await fs.open(ledgerPath, 'a');
    try {
      await handle.write(`${JSON.stringify(record)}\n`);
    } finally {
      await handle.close();
    }
  } catch (error) {
    console.error(
      `validator: failed to append trust ledger record: ${(error as Error).message}`,
    );
  }
}

function isTrustRecord(value: unknown): value is TrustRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (typeof record.commit === 'string' || record.commit === null) &&
    typeof record.tree === 'string' &&
    typeof record.config_hash === 'string' &&
    typeof record.scope_hash === 'string' &&
    typeof record.validator_version === 'string' &&
    typeof record.source === 'string' &&
    typeof record.status === 'string' &&
    typeof record.trusted === 'boolean' &&
    typeof record.created_at === 'string'
  );
}

export async function readRecords(): Promise<TrustRecord[]> {
  try {
    const ledgerPath = await getLedgerPath();
    const content = await fs.readFile(ledgerPath, 'utf-8');
    const records: TrustRecord[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isTrustRecord(parsed)) records.push(parsed);
      } catch {
        // Corrupt lines are ignored; later valid records remain usable.
      }
    }
    return records;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    return [];
  }
}

export async function isTrusted(
  commit: string,
  tree: string,
): Promise<TrustLookupResult> {
  const records = await readRecords();
  const commitMatch = records.find(
    (record) => record.trusted && record.commit === commit,
  );
  if (commitMatch) {
    return { trusted: true, matchType: 'commit', record: commitMatch };
  }

  const dirty = await hasWorkingTreeChanges();
  if (dirty) {
    return { trusted: false, matchType: null };
  }

  const treeMatch = records.find(
    (record) => record.trusted && record.tree === tree,
  );
  if (treeMatch) {
    return { trusted: true, matchType: 'tree', record: treeMatch };
  }

  return { trusted: false, matchType: null };
}

export async function computeTreeSha(ref: string): Promise<string> {
  return gitStdout(['rev-parse', `${ref}^{tree}`]);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, stable(object[key])]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function gateAffectingConfig(config: LoadedConfig): unknown {
  return {
    entry_points: config.project.entry_points,
    base_branch: config.project.base_branch,
    cli: config.project.cli,
  };
}

function scopeFor(
  config: LoadedConfig,
  command: ScopeDescriptor['command'],
  options: { gate?: string; enableReviews?: Set<string> } = {},
): ScopeDescriptor {
  const cli_overrides: Record<string, unknown> = {};
  if (options.gate) cli_overrides.gate = options.gate;
  const enableReviews = options.enableReviews;
  if (enableReviews && enableReviews.size > 0) {
    cli_overrides.review = Array.from(enableReviews).sort();
  }

  const gateNames = [
    ...Object.keys(config.checks ?? {}).map((name) => `check:${name}`),
    ...Object.keys(config.reviews ?? {}).map((name) => `review:${name}`),
  ].sort();

  return {
    command,
    gates: options.gate ? [options.gate] : gateNames,
    entry_points: (config.project.entry_points ?? [])
      .map((entry) => entry.path)
      .sort(),
    cli_overrides,
  };
}

export function buildTrustRecord(args: {
  config: LoadedConfig;
  command: ScopeDescriptor['command'];
  source: TrustRecordSource;
  status: string;
  trusted: boolean;
  commit: string | null;
  tree: string;
  workingTreeRef?: string;
  options?: { gate?: string; enableReviews?: Set<string> };
}): TrustRecord {
  const scope = scopeFor(args.config, args.command, args.options);
  const record: TrustRecord = {
    commit: args.commit,
    tree: args.tree,
    config_hash: hash(gateAffectingConfig(args.config)),
    scope,
    scope_hash: hash(scope),
    validator_version: packageJson.version,
    source: args.source,
    status: args.status,
    trusted: args.trusted,
    created_at: new Date().toISOString(),
  };
  if (args.workingTreeRef) record.working_tree_ref = args.workingTreeRef;
  return record;
}

function isTrustEligibleStatus(status: ValidatorStatus | 'skipped'): boolean {
  return (
    status === 'passed' ||
    status === 'passed_with_warnings' ||
    status === 'no_applicable_gates' ||
    status === 'skipped'
  );
}

function shouldMarkTrusted(
  command: ScopeDescriptor['command'],
  options: { gate?: string; enableReviews?: Set<string> } = {},
): boolean {
  if (command === 'review') return false;
  if (options.gate) return false;
  if ((options.enableReviews?.size ?? 0) > 0) return false;
  return true;
}

export async function appendCurrentTrustRecord(args: {
  config: LoadedConfig;
  logDir: string;
  command: ScopeDescriptor['command'];
  status: ValidatorStatus | 'skipped';
  source: TrustRecordSource;
  options?: { gate?: string; enableReviews?: Set<string> };
  trusted?: boolean;
}): Promise<void> {
  try {
    if (!isTrustEligibleStatus(args.status)) return;

    const state = await readExecutionState(args.logDir);
    const dirty = await hasWorkingTreeChanges();
    const trusted =
      args.trusted ?? shouldMarkTrusted(args.command, args.options ?? {});

    let commit: string | null;
    let tree: string;
    let workingTreeRef: string | undefined;
    if (dirty) {
      if (!state?.working_tree_ref) return;
      commit = null;
      workingTreeRef = state.working_tree_ref;
      tree = await computeTreeSha(workingTreeRef);
    } else {
      commit = await getCurrentCommit();
      tree = await computeTreeSha('HEAD');
    }

    await appendRecord(
      buildTrustRecord({
        config: args.config,
        command: args.command,
        source: args.source,
        status: args.status,
        trusted,
        commit,
        tree,
        workingTreeRef,
        options: args.options,
      }),
    );
  } catch (error) {
    console.error(
      `validator: failed to write trust ledger record: ${(error as Error).message}`,
    );
  }
}

async function lineCount(file: string): Promise<number> {
  try {
    const content = await fs.readFile(file, 'utf-8');
    if (!content) return 0;
    return content.endsWith('\n')
      ? content.split('\n').length - 1
      : content.split('\n').length;
  } catch {
    return 0;
  }
}

async function reachableCommits(): Promise<Set<string>> {
  const stdout = await gitStdout(['rev-list', '--all']).catch(() => '');
  return new Set(stdout.split('\n').filter(Boolean));
}

async function gitObjectExists(ref: string | undefined): Promise<boolean> {
  if (!ref) return false;
  const result = await runGit(['cat-file', '-t', ref]);
  return result.code === 0;
}

export async function pruneIfNeeded(threshold: number): Promise<void> {
  const ledgerPath = await getLedgerPath();
  if ((await lineCount(ledgerPath)) <= threshold) return;

  const [records, reachable] = await Promise.all([
    readRecords(),
    reachableCommits(),
  ]);
  const survivors: TrustRecord[] = [];
  for (const record of records) {
    if (record.commit) {
      if (reachable.has(record.commit)) survivors.push(record);
      continue;
    }
    if (await gitObjectExists(record.working_tree_ref)) {
      survivors.push(record);
    }
  }

  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const tempPath = `${ledgerPath}.${process.pid}.tmp`;
  await fs.writeFile(
    tempPath,
    survivors.map((record) => JSON.stringify(record)).join('\n') +
      (survivors.length > 0 ? '\n' : ''),
    'utf-8',
  );
  await fs.rename(tempPath, ledgerPath);
}

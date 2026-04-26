import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { generateReport } from '../output/report.js';
import type { RunResult } from '../types/validator-status.js';
import {
  getCurrentCommit,
  hasWorkingTreeChanges,
  writeExecutionState,
} from '../utils/execution-state.js';
import {
  appendRecord,
  buildTrustRecord,
  computeTreeSha,
  isTrusted,
  type ScopeDescriptor,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import type { ChangeOptions, LoadedConfig } from './run-executor-helpers.js';

const TRUSTED_MESSAGE = 'Trusted snapshot; baseline advanced.';

export interface ReconciliationTrusted {
  kind: 'trusted';
  result: RunResult;
}

export interface ReconciliationContinue {
  kind: 'continue';
  changeOptions?: ChangeOptions;
  trustSourceOnPass?: TrustRecordSource;
}

export type ReconciliationResult =
  | ReconciliationTrusted
  | ReconciliationContinue;

interface ReconcileArgs {
  command: ScopeDescriptor['command'];
  config: LoadedConfig;
  logDir: string;
  report?: boolean;
  options?: { gate?: string; enableReviews?: Set<string> };
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
  throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

async function trustedResult(
  args: ReconcileArgs,
): Promise<ReconciliationTrusted> {
  await writeExecutionState(args.logDir);
  const result: RunResult = {
    status: 'trusted',
    message: TRUSTED_MESSAGE,
    gatesRun: 0,
  };
  if (args.report) {
    result.reportText = await generateReport('trusted', undefined, args.logDir);
  }
  return { kind: 'trusted', result };
}

async function appendReconciledRecord(
  args: ReconcileArgs & {
    commit: string;
    tree: string;
  },
): Promise<void> {
  await appendRecord(
    buildTrustRecord({
      config: args.config,
      command: args.command,
      source: 'ledger-reconciled',
      status: 'trusted',
      trusted: true,
      commit: args.commit,
      tree: args.tree,
      options: args.options,
    }),
  );
}

async function getParents(commit: string): Promise<string[]> {
  const line = await gitStdout(['rev-list', '--parents', '-n', '1', commit]);
  return line.split(/\s+/).slice(1);
}

async function parentTrusted(parent: string): Promise<boolean> {
  const tree = await computeTreeSha(parent);
  return (await isTrusted(parent, tree)).trusted;
}

async function mergeTree(
  parent1: string,
  parent2: string,
): Promise<string | null> {
  const result = await runGit(['merge-tree', '--write-tree', parent1, parent2]);
  const match = result.stdout.match(/\b[0-9a-f]{40}\b/);
  return match?.[0] ?? null;
}

async function diffNames(baseTree: string): Promise<string[]> {
  const stdout = await gitStdout(['diff', '--name-only', baseTree, 'HEAD']);
  return stdout.split('\n').filter(Boolean);
}

export async function reconcileStartup(
  args: ReconcileArgs,
): Promise<ReconciliationResult> {
  if (await hasWorkingTreeChanges()) {
    return { kind: 'continue' };
  }

  const head = await getCurrentCommit();
  const headTree = await computeTreeSha('HEAD');
  const trust = await isTrusted(head, headTree);

  if (trust.trusted) {
    if (trust.matchType === 'tree' && trust.record?.commit !== head) {
      await appendReconciledRecord({ ...args, commit: head, tree: headTree });
    }
    return trustedResult(args);
  }

  const parents = await getParents(head);
  if (parents.length !== 2) {
    return { kind: 'continue' };
  }

  const [parent1, parent2] = parents as [string, string];
  const [parent1Trusted, parent2Trusted] = await Promise.all([
    parentTrusted(parent1),
    parentTrusted(parent2),
  ]);

  if (!(parent1Trusted || parent2Trusted)) {
    return { kind: 'continue' };
  }

  if (parent1Trusted !== parent2Trusted) {
    return {
      kind: 'continue',
      changeOptions: { fixBase: parent1Trusted ? parent1 : parent2 },
    };
  }

  const syntheticTree = await mergeTree(parent1, parent2);
  if (!syntheticTree) {
    return { kind: 'continue' };
  }

  const delta = await diffNames(syntheticTree);
  if (delta.length === 0) {
    await appendReconciledRecord({ ...args, commit: head, tree: headTree });
    return trustedResult(args);
  }

  return {
    kind: 'continue',
    changeOptions: { fixBase: syntheticTree },
    trustSourceOnPass: 'ledger-reconciled',
  };
}

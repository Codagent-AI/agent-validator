import { getCategoryLogger } from '../output/app-logger.js';
import { generateReport } from '../output/report.js';
import type { RunResult } from '../types/validator-status.js';
import {
  getCurrentCommit,
  hasWorkingTreeChanges,
  writeExecutionState,
} from '../utils/execution-state.js';
import { gitStdout, runGit } from '../utils/git.js';
import {
  appendRecord,
  buildTrustRecord,
  computeSnapshotTreeSha,
  computeTreeSha,
  findCommittedSnapshotBase,
  isTrusted,
  type ScopeDescriptor,
  type TrustRecordSource,
} from '../utils/trust-ledger.js';
import type { ChangeOptions, LoadedConfig } from './run-executor-helpers.js';
import { TRUSTED_SNAPSHOT_MESSAGE } from './trusted-message.js';

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

export type DetectReconciliationResult =
  | { kind: 'trusted' }
  | ReconciliationContinue;

type ReconciliationAnalysis =
  | {
      kind: 'trusted';
      materialize?: {
        commit: string;
        tree: string;
      };
    }
  | ReconciliationContinue;

interface ReconcileArgs {
  command: ScopeDescriptor['command'];
  config: LoadedConfig;
  logDir: string;
  report?: boolean;
  options?: { gate?: string; enableReviews?: Set<string> };
}

async function trustedResult(
  args: ReconcileArgs,
): Promise<ReconciliationTrusted> {
  await writeExecutionState(args.logDir);
  const result: RunResult = {
    status: 'trusted',
    message: TRUSTED_SNAPSHOT_MESSAGE,
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

async function trustedParentBaseline(parent: string): Promise<string | null> {
  const tree = await computeTreeSha(parent);
  if ((await isTrusted(parent, tree)).trusted) return parent;

  const snapshot = await findCommittedSnapshotBase(tree);
  if (!snapshot) return null;

  // Keep the validated untracked files in the merge baseline, so their omission
  // remains a validation delta. Attach the full snapshot to this parent to
  // preserve merge ancestry without moving any branch or worktree state.
  try {
    const snapshotTree = await computeSnapshotTreeSha(snapshot);
    return await gitStdout(
      [
        'commit-tree',
        snapshotTree,
        '-p',
        parent,
        '-m',
        'Validator merge baseline',
      ],
      {
        env: {
          GIT_AUTHOR_NAME: 'Agent Validator',
          GIT_AUTHOR_EMAIL: 'validator@localhost',
          GIT_COMMITTER_NAME: 'Agent Validator',
          GIT_COMMITTER_EMAIL: 'validator@localhost',
          GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
        },
      },
    );
  } catch (error) {
    getCategoryLogger('run').debug(
      `Cannot materialize merge snapshot ${snapshot}; falling back to validation: ${String(error)}`,
    );
    return null;
  }
}

async function mergeTree(
  parent1: string,
  parent2: string,
): Promise<string | null> {
  const result = await runGit(['merge-tree', '--write-tree', parent1, parent2]);
  return parseMergeTreeOid(result.stdout);
}

function parseMergeTreeOid(stdout: string): string | null {
  const firstLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const directMatch = firstLine.match(/^[0-9a-f]{40,64}$/);
  if (directMatch) return directMatch[0];

  const labeledMatch = firstLine.match(/^merged tree:\s*([0-9a-f]{40,64})$/i);
  return labeledMatch?.[1] ?? null;
}

async function diffNames(baseTree: string): Promise<string[]> {
  const stdout = await gitStdout(['diff', '--name-only', baseTree, 'HEAD']);
  return stdout.split('\n').filter(Boolean);
}

function isUnbornHeadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ambiguous argument 'HEAD'") &&
    message.includes('unknown revision or path not in the working tree')
  );
}

async function readHeadSnapshotIfAvailable(): Promise<{
  head: string;
  headTree: string;
} | null> {
  try {
    return {
      head: await getCurrentCommit(),
      headTree: await computeTreeSha('HEAD'),
    };
  } catch (error) {
    if (isUnbornHeadError(error)) return null;
    throw error;
  }
}

async function analyzeDirtyWorktree(): Promise<ReconciliationContinue> {
  const snapshot = await readHeadSnapshotIfAvailable();
  if (!snapshot) {
    return { kind: 'continue' };
  }
  const trust = await isTrusted(snapshot.head, snapshot.headTree, {
    allowDirtyTree: true,
  });
  if (trust.trusted) {
    return { kind: 'continue', changeOptions: { fixBase: snapshot.head } };
  }
  return committedSnapshotChanges(snapshot.headTree);
}

async function committedSnapshotChanges(
  headTree: string,
): Promise<ReconciliationContinue> {
  const fixBase = await findCommittedSnapshotBase(headTree);
  return {
    kind: 'continue',
    ...(fixBase ? { changeOptions: { fixBase } } : {}),
  };
}

async function analyzeReconciliation(): Promise<ReconciliationAnalysis> {
  if (await hasWorkingTreeChanges()) {
    return analyzeDirtyWorktree();
  }

  const head = await getCurrentCommit();
  const headTree = await computeTreeSha('HEAD');
  const trust = await isTrusted(head, headTree);

  if (trust.trusted) {
    if (trust.matchType === 'tree' && trust.record?.commit !== head) {
      return {
        kind: 'trusted',
        materialize: { commit: head, tree: headTree },
      };
    }
    return { kind: 'trusted' };
  }

  const snapshotChanges = await committedSnapshotChanges(headTree);
  if (snapshotChanges.changeOptions) return snapshotChanges;

  const parents = await getParents(head);
  if (parents.length !== 2) {
    return { kind: 'continue' };
  }

  const [parent1, parent2] = parents as [string, string];
  const [baseline1, baseline2] = await Promise.all([
    trustedParentBaseline(parent1),
    trustedParentBaseline(parent2),
  ]);

  if (!(baseline1 || baseline2)) {
    return { kind: 'continue' };
  }

  if (!(baseline1 && baseline2)) {
    return {
      kind: 'continue',
      changeOptions: { fixBase: (baseline1 ?? baseline2) as string },
    };
  }

  const syntheticTree = await mergeTree(baseline1, baseline2);
  if (!syntheticTree) {
    return { kind: 'continue' };
  }

  const delta = await diffNames(syntheticTree);
  if (delta.length === 0) {
    return {
      kind: 'trusted',
      materialize: { commit: head, tree: headTree },
    };
  }

  return {
    kind: 'continue',
    changeOptions: { fixBase: syntheticTree },
    trustSourceOnPass: 'ledger-reconciled',
  };
}

export async function reconcileDetect(): Promise<DetectReconciliationResult> {
  const analysis = await analyzeReconciliation();
  if (analysis.kind === 'trusted') {
    return { kind: 'trusted' };
  }
  return analysis;
}

export async function reconcileStartup(
  args: ReconcileArgs,
): Promise<ReconciliationResult> {
  const analysis = await analyzeReconciliation();
  if (analysis.kind === 'trusted') {
    if (analysis.materialize) {
      await appendReconciledRecord({
        ...args,
        commit: analysis.materialize.commit,
        tree: analysis.materialize.tree,
      });
    }
    return trustedResult(args);
  }
  return analysis;
}

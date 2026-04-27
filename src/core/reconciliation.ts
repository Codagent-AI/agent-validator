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
  computeTreeSha,
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

async function parentTrusted(parent: string): Promise<boolean> {
  const tree = await computeTreeSha(parent);
  return (await isTrusted(parent, tree)).trusted;
}

async function mergeTree(
  parent1: string,
  parent2: string,
): Promise<string | null> {
  const result = await runGit(['merge-tree', '--write-tree', parent1, parent2]);
  const match = result.stdout.match(/\b[0-9a-f]{40,64}\b/);
  return match?.[0] ?? null;
}

async function diffNames(baseTree: string): Promise<string[]> {
  const stdout = await gitStdout(['diff', '--name-only', baseTree, 'HEAD']);
  return stdout.split('\n').filter(Boolean);
}

async function analyzeReconciliation(): Promise<ReconciliationAnalysis> {
  if (await hasWorkingTreeChanges()) {
    return { kind: 'continue' };
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

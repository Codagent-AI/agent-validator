## Why

Agent-validator has no concept of "validation evidence." `.execution_state` records *where to diff from* on the next run, not *which commits have been validated*. As a result, every cross-worktree merge — the user's normal workflow with multiple worktrees — looks like a fresh wall of unvalidated changes, forcing full re-validation of code already validated in the source worktree. The existing manual `validator-merge` skill tries to paper over this but is opt-in, only handles one direction, and contains a real bug: it copies the source worktree's state file verbatim, so the destination's next run trips the `branch changed` auto-clean and discards the just-copied state anyway.

## What Changes

- **New trust ledger**, separate from `.execution_state`: an append-only JSONL file at `$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl`. Worktrees naturally share `.git/`, so trust propagates across worktrees without copying state files.
- **Trust semantics on writes.** A ledger record is written on any trust-eligible outcome (clean or dirty tree). Specifically:
  - Clean-tree full pass → trusted record with `commit: HEAD`, `tree: HEAD^{tree}`.
  - Dirty-tree full pass → trusted record with `commit: null`, `tree: working_tree_ref^{tree}` (recognized by tree match after commit).
  - Clean-tree partial pass (e.g. `--gate lint`) → record with `trusted: false` (narrowed scope, audit only).
  - Skip command → trusted record with `source: "manual-skip"` (human override, propagates through merges).
  - Failure, retry-limit-exceeded → no ledger write (`.execution_state` updates unchanged).
- **Reconciliation at validator startup**, running *before* the existing auto-clean. If current HEAD is trusted under the same config and scope, advance state and report no changes. If HEAD is a merge commit whose parents are trusted, use the synthetic merge tree to either promote HEAD or scope validation to the merge-resolution delta. If exactly one parent is trusted, scope re-validation to the unvalidated diff via `fixBase`. `detect` uses the same trust analysis in read-only mode so trusted snapshots appear as no changes without mutating state.
- **Periodic reachability-based pruning** of the ledger at startup: drop records whose commits aren't reachable from any local ref.
- **`validator-merge` skill removed entirely**: trust propagation is now automatic via the shared ledger. Users merge with `git merge` normally; the next validator invocation handles trust evaluation via reconciliation. The skill was buggy (branch-name mismatch on copied state) and is now vestigial.
- **BREAKING**: `validator-merge` skill is deleted. Backwards compatibility was explicitly waived.

The two persistence mechanisms remain orthogonal:

```
.execution_state         (per-worktree)   →  "where do I diff from?"
trusted-snapshots.jsonl (per-repo, .git/) →  "is this snapshot trusted without rerunning?"
```

## Capabilities

### New Capabilities
- `validation-trust-ledger`: schema and storage of trusted snapshots; write rules (when trust is recorded vs. withheld); lookup semantics (HEAD trust, merge parent trust, scope/config compatibility); reconciliation rules (HEAD short-circuit, merge auto-promotion, partial-trust narrowing); reachability-based pruning.

### Modified Capabilities
- `run-lifecycle`: a reconciliation step runs *before* auto-clean. When the ledger trusts current HEAD (or proves a merge commit derives from trusted parents with no conflict resolution), execution state is advanced without re-running gates, replacing the current "wipe and re-diff" behavior on merge.
- `validator-merge`: skill removed entirely. Trust propagation is now automatic via the shared ledger and startup reconciliation.
- `skip-command`: emits a trusted ledger record with `source: "manual-skip"`. Skip is a human override — trusted records from skip propagate through merges the same as validated records.

## Out of Scope

- **Cross-machine trust sharing** (pushing/pulling the ledger, CI-to-dev trust transfer). Trust is local to the machine that ran the validator. CI passing does not grant local trust.
- **Backwards compatibility** with the prior `validator-merge` skill behavior. Explicitly waived.
- **Trust for non-validation outcomes** (e.g. lint-only checks counted as full-run trust). Strict scoping via `scope_hash` prevents this; widening it is out of scope.
- **Migration of historical `.execution_state` files into the ledger.** The ledger starts empty; users earn trust by running the validator going forward.

## Impact

- **New code**: ledger module (append/read/prune); reconciliation step in the startup path; `config_hash` and `scope_hash` derivation utilities.
- **Modified code**:
  - `src/commands/shared.ts` — pre-clean reconciliation hook before `shouldAutoClean`.
  - `src/core/run-executor-helpers.ts:428` and `src/commands/gate-command.ts:312` — conditional ledger write alongside `writeExecutionState` (gated on clean tree + trusted outcome).
  - `skills/validator-merge/` — deleted entirely; remove from plugin manifests.
- **New on-disk artifact**: `<git-common-dir>/agent-validator/trusted-snapshots.jsonl`.
- **No new package dependencies.**
- **No CLI changes** (beyond the removal of the `validator-merge` skill).

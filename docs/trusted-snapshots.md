---
title: Trusted Snapshots
group: Operations
order: 2
description: How trusted validation snapshots propagate across worktrees.
---

# Trusted Snapshots

Agent Validator can recognize validation work that already happened in another
git worktree. This avoids rerunning the full validation suite after common flows
like validating a feature worktree, committing it, and merging it into another
worktree.

## What Gets Tracked

Agent Validator keeps two separate pieces of state:

- `.execution_state` in the configured `log_dir`: the local worktree baseline
  used to decide where the next diff starts.
- `trusted-snapshots.jsonl` under `$(git rev-parse --git-common-dir)/agent-validator/`:
  a shared ledger of snapshots that were explicitly trusted.

Linked worktrees share the same git common directory, so the trust ledger is
visible from every worktree for the repository. The ledger is append-only during
normal operation and is pruned periodically when it grows past the default line
threshold.

## How Snapshots Become Trusted

A snapshot is trusted when Agent Validator records that the current code state
was accepted. Records are written after:

- `agent-validate run` passes, passes with warnings, or has no applicable gates.
- `agent-validate check` passes, passes with warnings, or has no applicable gates.
- `agent-validate skip` is run as an explicit human override.

Partial invocations such as `agent-validate run --gate lint` still write audit
records, but those records are not trusted for propagation. Failures and retry
limit exits do not write trusted records.

Clean worktrees write records keyed by the current commit and tree. Dirty
worktrees write records keyed by a full snapshot tree derived from
`working_tree_ref` with `commit: null`. For stash refs, that snapshot includes
tracked changes from the stash main tree and untracked files from the stash
`^3` parent. This supports the common flow:

1. Make changes in a dirty worktree.
2. Run `agent-validate run` and pass.
3. Commit the same content.
4. Run Agent Validator again in any linked worktree.

The later run compares `HEAD^{tree}` to trusted tree records and can recognize
that the committed content was already validated.

## Reconciliation

At the start of `run`, `check`, and `review`, Agent Validator performs
reconciliation before auto-clean and before creating gate logs. If the current
clean `HEAD` is trusted by commit or tree, Agent Validator:

1. Advances the local `.execution_state` baseline to the current branch and
   commit.
2. Exits with status `trusted`.
3. Returns exit code `0` without running gates or incrementing the run count.

If a validated dirty snapshot was committed while some validated untracked files
were left out, reconciliation can reuse the original snapshot as a diff baseline.
All committed content must match the validated snapshot, including file modes;
only files from the snapshot's untracked-files parent may be omitted. The omitted
files are reported as changes and validated, without repeating the entire branch
diff. This also works in a linked worktree with no local `.execution_state`.
The snapshot must still exist in Git, and its ledger record must be trusted.

Dirty worktrees can use a trusted HEAD or an applicable committed snapshot as a
baseline. An existing local dirty execution-state snapshot takes precedence.

`agent-validate detect` uses the same trust lookup in read-only mode. If the
current clean `HEAD` is trusted, `detect` reports no changes without rewriting
`.execution_state` or appending ledger records.

If the worktree is still dirty after a successful run or skip, `detect` preserves
`.execution_state.working_tree_ref` as the baseline
and compares the current worktree to that full snapshot, including untracked
files captured by the stash. If nothing changed since the validated dirty
snapshot, `detect` reports no changes before you commit.

## Merge Behavior

For a two-parent merge commit, reconciliation checks whether the parents are
trusted:

- If both parents are trusted, Agent Validator computes a synthetic merge tree
  with `git merge-tree --write-tree <parent1> <parent2>`.
- If the synthetic tree matches `HEAD`, the merge commit is trusted immediately.
- If the synthetic tree differs from `HEAD`, validation is scoped to the
  merge-resolution delta by using the synthetic tree as `fixBase`.
- If exactly one parent is trusted, validation is scoped from the trusted parent.
- Octopus merges are not auto-promoted; they fall back to normal validation.

This catches manual merge-resolution changes without revalidating both trusted
parents.

## Inspecting and Resetting

The ledger lives outside the worktree:

```bash
git rev-parse --git-common-dir
```

Then inspect:

```bash
cat "$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl"
```

To disable the feature for a repository or force normal validation, remove the
ledger file:

```bash
rm "$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl"
```

Existing `.execution_state` files are unchanged by deleting the ledger.

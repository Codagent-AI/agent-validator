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
normal operation and is pruned periodically when it grows past the configured
line threshold.

## How Snapshots Become Trusted

A snapshot is trusted when Agent Validator records that the current code state
was accepted. Records are written after:

- `agent-validator run` passes, passes with warnings, or has no applicable gates.
- `agent-validator check` passes, passes with warnings, or has no applicable gates.
- `agent-validator skip` is run as an explicit human override.

Partial invocations such as `agent-validator run --gate lint` still write audit
records, but those records are not trusted for propagation. Failures and retry
limit exits do not write trusted records.

Clean worktrees write records keyed by the current commit and tree. Dirty
worktrees write records keyed by a full snapshot tree derived from
`working_tree_ref` with `commit: null`. For stash refs, that snapshot includes
tracked changes from the stash main tree and untracked files from the stash
`^3` parent. This supports the common flow:

1. Make changes in a dirty worktree.
2. Run `agent-validator run` and pass.
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

Dirty worktrees skip reconciliation and use the normal execution-state and
auto-clean flow.

`agent-validator detect` uses the same trust lookup in read-only mode. If the
current clean `HEAD` is trusted, `detect` reports no changes without rewriting
`.execution_state` or appending ledger records.

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

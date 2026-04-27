# Task: Startup reconciliation, trusted status, and validator-merge removal

## Goal

Wire up the trust ledger to the validator's run flow so that trusted commits short-circuit validation, merge commits are auto-promoted or scoped, and the now-vestigial `validator-merge` skill is removed. After this task, the entire trust propagation system is live: validate in one worktree, merge elsewhere, and the validator recognizes the trusted state automatically.

## Background

The trust ledger module (`src/utils/trust-ledger.ts`) already exists from the prior task. It can append records, read them, query trust via `isTrusted()`, and prune. This task adds startup reconciliation — the logic that runs at the beginning of every `run`, `check`, and `review` command to check the ledger and decide whether to short-circuit, scope, or proceed normally.

### Reconciliation insertion point

The current run flow in `executeRun()` (`src/core/run-executor.ts`) is:

```
loadConfig → initContext → handleAutoClean → acquireLock → runWithLock(logger.init → gates)
```

Reconciliation inserts **after lock acquisition, before `runWithLock()` is called**. If it short-circuits, it rewrites `.execution_state`, prints the message, releases the lock, and returns — the logger is never initialized and no gate logs are created.

**Before reconciliation**, call `pruneIfNeeded(1000)` from the trust-ledger module to prune the ledger if it exceeds 1000 lines. The startup sequence within the lock is: prune → reconcile → (if not short-circuited) runWithLock.

The same pattern applies to `executeGateCommand()` in `src/commands/gate-command.ts` which handles `check` and `review` commands.

Reconciliation is skipped entirely if the working tree is dirty (`git status --porcelain` non-empty). In that case, existing auto-clean proceeds unchanged — including branch-mismatch auto-clean, which fires regardless of dirty state.

### Reconciliation logic (clean tree)

```
1. Compute HEAD commit SHA and HEAD^{tree}
2. Check isTrusted(HEAD, HEAD^{tree})
   → If trusted: advance state, exit with status "trusted"
   → If trusted via tree match: materialize a commit record (source: "ledger-reconciled"),
     then advance state and exit "trusted"
3. Check if HEAD is a 2-parent merge commit (git rev-parse HEAD^2)
   → If not a merge (or >2 parents): proceed with normal validation
4. Check if both parents are trusted
   → If neither: proceed with normal validation
   → If exactly one: set fixBase to the trusted parent's commit,
     validate HEAD against the trusted parent
   → If both: proceed to unified merge path (step 5)
5. Unified merge path:
   a. git merge-tree --write-tree parent1 parent2  → synthetic merge tree SHA
   b. git diff --name-only <synthetic-tree> HEAD    → merge-resolution delta
   c. If delta is empty: auto-trust HEAD, write ledger record, exit "trusted"
   d. If delta is non-empty: set fixBase = <synthetic-tree>,
      validate only the merge-resolution delta
   e. If that scoped validation passes: write trusted record for HEAD
```

### Unified merge path: implementation notes

The diff between `git merge-tree --write-tree` output and `HEAD^{tree}` is the **merge-resolution delta**. This delta may include conflict marker resolutions, rename choices, or other merge machinery artifacts. Treat it as the validation scope.

**`git merge-tree --write-tree` behavior**: This command may exit non-zero when conflicts exist but still prints a valid tree SHA as the first line of stdout. The implementation MUST parse the tree SHA from stdout regardless of exit code. If no valid tree SHA can be parsed, fall back to normal full validation.

**Git version requirement**: `git merge-tree --write-tree` requires git 2.38+. On older git, fall back to "validate the full merge normally" — do not fail. Catch the error on first use or check version.

### Trusted exit status

Add `'trusted'` to the `ValidatorStatus` union type in `src/types/validator-status.ts`. It is a success status (exit code 0).

**Key files for status integration:**
- `src/types/validator-status.ts` — add `| 'trusted'` to the union, add to `isSuccessStatus()`
- `src/output/console.ts` — `ConsoleReporter.printSummary()` and `computeOverallStatus()` — handle the trusted status display
- `src/output/report.ts` — `statusLineText()` — add mapping for `'trusted'` → `"Trusted"`
- `src/commands/run.ts` — the exit code mapping in the run command handler uses `isSuccessStatus()`, so adding `trusted` there handles it

When reconciliation short-circuits:
- No gates are executed
- No gate log files are created
- No console log file is created
- The run count is NOT incremented
- If `--report` is used, structured output includes the status
- The message includes "Trusted snapshot; baseline advanced." and a GitHub link to the trusted snapshots documentation.

### Auto-clean interaction

Reconciliation runs BEFORE `shouldAutoClean()` (in `src/commands/shared.ts`). If reconciliation advances `.execution_state` (because HEAD is trusted), auto-clean SHALL NOT run. The scenarios for auto-clean on branch change and commit merged now carry the precondition "ledger reconciliation did NOT short-circuit."

### Validator-merge skill removal

Delete the entire `skills/validator-merge/` directory. Remove any references from:
- `.claude-plugin/plugin.json` (if validator-merge is registered there)
- `.cursor-plugin/plugin.json` (if registered there)
- `docs/skills-guide.md` (lines ~16 and ~135-148 document the merge skill)
- Any other plugin manifests or SKILL.md files that reference it

The shared ledger makes trust visible across worktrees automatically. Users merge with `git merge` normally and trust propagates on the next validator invocation.

## Spec

### Requirement: Startup Reconciliation
On every `run`, `check`, and `review` invocation, the system SHALL perform ledger reconciliation BEFORE the existing auto-clean step. If the working tree is dirty, reconciliation SHALL be skipped entirely and existing auto-clean proceeds unchanged (including branch-mismatch auto-clean, which fires regardless of dirty state). If the tree is clean, reconciliation SHALL check trust in the following order:

1. **HEAD already trusted** (by commit or tree match): rewrite `.execution_state` (branch=current, commit=HEAD, working_tree_ref=HEAD), exit with status `trusted` (exit code 0), and print a message that includes "Trusted snapshot; baseline advanced." plus a GitHub link to the trusted snapshots documentation. If trust was found via tree match (dirty-tree record with `commit: null`), a materialized commit record SHALL be appended with `source: "ledger-reconciled"`, `commit: HEAD`, `tree: HEAD^{tree}`.
2. **HEAD is a 2-parent merge, both parents trusted — unified merge path**: compute the synthetic automatic merge tree via `git merge-tree --write-tree parent1 parent2`, then diff it against HEAD's tree. If the diff is empty, auto-trust HEAD. If the diff is non-empty (merge-resolution delta), validate only the delta files with `fixBase` set to the synthetic merge tree. If scoped validation passes, write a trusted record for HEAD.
3. **HEAD is a 2-parent merge, exactly one parent trusted**: set `fixBase` to the trusted parent's commit. Validation SHALL diff HEAD against the trusted parent (capturing both the untrusted parent's changes and any merge resolution edits).
4. **HEAD has >2 parents**: no auto-promotion, validate normally.
5. **HEAD has 0 or 1 parents, not trusted**: proceed with normal validation.

#### Scenario: HEAD already trusted by commit
- **WHEN** reconciliation runs and HEAD has a trusted ledger record matching by commit
- **THEN** `.execution_state` SHALL be rewritten with branch=current, commit=HEAD, working_tree_ref=HEAD
- **AND** the validator SHALL exit with status `trusted` and exit code 0

#### Scenario: HEAD trusted by tree match (post-dirty-commit)
- **WHEN** reconciliation runs and HEAD has no commit-match record
- **AND** a trusted ledger record exists with `tree` matching `HEAD^{tree}`
- **THEN** a materialized record SHALL be appended with `source: "ledger-reconciled"`, `commit: HEAD`, `tree: HEAD^{tree}`, `trusted: true`
- **AND** `.execution_state` SHALL be rewritten with branch=current, commit=HEAD, working_tree_ref=HEAD
- **AND** the validator SHALL exit with status `trusted` and exit code 0

#### Scenario: Both merge parents trusted with no merge-resolution delta
- **WHEN** HEAD is a 2-parent merge commit
- **AND** both parents are trusted
- **AND** `git merge-tree --write-tree parent1 parent2` produces a tree equal to `HEAD^{tree}`
- **THEN** a trusted ledger record SHALL be appended for HEAD with `source: "ledger-reconciled"`
- **AND** `.execution_state` SHALL be advanced
- **AND** the validator SHALL exit with status `trusted`

#### Scenario: Both merge parents trusted with merge-resolution delta
- **WHEN** HEAD is a 2-parent merge commit
- **AND** both parents are trusted
- **AND** `git merge-tree --write-tree parent1 parent2` produces a tree that differs from `HEAD^{tree}`
- **THEN** `fixBase` SHALL be set to the synthetic merge tree
- **AND** validation SHALL run scoped to the merge-resolution delta files
- **AND** if validation passes, a trusted record SHALL be written for HEAD

#### Scenario: One merge parent trusted
- **WHEN** HEAD is a 2-parent merge commit
- **AND** exactly one parent is trusted
- **THEN** `fixBase` SHALL be set to the trusted parent's commit
- **AND** validation SHALL diff HEAD against the trusted parent
- **AND** validation SHALL proceed normally with the scoped diff

#### Scenario: Octopus merge
- **WHEN** HEAD is a merge commit with more than 2 parents
- **THEN** no auto-promotion SHALL occur
- **AND** the validator SHALL proceed with normal validation

#### Scenario: Normal commit not in ledger
- **WHEN** HEAD is a normal commit (0 or 1 parents)
- **AND** no trusted ledger record exists for HEAD (by commit or tree)
- **THEN** the validator SHALL proceed with normal validation

#### Scenario: Dirty tree skips reconciliation
- **WHEN** reconciliation is about to run
- **AND** `git status --porcelain` returns non-empty
- **THEN** reconciliation SHALL be skipped entirely
- **AND** existing auto-clean SHALL proceed unchanged (including branch-mismatch checks)

#### Scenario: Reconciliation runs before auto-clean
- **WHEN** a validator command starts
- **THEN** reconciliation SHALL execute before `shouldAutoClean`
- **AND** if reconciliation short-circuits, auto-clean SHALL NOT run

### Requirement: Trusted Exit Status
The validator SHALL support a `trusted` status for runs that short-circuit via ledger reconciliation. `trusted` SHALL be a success status (exit code 0). It SHALL NOT count as a gate run — no gates are executed, no gate logs are written, and no run count is incremented. Reconciliation SHALL run within the run lock (since it may mutate `.execution_state` and append ledger records) but BEFORE logger initialization and console log creation.

#### Scenario: Trusted status on reconciliation short-circuit
- **WHEN** ledger reconciliation determines HEAD is trusted
- **THEN** the validator SHALL exit with status `trusted` and exit code 0
- **AND** the message SHALL include "Trusted snapshot; baseline advanced."
- **AND** the message SHALL include a GitHub link to the trusted snapshots documentation

#### Scenario: Trusted is success-equivalent
- **WHEN** the validator exits with status `trusted`
- **THEN** the exit code SHALL be 0
- **AND** structured output (if `--report` is used) SHALL include the status

#### Scenario: Trusted does not create gate logs
- **WHEN** the validator exits with status `trusted`
- **THEN** no gate log files SHALL be created
- **AND** no console log file SHALL be created
- **AND** the run count SHALL NOT be incremented

#### Scenario: Reconciliation runs within lock before logger
- **WHEN** a validator command acquires the run lock
- **THEN** reconciliation SHALL execute before logger initialization
- **AND** if reconciliation short-circuits, logger SHALL NOT be initialized

### Requirement: Execution State Persistence Across Clean (modified)

Ledger reconciliation runs BEFORE auto-clean; if reconciliation advances execution state (because HEAD is trusted), auto-clean SHALL NOT run.

#### Scenario: Auto-clean resets execution state on branch change
- **GIVEN** `.execution_state` exists with `branch: "feature-a"`
- **AND** the current branch is "feature-b"
- **AND** ledger reconciliation did NOT short-circuit (HEAD is not trusted)
- **WHEN** auto-clean detects the branch change
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

#### Scenario: Auto-clean resets execution state on commit merged (clean tree)
- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **AND** `git status --porcelain` returns empty (no working tree changes)
- **AND** ledger reconciliation did NOT short-circuit
- **WHEN** auto-clean detects the merged commit
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

#### Scenario: Reconciliation preempts auto-clean
- **GIVEN** ledger reconciliation runs and finds HEAD is trusted
- **WHEN** reconciliation advances `.execution_state` to current branch/commit
- **THEN** auto-clean SHALL NOT run
- **AND** the validator SHALL exit with status `trusted`

### Requirement: Branch Merge with Execution State Propagation (REMOVED)
**Reason**: The shared trust ledger makes trust visible across all worktrees automatically. The `validator-merge` skill is vestigial — users merge with `git merge` normally and trust propagates on the next validator invocation via startup reconciliation.
**Migration**: Use `git merge` followed by any validator command.

### Requirement: Script-Driven Worktree Discovery and State Copy (REMOVED)
**Reason**: Worktree discovery for state-file copying is no longer needed. The shared ledger in `git-common-dir` makes trust visible across all worktrees without copying files.
**Migration**: Same as above.

## Done When

- Running `agent-validator run` on a commit that was previously validated exits with status `trusted` and exit code 0, without running any gates or creating logs.
- Validating on a dirty tree, committing, then running the validator recognizes the commit via tree match and exits `trusted`.
- Merging two trusted branches and running the validator auto-promotes the merge commit as trusted (when no merge-resolution delta exists).
- Merging two trusted branches with conflict resolution runs validation scoped to only the merge-resolution delta files.
- Merging where one parent is trusted scopes validation to the untrusted parent's diff.
- Dirty worktree skips reconciliation entirely and proceeds with normal auto-clean behavior.
- The `trusted` status appears correctly in CLI output, exit codes, and `--report` output.
- Reconciliation runs within the lock but before logger init — no logs on short-circuit.
- `skills/validator-merge/` directory is deleted and all plugin manifest / doc references are removed.
- Tests cover the above scenarios.

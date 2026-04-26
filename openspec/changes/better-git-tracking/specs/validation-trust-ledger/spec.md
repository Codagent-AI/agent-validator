## ADDED Requirements

### Requirement: Ledger Storage and Schema
The system SHALL maintain an append-only JSONL trust ledger at `$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl`. Each line SHALL be a JSON object with fields: `commit` (string or null), `tree`, `config_hash`, `scope` (structured descriptor), `scope_hash`, `validator_version`, `source`, `status`, `trusted` (boolean), `created_at`, and optionally `working_tree_ref` (present when validation ran on a dirty tree). The `trusted` field indicates whether this record constitutes an explicit approval of the content for trust propagation. The `commit` field SHALL be null when validation ran on a dirty tree (the validated content is identified by `tree` and `working_tree_ref`, not by a commit). The directory SHALL be created on first write if absent. Corrupt or unparseable lines SHALL be skipped during reads without failing the operation. Writes SHALL use `open("a")` append mode for concurrency safety; temp+rename SHALL be used only for pruning rewrites.

The `source` field SHALL be one of:
- `"validated"` — trust earned by running gates
- `"manual-skip"` — trust earned by explicit human override
- `"ledger-reconciled"` — trust materialized by reconciliation (e.g. tree match after commit, or merge auto-promotion)

#### Scenario: Ledger file location
- **WHEN** the system resolves the ledger path
- **THEN** it SHALL use `$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl`
- **AND** linked worktrees SHALL share the same ledger file via the common git directory

#### Scenario: First ledger write bootstraps directory
- **WHEN** the system writes the first ledger record
- **AND** the `agent-validator/` directory does not exist under git-common-dir
- **THEN** the system SHALL create the directory before writing

#### Scenario: Corrupt line tolerance
- **WHEN** the system reads the ledger
- **AND** one or more lines are unparseable JSON
- **THEN** those lines SHALL be skipped
- **AND** remaining valid lines SHALL be read normally
- **AND** the read SHALL NOT fail

#### Scenario: Concurrent append safety
- **WHEN** two worktrees complete validation simultaneously
- **THEN** each SHALL append its record using `open("a")` mode
- **AND** each single-line JSON write SHALL be atomic on POSIX systems
- **AND** neither record SHALL corrupt the other

### Requirement: Ledger Write Rules
On run completion, the system SHALL evaluate whether to write a trust record. The `trusted` field SHALL be `true` when the outcome represents an explicit approval: a trust-eligible command (`run`, `check`, or `skip`) invoked at default scope (no `--gate`/`--review` CLI narrowing) that completed with a trust-eligible outcome (`passed`, `passed_with_warnings`, or `no_applicable_gates`). Partial runs (`--gate` or `--review` CLI overrides) SHALL write records with `trusted: false`. Review-only runs SHALL write records with `trusted: false`. Failures and retry-limit-exceeded SHALL NOT write ledger records.

**Clean vs dirty tree behavior:**
- **Clean tree**: record SHALL have `commit` = HEAD SHA and `tree` = `HEAD^{tree}`.
- **Dirty tree**: record SHALL have `commit` = null, `tree` = tree of `working_tree_ref`, and `working_tree_ref` = stash SHA. This captures the exact validated content so it can be recognized by tree match after the user commits.

#### Scenario: Full run pass on clean tree
- **WHEN** `agent-validator run` completes with status `passed` on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "validated"`, `commit: HEAD`, `tree: HEAD^{tree}`

#### Scenario: Check pass on clean tree
- **WHEN** `agent-validator check` completes with status `passed` on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "validated"`, `commit: HEAD`, `tree: HEAD^{tree}`

#### Scenario: Full run pass on dirty tree
- **WHEN** `agent-validator run` completes with status `passed` on a dirty tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "validated"`, `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`

#### Scenario: Check pass on dirty tree
- **WHEN** `agent-validator check` completes with status `passed` on a dirty tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "validated"`, `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`

#### Scenario: Skip command on clean tree
- **WHEN** `agent-validator skip` is executed on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "manual-skip"`, `commit: HEAD`, `tree: HEAD^{tree}`

#### Scenario: Skip command on dirty tree
- **WHEN** `agent-validator skip` is executed on a dirty tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `source: "manual-skip"`, `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`

#### Scenario: Full run with warnings
- **WHEN** `agent-validator run` completes with status `passed_with_warnings` on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: true`, `status: "passed_with_warnings"`, `commit: HEAD`, `tree: HEAD^{tree}`

#### Scenario: No applicable gates on default invocation
- **WHEN** `agent-validator run` or `agent-validator check` completes with status `no_applicable_gates`
- **AND** no `--gate` or `--review` CLI narrowing was used
- **THEN** a ledger record SHALL be written with `trusted: true`, `status: "no_applicable_gates"`

#### Scenario: No applicable gates on partial invocation
- **WHEN** `agent-validator run --gate lint` completes with status `no_applicable_gates`
- **THEN** a ledger record SHALL be written with `trusted: false`

#### Scenario: Partial gate pass
- **WHEN** `agent-validator run --gate lint` completes with status `passed` on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: false`, narrowed scope

#### Scenario: Review-only pass
- **WHEN** `agent-validator review` completes with status `passed` on a clean tree
- **THEN** a ledger record SHALL be written with `trusted: false`

#### Scenario: Failure suppresses write
- **WHEN** any validator command completes with status `failed`, `error`, `lock_conflict`, or `retry_limit_exceeded`
- **THEN** NO ledger record SHALL be written

### Requirement: Ledger Trust Lookup
The system SHALL consider a commit trusted when a ledger record exists with `trusted: true` and matching either `commit` or `tree`:

- **Commit match** (checked first): record has `commit` = queried commit SHA.
- **Tree match** (checked second, only when worktree is clean): record has `tree` = queried commit's `HEAD^{tree}`. This handles the case where validation ran on a dirty tree (`commit: null`) and the user later committed the same content. Tree match SHALL only be used when the current worktree is clean (`git status --porcelain` is empty) — do not use tree-only trust while the worktree is dirty, as the dirty state may have diverged from the matched tree.

The `source`, `status`, `scope`, `scope_hash`, and `config_hash` fields are recorded for audit and observability but SHALL NOT be used in trust gating in v1. A future strict mode may activate `config_hash` matching to invalidate trust when the validator configuration changes.

**Note:** Because `check` and `skip` outcomes are trusted, reconciliation may short-circuit a subsequent `run` invocation that would otherwise include reviews. This is by design — "trusted" means "approved for propagation" regardless of which gates originally ran.

#### Scenario: Trusted by commit match
- **WHEN** a ledger record exists with `trusted: true` and `commit` matching the queried SHA
- **THEN** the commit SHALL be considered trusted

#### Scenario: Trusted by tree match (clean worktree only)
- **WHEN** no commit-match record exists
- **AND** a ledger record exists with `trusted: true` and `tree` matching `HEAD^{tree}`
- **AND** the current worktree is clean (`git status --porcelain` is empty)
- **THEN** the commit SHALL be considered trusted

#### Scenario: Tree match skipped when worktree is dirty
- **WHEN** no commit-match record exists
- **AND** a ledger record exists with `trusted: true` and `tree` matching `HEAD^{tree}`
- **AND** the current worktree is dirty (`git status --porcelain` is non-empty)
- **THEN** the commit SHALL NOT be considered trusted via tree match

#### Scenario: Non-trusted record
- **WHEN** a ledger record exists for the queried commit with `trusted: false`
- **THEN** the commit SHALL NOT be considered trusted

#### Scenario: No record
- **WHEN** no ledger record exists matching the queried commit or tree
- **THEN** the commit SHALL NOT be considered trusted

#### Scenario: Multiple records for same commit
- **WHEN** multiple ledger records exist for the same commit or tree
- **AND** at least one has `trusted: true`
- **THEN** the commit SHALL be considered trusted

#### Scenario: Config hash recorded but not gated in v1
- **WHEN** a trust lookup is performed
- **THEN** the `config_hash` field SHALL NOT be used in matching
- **AND** the `config_hash` field SHALL be preserved in records for future strict mode

### Requirement: Startup Reconciliation
On every `run`, `check`, and `review` invocation, the system SHALL perform ledger reconciliation BEFORE the existing auto-clean step. If the working tree is dirty, reconciliation SHALL be skipped entirely and existing auto-clean proceeds unchanged (including branch-mismatch auto-clean, which fires regardless of dirty state). If the tree is clean, reconciliation SHALL check trust in the following order:

1. **HEAD already trusted** (by commit or tree match): rewrite `.execution_state` (branch=current, commit=HEAD, working_tree_ref=HEAD), exit with status `trusted` (exit code 0), message "Trusted snapshot; baseline advanced." If trust was found via tree match (dirty-tree record with `commit: null`), a materialized commit record SHALL be appended with `source: "ledger-reconciled"`, `commit: HEAD`, `tree: HEAD^{tree}`.
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

#### Scenario: Merge-tree command unavailable or fails
- **WHEN** HEAD is a 2-parent merge commit
- **AND** both parents are trusted
- **AND** `git merge-tree --write-tree` fails or is unavailable (git version < 2.38)
- **THEN** the validator SHALL fall back to normal full validation
- **AND** the validator SHALL NOT fail or exit with an error

#### Scenario: Ledger file does not exist
- **WHEN** reconciliation runs
- **AND** the ledger file does not yet exist (first-ever run or deleted for rollback)
- **THEN** reconciliation SHALL find no trusted records
- **AND** the validator SHALL proceed with normal validation

### Requirement: Detect Trust Reconciliation
On every `detect` invocation without explicit `--commit` or `--uncommitted` diff source overrides, the system SHALL perform read-only trust reconciliation before normal change detection. Detect trust reconciliation SHALL use the same trust lookup and merge-parent analysis as startup reconciliation, but it SHALL NOT mutate `.execution_state`, append ledger records, acquire the run lock, prune the ledger, initialize loggers, or report the `trusted` validator status. If the working tree is dirty, detect trust reconciliation SHALL be skipped and `detect` SHALL use its existing change detection behavior.

#### Scenario: Detect sees HEAD trusted by commit
- **WHEN** `agent-validator detect` runs on a clean worktree
- **AND** HEAD has a trusted ledger record matching by commit
- **THEN** `detect` SHALL print "No changes detected."
- **AND** exit with the existing no-changes exit code
- **AND** `.execution_state` SHALL NOT be written or modified

#### Scenario: Detect sees HEAD trusted by tree
- **WHEN** `agent-validator detect` runs on a clean worktree
- **AND** HEAD has no trusted commit record
- **AND** a trusted ledger record exists with `tree` matching `HEAD^{tree}`
- **THEN** `detect` SHALL print "No changes detected."
- **AND** exit with the existing no-changes exit code
- **AND** NO materialized `ledger-reconciled` record SHALL be appended

#### Scenario: Detect scopes from one trusted merge parent
- **WHEN** `agent-validator detect` runs on a clean two-parent merge commit
- **AND** exactly one merge parent is trusted
- **THEN** `detect` SHALL use the trusted parent's commit as `fixBase`
- **AND** list only changes between that trusted parent and HEAD

#### Scenario: Detect scopes from synthetic merge tree
- **WHEN** `agent-validator detect` runs on a clean two-parent merge commit
- **AND** both merge parents are trusted
- **AND** the synthetic merge tree differs from `HEAD^{tree}`
- **THEN** `detect` SHALL use the synthetic merge tree as `fixBase`
- **AND** list only the merge-resolution delta files
- **AND** NO ledger record SHALL be appended for HEAD

#### Scenario: Detect auto-trusted merge has no changes
- **WHEN** `agent-validator detect` runs on a clean two-parent merge commit
- **AND** both merge parents are trusted
- **AND** the synthetic merge tree equals `HEAD^{tree}`
- **THEN** `detect` SHALL print "No changes detected."
- **AND** exit with the existing no-changes exit code
- **AND** NO ledger record SHALL be appended for HEAD

#### Scenario: Detect explicit diff source bypasses trust reconciliation
- **WHEN** `agent-validator detect --commit <sha>` or `agent-validator detect --uncommitted` runs
- **THEN** trust reconciliation SHALL NOT short-circuit or alter the requested diff source
- **AND** detect SHALL use the explicit diff source requested by the user

### Requirement: Ledger Pruning
The system SHALL periodically prune ledger records whose content is no longer relevant. For records with a non-null `commit`, the commit MUST be reachable from a local ref. For records with `commit: null` (dirty-tree records), the `working_tree_ref` object MUST still exist in git (not garbage collected). Reachability SHALL be checked via `git rev-list --all`; object existence via `git cat-file -t`. Pruning SHALL rewrite the file atomically (write to temp file, rename). Pruning SHALL be triggered when the ledger exceeds 1000 lines, checked at startup before reconciliation.

#### Scenario: Unreachable commit pruned
- **WHEN** pruning runs
- **AND** a record's `commit` is not reachable from any local ref
- **THEN** that record SHALL be removed from the ledger

#### Scenario: Garbage-collected dirty-tree record pruned
- **WHEN** pruning runs
- **AND** a record has `commit: null`
- **AND** the `working_tree_ref` object no longer exists in git
- **THEN** that record SHALL be removed from the ledger

#### Scenario: Reachable commit preserved
- **WHEN** pruning runs
- **AND** a record's `commit` is reachable from a local ref
- **THEN** that record SHALL be preserved

#### Scenario: Atomic prune rewrite
- **WHEN** pruning rewrites the ledger
- **THEN** it SHALL write to a temp file and rename
- **AND** concurrent readers SHALL see either the old or new file, never a partial write

#### Scenario: Empty ledger after prune
- **WHEN** pruning removes all records
- **THEN** the file SHALL be empty (not deleted)

#### Scenario: Concurrent write during prune
- **WHEN** pruning is rewriting the ledger via temp file + rename
- **AND** a concurrent writer appends a record between the read and the rename
- **THEN** the appended record MAY be lost (acceptable — the record will be re-earned on the next passing run)
- **AND** the ledger SHALL NOT be corrupted

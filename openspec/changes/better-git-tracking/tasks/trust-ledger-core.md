# Task: Trust ledger core module + write integration

## Goal

Build the trust ledger module and integrate ledger writes into the run, check, review, and skip command flows. After this task, trusted records accumulate in the shared ledger file whenever validation passes or the user skips — for both clean and dirty trees. The ledger is readable, queryable, and self-pruning.

## Background

Agent-validator's `.execution_state` answers "where do I diff from?" but has no concept of validation evidence. This task introduces a new append-only JSONL trust ledger at `$(git rev-parse --git-common-dir)/agent-validator/trusted-snapshots.jsonl`. Worktrees share `.git/`, so the ledger is visible across all worktrees without copying files.

`.execution_state` is untouched — it continues to serve its existing role as a per-worktree diff baseline. The ledger is a separate concern answering "is this snapshot trusted without rerunning?"

### Key files

- **Create** `src/utils/trust-ledger.ts` — the new module. Follow the pattern of `src/utils/execution-state.ts` for style and git helper usage.
- **Modify** `src/core/run-executor-helpers.ts` — in the function that calls `writeExecutionState` (near the end of the run-completion path, after `buildRunResult`), add conditional ledger write after the `writeExecutionState` call.
- **Modify** `src/commands/gate-command.ts` — in `executeGateCommand()`, after the `writeExecutionState` call that follows the `runner.run(jobs)` outcome, add conditional ledger write.
- **Modify** `src/commands/skip.ts` — in the skip command handler, after the `writeExecutionState` call, add ledger write with `source: "manual-skip"`.
- **Reference** `src/utils/execution-state.ts` — `createWorkingTreeRef()` shows how stash SHAs work. Use `git rev-parse <ref>^{tree}` to extract tree SHA from stash or commit.
- **Reference** `src/config/types.ts` — `LoadedConfig` interface for computing `config_hash`.
- **Reference** `src/utils/git.ts` — existing git helper functions (spawn, safe ref validation).

### Ledger record schema

```typescript
interface TrustRecord {
  commit: string | null;        // HEAD SHA, or null for dirty-tree records
  tree: string;                 // tree SHA of validated content
  config_hash: string;          // hash of gate-affecting config (audit only in v1)
  scope: ScopeDescriptor;       // structured: { command, gates, entry_points, cli_overrides }
  scope_hash: string;           // hash of scope descriptor
  validator_version: string;    // agent-validator version
  source: 'validated' | 'manual-skip' | 'ledger-reconciled';
  status: string;               // passed, passed_with_warnings, no_applicable_gates
  trusted: boolean;             // true = approved for propagation
  created_at: string;           // ISO 8601
  working_tree_ref?: string;    // stash SHA, present only for dirty-tree records
}
```

`config_hash`: hash the gate-affecting fields of the resolved config — `entry_points` (paths + checks + reviews), `cli.adapters`, `cli.default_preference`, `base_branch`. Exclude operational fields like `max_retries`, `log_dir`, `debug_log`. v1 stores but does NOT gate on this value.

`scope`: structured descriptor containing the command name, resolved gate list, entry point paths, and any CLI overrides (`--gate`, `--review`). `scope_hash` is its deterministic hash. v1 stores but does NOT gate on scope.

### Module functions

- `getLedgerPath()` — resolve via `git rev-parse --git-common-dir`, append `/agent-validator/trusted-snapshots.jsonl`. Create directory on first write if missing.
- `appendRecord(record)` — serialize to single-line JSON, append via `open("a")` mode. Create directory if needed. Errors caught and logged to stderr, never thrown.
- `readRecords()` — read file line by line, parse JSON, skip corrupt/unparseable lines silently. Return empty array if file doesn't exist.
- `isTrusted(commit, tree)` — check commit match first (record with `trusted: true` and matching `commit`). If no commit match and worktree is clean, check tree match (record with `trusted: true` and matching `tree`). Return `{ trusted: boolean, matchType: 'commit' | 'tree' | null, record?: TrustRecord }`.
- `pruneIfNeeded(threshold)` — count lines (cheap, no parse). If > threshold (1000): read all records, collect reachable commits via `git rev-list --all`, for `commit: null` records check `git cat-file -t <working_tree_ref>`, write survivors to temp file, atomic rename.
- `computeTreeSha(ref)` — `git rev-parse <ref>^{tree}`.

### Write rules

**Trust-eligible outcomes**: `passed`, `passed_with_warnings`, `no_applicable_gates`. Outcomes `failed`, `error`, `lock_conflict`, `retry_limit_exceeded` produce NO ledger record.

**Trust-eligible scope**: default invocations of `run`, `check`, or `skip` (no `--gate`/`--review` CLI narrowing). These write `trusted: true`. Partial runs (`--gate`, `--review` overrides) and review-only runs write records with `trusted: false`.

**Clean tree** (`git status --porcelain` empty): `commit = HEAD SHA`, `tree = HEAD^{tree}`.
**Dirty tree** (`git status --porcelain` non-empty): `commit = null`, `tree = working_tree_ref^{tree}`, `working_tree_ref = <stash SHA>`. The `working_tree_ref` is already computed by `createWorkingTreeRef()` and stored in `.execution_state`.

**Skip command**: writes its own ledger record with `source: "manual-skip"`. This is NOT part of the run-completion flow — skip owns its ledger write independently. Same clean/dirty logic applies.

**Error handling**: ledger write errors are caught and logged to stderr. They NEVER propagate or fail the run/skip command.

## Spec

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
- **Dirty tree**: record SHALL have `commit` = null, `tree` = tree of `working_tree_ref`, and `working_tree_ref` = stash SHA.

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
- **WHEN** any validator command completes with status `failed` or `retry_limit_exceeded`
- **THEN** NO ledger record SHALL be written

### Requirement: Ledger Trust Lookup
A commit is trusted when a ledger record exists with `trusted: true` and matching either `commit` or `tree`:

- **Commit match** (checked first): record has `commit` = queried commit SHA.
- **Tree match** (checked second, only when worktree is clean): record has `tree` = queried commit's `HEAD^{tree}`. Tree match SHALL only be used when the current worktree is clean (`git status --porcelain` is empty) — do not use tree-only trust while the worktree is dirty, as the dirty state may have diverged from the matched tree.

The `source`, `status`, `scope`, `scope_hash`, and `config_hash` fields are recorded for audit and observability but SHALL NOT be used in trust gating in v1.

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

### Requirement: Ledger Write on Run Completion
After `writeExecutionState`, the system SHALL evaluate whether to write a ledger trust record. Ledger records SHALL only be written for trust-eligible terminal outcomes: `passed`, `passed_with_warnings`, and `no_applicable_gates`. The outcomes `failed`, `error`, `lock_conflict`, and `retry_limit_exceeded` SHALL NOT produce ledger records. For clean trees, the record SHALL use `commit: HEAD`, `tree: HEAD^{tree}`. For dirty trees, the record SHALL use `commit: null`, `tree: working_tree_ref^{tree}`, with `working_tree_ref` set to the stash SHA. The ledger write SHALL NOT block or fail the run — errors are logged and swallowed.

#### Scenario: Clean tree pass writes commit-keyed record
- **WHEN** a trust-eligible run completes on a clean tree
- **THEN** a ledger record SHALL be written with `commit: HEAD`, `tree: HEAD^{tree}`

#### Scenario: Dirty tree pass writes tree-keyed record
- **WHEN** a trust-eligible run completes on a dirty tree
- **THEN** a ledger record SHALL be written with `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`

#### Scenario: Partial pass writes record with trusted false
- **WHEN** a run with `--gate` or `--review` CLI narrowing completes with `passed`
- **THEN** a ledger record SHALL be written with `trusted: false`

#### Scenario: Failure does not write ledger record
- **WHEN** a run completes with status `failed`, `error`, `lock_conflict`, or `retry_limit_exceeded`
- **THEN** NO ledger record SHALL be written

#### Scenario: Ledger write failure does not fail the run
- **WHEN** a ledger write encounters an error (disk full, permission denied, etc.)
- **THEN** the error SHALL be logged
- **AND** the run SHALL complete normally with its original status

### Requirement: Skip CLI Command (modified — ledger write addition)

The skip command SHALL write a trusted ledger record with `source: "manual-skip"` in addition to updating `.execution_state`. The ledger write is the skip command's own responsibility (not part of the run-completion flow). On a clean tree, the record SHALL use `commit: HEAD`, `tree: HEAD^{tree}`. On a dirty tree, the record SHALL use `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`.

#### Scenario: Skip on clean tree writes commit-keyed record
- **WHEN** the user executes `agent-validate skip`
- **AND** `git status --porcelain` returns empty
- **THEN** the ledger record SHALL have `commit: HEAD`, `tree: HEAD^{tree}`, `trusted: true`, `source: "manual-skip"`

#### Scenario: Skip on dirty tree writes tree-keyed record
- **WHEN** the user executes `agent-validate skip`
- **AND** `git status --porcelain` returns non-empty
- **THEN** the ledger record SHALL have `commit: null`, `tree: working_tree_ref^{tree}`, `working_tree_ref: <stash SHA>`, `trusted: true`, `source: "manual-skip"`

#### Scenario: Skip ledger write failure does not fail the command
- **WHEN** the user executes `agent-validate skip`
- **AND** the ledger write encounters an error
- **THEN** `.execution_state` SHALL still be updated
- **AND** the error SHALL be logged
- **AND** the command SHALL exit with code 0

## Done When

- The trust-ledger module exists with all functions (appendRecord, readRecords, isTrusted, pruneIfNeeded, getLedgerPath, computeTreeSha).
- Running `agent-validator run` or `agent-validator check` on a clean tree writes a ledger record with `trusted: true`, `commit: HEAD`, and `tree: HEAD^{tree}`.
- Running on a dirty tree writes a record with `commit: null` and `tree: working_tree_ref^{tree}`.
- Running `agent-validator skip` writes a `source: "manual-skip"` record (clean or dirty).
- Partial runs (`--gate`, `--review`) write records with `trusted: false`.
- Failures produce no records.
- `isTrusted()` finds records by commit match (preferred) and tree match (clean worktree only).
- Pruning triggers at >1000 lines, removes unreachable records, and rewrites atomically.
- All ledger write errors are caught, logged, and never fail the parent command.
- Tests cover the above scenarios.

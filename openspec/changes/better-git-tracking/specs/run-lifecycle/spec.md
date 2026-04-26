## ADDED Requirements

### Requirement: Trusted Exit Status
The validator SHALL support a `trusted` status for `run`, `check`, and `review` invocations that short-circuit via mutating ledger reconciliation. `trusted` SHALL be a success status (exit code 0). It SHALL NOT count as a gate run — no gates are executed, no gate logs are written, and no run count is incremented. Mutating reconciliation SHALL run within the run lock (since it may mutate `.execution_state` and append ledger records) but BEFORE logger initialization and console log creation. The `detect` command SHALL use read-only trust reconciliation and SHALL NOT emit the `trusted` status.

#### Scenario: Trusted status on reconciliation short-circuit
- **WHEN** ledger reconciliation determines HEAD is trusted
- **THEN** the validator SHALL exit with status `trusted` and exit code 0
- **AND** the message SHALL be "Trusted snapshot; baseline advanced."

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

#### Scenario: Detect uses no-changes output for trusted snapshots
- **WHEN** `agent-validator detect` finds clean HEAD is trusted via read-only reconciliation
- **THEN** it SHALL report "No changes detected."
- **AND** it SHALL NOT emit the `trusted` status
- **AND** it SHALL NOT write `.execution_state`, create gate logs, create console logs, or increment the run count

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

## MODIFIED Requirements

### Requirement: Execution State Persistence Across Clean

The execution state file MUST persist across all clean operations (manual and auto-clean on success or retry limit exceeded). The file is only reset (deleted) when auto-clean triggers due to context change (branch changed or commit merged into base branch). Ledger reconciliation runs BEFORE auto-clean; if reconciliation advances execution state (because HEAD is trusted), auto-clean SHALL NOT run.

#### Scenario: Clean preserves execution state
- **GIVEN** `.execution_state` exists in the log directory
- **WHEN** the clean operation runs (auto on success, auto on retry limit exceeded, or manual)
- **THEN** `.execution_state` SHALL remain in place
- **AND** `.execution_state` SHALL NOT be moved to `previous/`

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

#### Scenario: Auto-clean skipped when commit merged but working tree is dirty
- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **AND** `git status --porcelain` returns non-empty (working tree has changes)
- **WHEN** auto-clean checks the merged commit
- **THEN** auto-clean SHALL NOT fire (the merge-base check is skipped entirely)
- **AND** the execution state SHALL be preserved
- **AND** the retry counter and narrowed diff capability SHALL remain intact

#### Scenario: Auto-clean skipped when commit merged and only untracked files exist
- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **AND** the working tree has ONLY untracked files (no staged or modified tracked files)
- **AND** `working_tree_ref` equals `commit` (due to `git stash create` limitation)
- **AND** `git status --porcelain` returns non-empty (untracked files shown as `??`)
- **WHEN** auto-clean checks the merged commit
- **THEN** auto-clean SHALL NOT fire
- **AND** the execution state SHALL be preserved

#### Scenario: Reconciliation preempts auto-clean
- **GIVEN** ledger reconciliation runs and finds HEAD is trusted
- **WHEN** reconciliation advances `.execution_state` to current branch/commit
- **THEN** auto-clean SHALL NOT run
- **AND** the validator SHALL exit with status `trusted`

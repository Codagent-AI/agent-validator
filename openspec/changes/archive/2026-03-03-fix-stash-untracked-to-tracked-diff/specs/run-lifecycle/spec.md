## MODIFIED Requirements

### Requirement: Session Reference for Re-run Diff Scoping

On run completion (success or failure), the system SHALL capture the working tree state in the unified `.execution_state` file. The separate `.session_ref` file is deprecated and SHALL be removed if present. On re-runs with existing logs, the system uses `working_tree_ref` from execution state as the diff base. Session ref scoping applies to review gates only; check gates are unaffected as they do not use diff-based violation filtering.

When computing the diff against a stash-based `working_tree_ref`, the system MUST account for files that were untracked at stash time (stored in the stash's `^3` parent) but have since been committed (now tracked). Such files MUST NOT appear as "new files" in the diff output if their content is unchanged since the stash snapshot.

#### Scenario: Session ref created on first run with violations
- **GIVEN** a first run completes (no existing logs before this run)
- **AND** one or more review gates report violations
- **WHEN** the run finishes writing log files
- **THEN** the system SHALL write `working_tree_ref` to `.execution_state` in the log directory
- **AND** the `working_tree_ref` SHALL contain a git stash SHA (from `git stash push --include-untracked`) representing the full working tree state (tracked and untracked files) at that moment
- **AND** no separate `.session_ref` file SHALL be created

#### Scenario: Session ref not created when all gates pass
- **GIVEN** a first run completes
- **AND** all gates pass (no violations)
- **WHEN** the run finishes
- **THEN** the system SHALL write `working_tree_ref` to `.execution_state`
- **AND** the auto-clean process SHALL proceed normally

#### Scenario: Re-run uses session ref for diff
- **GIVEN** the log directory contains log files (rerun mode)
- **AND** `.execution_state` exists with a valid `working_tree_ref`
- **WHEN** the review gate computes its diff
- **THEN** the diff SHALL be computed using `working_tree_ref` from `.execution_state` as the base (scoped to the entry point path)
- **AND** the diff SHALL capture all changes since the working tree snapshot regardless of whether fixes were committed or left uncommitted

#### Scenario: Session ref fallback on invalid SHA
- **GIVEN** the `.execution_state` file exists but `working_tree_ref` contains an invalid or unreachable git SHA
- **WHEN** the system attempts to compute the narrowed diff
- **THEN** the system SHALL fall back to using uncommitted changes as the diff (existing behavior)
- **AND** the system SHALL log a warning indicating the session reference was invalid

#### Scenario: Legacy session ref file cleanup
- **GIVEN** a `.session_ref` file exists from a previous version
- **WHEN** the system writes execution state
- **THEN** the `.session_ref` file SHALL be deleted

#### Scenario: Untracked file committed between stash and next diff
- **GIVEN** a stash-based `working_tree_ref` was created when file `foo.ts` was untracked (stored in stash `^3` parent)
- **AND** `foo.ts` has since been committed (now tracked in HEAD) without content changes
- **WHEN** the system computes the diff against `working_tree_ref`
- **THEN** `foo.ts` SHALL NOT appear in the diff output
- **AND** the diff file count SHALL NOT include `foo.ts`

#### Scenario: Untracked file committed and modified between stash and next diff
- **GIVEN** a stash-based `working_tree_ref` was created when file `foo.ts` was untracked (stored in stash `^3` parent)
- **AND** `foo.ts` has since been committed and further modified (content differs from stash `^3` blob)
- **WHEN** the system computes the diff against `working_tree_ref`
- **THEN** `foo.ts` SHALL appear in the diff output as a new file showing its full current content
- **NOTE** Because the file was not in the stash's main tree, `git diff` shows it as entirely new. This is acceptable for the rare modified-after-commit case — the file genuinely changed and a full-content diff is a conservative, correct approach.

### Requirement: Unified Execution State with Working Tree Reference

The execution state file (`.execution_state`) MUST include a `working_tree_ref` field that captures the working tree state (including uncommitted changes) at run completion. This field is used to compute narrower diffs on subsequent runs after logs have been cleaned.

#### Scenario: Execution state structure
- **WHEN** the system writes `.execution_state`
- **THEN** the file SHALL contain a JSON object with fields:
  - `last_run_completed_at`: ISO 8601 timestamp
  - `branch`: current branch name
  - `commit`: HEAD SHA at run completion
  - `working_tree_ref`: stash SHA capturing working tree state

#### Scenario: Working tree ref creation with tracked changes
- **GIVEN** the working tree has staged or unstaged changes to tracked files
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash push --include-untracked` and immediately pop to restore
- **AND** the stash SHA SHALL reference a 3-parent stash (parent 3 = untracked files tree)
- **AND** the system SHALL store this SHA as `working_tree_ref`

#### Scenario: Working tree ref creation with tracked and untracked changes
- **GIVEN** the working tree has both tracked modifications and untracked files
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash push --include-untracked` and immediately pop to restore
- **AND** the stash SHA SHALL reference a 3-parent stash
- **AND** the `^3` parent tree SHALL contain the untracked files
- **AND** the system SHALL store this SHA as `working_tree_ref`

#### Scenario: Working tree ref creation with untracked-only changes
- **GIVEN** the working tree has ONLY untracked files (no staged or modified tracked files)
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash push --include-untracked` and immediately pop to restore
- **AND** if the stash push was a no-op (no stash created), the system SHALL fall back to storing the current HEAD SHA as `working_tree_ref`

#### Scenario: Working tree ref creation with clean working tree
- **GIVEN** the working tree has no uncommitted changes
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL store the current HEAD SHA as `working_tree_ref`
- **AND** no stash operation SHALL be attempted

#### Scenario: Working tree ref captures uncommitted changes
- **GIVEN** the working tree has uncommitted changes (staged or unstaged)
- **WHEN** the system creates `working_tree_ref`
- **THEN** the stash SHA SHALL include all tracked changes and untracked files
- **AND** the working tree SHALL NOT be modified (stash is popped immediately after creation)

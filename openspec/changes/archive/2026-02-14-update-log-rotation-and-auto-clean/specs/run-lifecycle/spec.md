## ADDED Requirements

### Requirement: Auto-Clean on Retry Limit Exceeded

When the retry limit is exceeded, the system MUST automatically perform the log clean process to archive the session logs. The execution state file SHALL be preserved (not deleted) so that the next session can use `working_tree_ref` as a valid baseline for scoping changes. The clean operation SHALL use the project-configured `max_previous_logs` for rotation depth.

#### Scenario: Retry limit exceeded triggers auto-clean

- **GIVEN** `max_retries` is set to 3
- **AND** the current run is the final allowed run (run 4)
- **WHEN** gates fail on the final allowed run
- **THEN** the status output SHALL display "Retry limit exceeded"
- **AND** the log clean process SHALL execute automatically with the configured rotation depth
- **AND** `.execution_state` SHALL be preserved (NOT deleted)

#### Scenario: Execution state preserved for next session

- **GIVEN** a run has ended with status `retry_limit_exceeded`
- **AND** the log clean process has archived the session logs
- **WHEN** the next run starts (in a new session)
- **THEN** the system SHALL read `.execution_state` and resolve `fixBase` from `working_tree_ref`
- **AND** change detection SHALL scope to changes since `working_tree_ref`

### Requirement: ChangeDetector FixBase Support

When `fixBase` is provided in the change detector options and neither `commit` nor `uncommitted` is explicitly set, the change detector MUST use `fixBase` as the diff base for determining changed files. This ensures gate selection and diff computation agree on the same base ref. A flag is considered "explicitly set" when it is passed as a CLI argument (regardless of value) or provided as a defined (non-undefined) value in the options object. An absent or undefined option is not explicitly set.

#### Scenario: fixBase used for change detection

- **GIVEN** `fixBase` is set in the change detector options
- **AND** neither `commit` nor `uncommitted` is explicitly set
- **WHEN** the change detector computes changed files
- **THEN** the diff SHALL be computed against `fixBase`
- **AND** the result SHALL include all files changed since `fixBase`

#### Scenario: Explicit commit overrides fixBase

- **GIVEN** `fixBase` is set in the change detector options
- **AND** `commit` is explicitly provided
- **WHEN** the change detector computes changed files
- **THEN** the diff SHALL be computed for the specified commit (not fixBase)

#### Scenario: Explicit uncommitted overrides fixBase

- **GIVEN** `fixBase` is set in the change detector options
- **AND** `uncommitted` is explicitly set to true
- **WHEN** the change detector computes changed files
- **THEN** the diff SHALL include only uncommitted changes (not fixBase)

#### Scenario: Priority order for change detection mode

- **WHEN** the change detector evaluates its options
- **THEN** the priority order SHALL be:
  1. `commit` (explicit CLI flag)
  2. `uncommitted` (explicit CLI flag)
  3. `fixBase` (from execution state)
  4. CI detection / local base branch diff (default)

## MODIFIED Requirements

### Requirement: Max Retries Enforcement

The Runner (which backs the `run`, `check`, and `review` commands) MUST enforce a configurable retry limit. The limit is determined by the `max_retries` field in `.gauntlet/config.yml` (default: 3). The system allows `max_retries + 1` total runs (1 initial + N retries). The current run number is determined by finding the highest run-number suffix across all log files in the log directory (regardless of job ID or adapter) and adding 1. On the final allowed run, if gates still fail, the status SHALL be reported as "Retry limit exceeded" instead of "Failed" and logs SHALL be automatically archived. Any subsequent run attempt SHALL immediately exit with a non-zero exit code without executing gates.

#### Scenario: First run (no existing logs)

- **GIVEN** `max_retries` is set to 3
- **AND** no log files exist in the log directory
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 1 of 4 allowed)

#### Scenario: Retry within limit

- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 2
- **WHEN** the command starts
- **THEN** the command SHALL proceed normally (run 3 of 4 allowed)

#### Scenario: Final allowed run fails

- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and gates fail
- **THEN** the status output SHALL display "Retry limit exceeded" instead of "Failed"
- **AND** the log clean process SHALL execute automatically
- **AND** `.execution_state` SHALL be preserved
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Final allowed run passes

- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 3 (this will be run 4)
- **WHEN** the command executes and all gates pass
- **THEN** the status output SHALL display "Passed" (normal success behavior)
- **AND** auto-clean SHALL proceed as usual

#### Scenario: Beyond retry limit

- **GIVEN** `max_retries` is set to 3
- **AND** the highest run number among existing log files is 4 or higher
- **WHEN** the command starts
- **THEN** the command SHALL print an error indicating the retry limit has been exceeded
- **AND** the command SHALL exit with a non-zero exit code without executing any gates

#### Scenario: Default value

- **GIVEN** `max_retries` is not specified in the config
- **WHEN** the system reads the configuration
- **THEN** the default value SHALL be 3

### Requirement: Execution State Persistence Across Clean

The execution state file MUST persist across all clean operations (manual and auto-clean on success or retry limit exceeded). The file is only reset (deleted) when auto-clean triggers due to context change (branch changed or commit merged into base branch).

#### Scenario: Clean preserves execution state

- **GIVEN** `.execution_state` exists in the log directory
- **WHEN** the clean operation runs (auto on success, auto on retry limit exceeded, or manual)
- **THEN** `.execution_state` SHALL remain in place
- **AND** `.execution_state` SHALL NOT be moved to `previous/`

#### Scenario: Auto-clean resets execution state on branch change

- **GIVEN** `.execution_state` exists with `branch: "feature-a"`
- **AND** the current branch is "feature-b"
- **WHEN** auto-clean detects the branch change
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

#### Scenario: Auto-clean resets execution state on commit merged

- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **WHEN** auto-clean detects the merged commit
- **THEN** `.execution_state` SHALL be deleted (reset) unconditionally
- **AND** the `working_tree_ref` validity SHALL NOT be checked (stash existence in git is irrelevant after merge)
- **AND** the next run SHALL operate in first-run mode against base branch

### Requirement: Post-Clean FixBase Resolution

When starting a run with no existing logs but an execution state file present, the system MUST resolve a `fixBase` to scope change detection to changes since the last passing run. This prevents unnecessary full-diff runs after a successful clean. The resolved `fixBase` MUST be used by both the change detector (for gate selection) and review gates (for diff computation) to ensure consistency.

#### Scenario: Post-clean run with valid working tree ref

- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists with a valid `working_tree_ref`
- **AND** `working_tree_ref` object exists in git (not garbage collected)
- **AND** `commit` is NOT an ancestor of the base branch (not merged)
- **WHEN** the run command starts
- **THEN** the system SHALL use `working_tree_ref` as `fixBase`
- **AND** the change detector SHALL use `fixBase` for gate selection
- **AND** review gates SHALL use `fixBase` for diff computation
- **AND** both SHALL agree on the same set of changed files

#### Scenario: Post-clean run with garbage-collected working tree ref

- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists with `working_tree_ref`
- **AND** `working_tree_ref` object does NOT exist in git (garbage collected)
- **AND** `commit` object exists in git
- **AND** `commit` is NOT an ancestor of the base branch
- **WHEN** the run command starts
- **THEN** the system SHALL use `commit` as `fixBase` (fallback)
- **AND** the system SHALL log a warning about the missing stash to the console

#### Scenario: Post-clean run with merged commit (stale state)

- **GIVEN** no log files exist in the log directory
- **AND** `.execution_state` exists
- **AND** `commit` IS an ancestor of the base branch (work was merged)
- **WHEN** the run command starts
- **THEN** the system SHALL NOT use `fixBase` (state is stale)
- **AND** change detection SHALL use the base branch as the diff target
- **AND** auto-clean logic SHALL handle state reset separately

#### Scenario: Post-clean run with no execution state

- **GIVEN** no log files exist in the log directory
- **AND** no `.execution_state` file exists
- **WHEN** the run command starts
- **THEN** change detection SHALL use the base branch as the diff target
- **AND** the system SHALL operate in first-run mode

#### Scenario: Git object existence check

- **WHEN** the system validates a SHA for use as `fixBase`
- **THEN** the system SHALL execute `git cat-file -t <sha>`
- **AND** if the command succeeds, the object exists
- **AND** if the command fails, the object does not exist

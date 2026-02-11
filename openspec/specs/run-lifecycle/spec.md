# run-lifecycle Specification

## Purpose
TBD - created by archiving change remove-rerun-unify-logs. Update Purpose after archive.
## Requirements
### Requirement: Automatic Rerun Detection
The `run`, `check`, and `review` commands MUST automatically detect whether to operate in first-run or rerun mode based on the presence of log files. Explicit flags (`--uncommitted`, `--commit`) override only the diff source; failure context injection is controlled solely by log presence. When a session reference exists, rerun mode SHALL use it to scope the review diff to fix-only changes.

#### Scenario: First run (empty log directory)
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in first-run mode
- **AND** use the base-branch diff for change detection (existing behavior)
- **AND** no failure context SHALL be injected

#### Scenario: Rerun (logs present)
- **GIVEN** the log directory contains `.log` files
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL operate in rerun mode
- **AND** for review gates: if a valid `.session_ref` exists, use it as the diff base; otherwise use uncommitted changes as the diff (fallback)
- **AND** for check gates: re-run the command normally (check gates do not use diff-based scoping)
- **AND** parse the highest-numbered log per job prefix for previous failures
- **AND** inject failure context into review gates whose sanitized job ID matches the log file prefix

#### Scenario: Rerun with no changes since session ref
- **GIVEN** the log directory contains `.log` files
- **AND** a `.session_ref` file exists
- **AND** `git diff <session_ref>` produces an empty diff (no changes since snapshot)
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "No changes detected" and exit with code 0
- **AND** log files SHALL remain in the log directory (no clean)

#### Scenario: Rerun with no uncommitted changes and no session ref
- **GIVEN** the log directory contains `.log` files
- **AND** no `.session_ref` file exists
- **AND** there are no uncommitted changes (staged or unstaged)
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "No changes detected" and exit with code 0
- **AND** log files SHALL remain in the log directory (no clean)

#### Scenario: Explicit --uncommitted with empty log directory
- **GIVEN** the log directory is empty or does not exist
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** no failure context SHALL be injected (no logs to parse)

#### Scenario: Explicit --uncommitted with logs present
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--uncommitted`
- **THEN** the command SHALL use uncommitted changes as the diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

#### Scenario: Explicit --commit overrides diff source
- **GIVEN** the log directory contains `.log` files
- **WHEN** the user passes `--commit <sha>`
- **THEN** the command SHALL use the specified commit diff
- **AND** failure context SHALL still be injected from the highest-numbered logs

### Requirement: Remove Rerun Command
The `rerun` subcommand MUST be removed from the CLI. Its behavior is subsumed by the automatic rerun detection in `run`, `check`, and `review`.

#### Scenario: User invokes rerun
- **GIVEN** the CLI is installed
- **WHEN** the user executes `agent-gauntlet rerun`
- **THEN** the CLI SHALL report an unknown command error

### Requirement: Latest Log Parsing for Verification
In rerun mode, the system MUST parse only the highest-numbered log file for each job prefix to determine previous failures. The job prefix is extracted by stripping the dot-separated run number suffix from the filename (e.g. `check_src_test.2.log` has prefix `check_src_test`).

#### Scenario: Multiple numbered logs exist
- **GIVEN** the log directory contains `check_src_test.1.log`, `check_src_test.2.log`, and `check_src_test.3.log`
- **WHEN** the system parses logs for failure context
- **THEN** only `check_src_test.3.log` SHALL be parsed for failure context

#### Scenario: No failures in latest log
- **GIVEN** the highest-numbered log for a job prefix contains no failures (status PASS)
- **WHEN** the system parses logs for failure context
- **THEN** no failure context SHALL be injected for that job

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

### Requirement: Session Reference for Re-run Diff Scoping

On run completion (success or failure), the system SHALL capture the working tree state in the unified `.execution_state` file. The separate `.session_ref` file is deprecated and SHALL be removed if present. On re-runs with existing logs, the system uses `working_tree_ref` from execution state as the diff base. Session ref scoping applies to review gates only; check gates are unaffected as they do not use diff-based violation filtering.

#### Scenario: Session ref created on first run with violations
- **GIVEN** a first run completes (no existing logs before this run)
- **AND** one or more review gates report violations
- **WHEN** the run finishes writing log files
- **THEN** the system SHALL write `working_tree_ref` to `.execution_state` in the log directory
- **AND** the `working_tree_ref` SHALL contain a git commit SHA (from `git stash create --include-untracked`) representing the full working tree state (tracked and untracked files) at that moment
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

### Requirement: Re-run Violation Priority Filter
When operating in rerun mode (i.e., previous failures are loaded from log files), the system SHALL discard violations below the configured priority threshold to prevent infinite review loops. The threshold is controlled by the project-level `rerun_new_issue_threshold` setting (default: `"high"`). Only violations at or above the threshold SHALL be accepted.

> **Note:** The narrowed diff (session ref) structurally limits the reviewer's visibility to changes since the snapshot. The priority filter provides additional noise reduction for cases where the diff includes non-fix edits or the reviewer reports low-priority style observations about fix code.

#### Scenario: Below-threshold new violation discarded on re-run
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"high"` (or defaulted)
- **AND** the reviewer reports a new violation with priority "medium" or "low"
- **WHEN** the system evaluates the review output
- **THEN** the new violation SHALL be discarded (not counted as a failure)
- **AND** the system SHALL log the count of filtered below-threshold violations

#### Scenario: At-or-above-threshold new violation accepted on re-run
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"high"`
- **AND** the reviewer reports a new violation with priority "high" or "critical"
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be accepted as a failure
- **AND** the gate SHALL report a fail status

#### Scenario: Threshold set to critical
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"critical"`
- **AND** the reviewer reports a new violation with priority "high"
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be discarded (does not meet threshold)

#### Scenario: Threshold set to low (accept all)
- **GIVEN** the system is in rerun mode with previous violations loaded
- **AND** `rerun_new_issue_threshold` is set to `"low"`
- **AND** the reviewer reports a new violation with any priority
- **WHEN** the system evaluates the review output
- **THEN** the violation SHALL be accepted (all priorities meet threshold)

#### Scenario: Filter ordering
- **GIVEN** the system is in rerun mode
- **WHEN** the reviewer returns violations
- **THEN** the diff-range filter (`isValidViolationLocation`) SHALL be applied first (removing violations outside the narrowed diff)
- **AND** the priority threshold filter SHALL be applied second (removing below-threshold violations from those that survive the diff-range filter)

#### Scenario: Default threshold when not configured
- **GIVEN** the project config does not specify `rerun_new_issue_threshold`
- **WHEN** the system enters rerun mode
- **THEN** the threshold SHALL default to `"high"`

### Requirement: Skip Passed Review Slots in Multi-Adapter Rerun

When operating in rerun mode with a review gate configured for `num_reviews > 1`, the system MUST skip review slots whose latest iteration passed (status: "pass" with no violations), provided at least one other slot in the same gate will run. This optimization saves tokens by avoiding redundant LLM calls when multiple adapters review the same prompt.

**Definitions**:
- **Latest iteration**: The highest iteration number (log filename suffix) for a given slot. For example, if `@1.2.json` and `@1.3.json` exist, the latest iteration for slot 1 is 3.
- **No prior result**: A slot with no log files is treated as not-passed and MUST run.

**Invariant**: At least one reviewer of each review prompt MUST run on every iteration.

The skip logic SHALL NOT apply when `num_reviews == 1`. Skip decisions are evaluated independently per gate; the presence of other gates does not affect skipping within a gate.

#### Scenario: Skip passed slot while failed slot runs
- **GIVEN** a review gate `code-quality` with `num_reviews: 2`
- **AND** the log directory contains:
  - `review_src_code-quality_codex@1.2.json` with `status: "pass"`
  - `review_src_code-quality_claude@2.2.json` with `status: "fail"` and violations
- **WHEN** the system enters rerun mode (run 3)
- **THEN** slot 1 SHALL be skipped (previously passed, slot 2 will run)
- **AND** slot 2 SHALL be invoked for review
- **AND** the log SHALL indicate: "Skipping @1: previously passed in iteration 2 (num_reviews > 1)"

#### Scenario: Slot skipped across multiple consecutive iterations
- **GIVEN** a review gate `code-quality` with `num_reviews: 2`
- **AND** iteration 1: slot 1 passed, slot 2 failed
- **WHEN** slot 2 continues to fail in iterations 2, 3, and 4
- **THEN** slot 1 SHALL be skipped in iterations 2, 3, and 4
- **AND** each iteration's log SHALL indicate slot 1 was skipped (passed in iteration 1)
- **AND** slot 2 SHALL run in each iteration until it passes

#### Scenario: Safety latch when all slots previously passed
- **GIVEN** a review gate `code-quality` with `num_reviews: 3`
- **AND** all three slots have `status: "pass"` in the previous iteration
- **WHEN** the system enters a new iteration (e.g., triggered by a check failure being fixed)
- **THEN** the safety latch SHALL activate to preserve the invariant
- **AND** the slot with review index 1 SHALL be invoked
- **AND** slots 2 and 3 SHALL be skipped
- **AND** the log SHALL indicate: "Running @1: safety latch (all slots previously passed)"
- **AND** the gate status SHALL be determined by slot 1's result on the latest diff

#### Scenario: Single reviewer (num_reviews == 1) always runs
- **GIVEN** a review gate `code-quality` with `num_reviews: 1`
- **AND** the previous iteration has `status: "pass"`
- **WHEN** the system enters rerun mode
- **THEN** the single reviewer SHALL be invoked (no skip allowed)
- **AND** this ensures the invariant is maintained

#### Scenario: Different review gates are independent
- **GIVEN** two review gates:
  - `code-quality` with `num_reviews: 1`, previous status: "pass"
  - `security` with `num_reviews: 1`, previous status: "fail" with violations
- **WHEN** the system enters rerun mode
- **THEN** both `code-quality` and `security` reviewers SHALL be invoked
- **AND** no skipping SHALL occur because both gates have `num_reviews: 1` (invariant requires at least one reviewer per gate)

#### Scenario: Adapter change does not affect skip decision
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** run 2 produced `review_src_codex@1.2.json` with `status: "pass"`
- **AND** codex is now unavailable, so claude would be assigned to slot 1
- **WHEN** the system enters rerun mode (run 3)
- **AND** slot 2 has outstanding failures
- **THEN** slot 1 SHALL be skipped regardless of adapter change
- **AND** the skip decision is based on review index, not adapter name

#### Scenario: Skip logging format
- **WHEN** a review slot is skipped due to previous pass
- **THEN** the log entry SHALL include:
  - The review index being skipped (e.g., "@1")
  - The iteration when it passed (extracted from log filename suffix)
  - The reason: "previously passed ... (num_reviews > 1)"
- **AND** format: "Skipping @N: previously passed in iteration M (num_reviews > 1)"

#### Scenario: Safety latch logging format
- **WHEN** the safety latch activates (all slots would be skipped)
- **THEN** the log entry SHALL include:
  - The review index being run (e.g., "@1")
  - The reason: "safety latch (all slots previously passed)"
- **AND** format: "Running @1: safety latch (all slots previously passed)"

#### Scenario: Skipped slot JSON log format
- **WHEN** a review slot is skipped due to previous pass
- **THEN** a JSON log file SHALL be written for the skipped slot
- **AND** the JSON SHALL have `status: "skipped_prior_pass"`
- **AND** the JSON SHALL have an empty `violations` array
- **AND** the JSON SHALL include `passIteration: <number>` indicating when the slot originally passed

#### Scenario: Skipped slots do not affect overall gate status
- **GIVEN** a review gate with `num_reviews: 3`
- **AND** slots 1 and 2 previously passed (will be skipped)
- **AND** slot 3 is invoked and returns `status: "pass"`
- **WHEN** the gate aggregates results
- **THEN** the overall gate status SHALL be "pass"
- **AND** skipped slots SHALL NOT count as failures or errors

#### Scenario: Safety latch slot finds new issues
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** both slots passed in the previous iteration
- **WHEN** the safety latch runs slot 1 on the latest diff
- **AND** slot 1 finds new violations
- **THEN** the gate status SHALL be "fail"
- **AND** the violations SHALL be reported normally

#### Scenario: Slot with no prior result must run
- **GIVEN** a review gate with `num_reviews: 2`
- **AND** slot 1 has a previous result with `status: "pass"`
- **AND** slot 2 has no previous log files (first time running)
- **WHEN** the system enters rerun mode
- **THEN** slot 2 SHALL be invoked (no prior result means must run)
- **AND** slot 1 SHALL be skipped (passed, and slot 2 will run)

### Requirement: Lock Acquisition Before Console Logging
The `run`, `check`, and `review` commands MUST acquire the run lock before starting console logging. This ensures that failed lock acquisitions do not create orphaned console log files.

#### Scenario: Lock acquisition fails - no console log created
- **GIVEN** another gauntlet run is in progress (lock file exists)
- **WHEN** the user executes `agent-gauntlet run`
- **THEN** the lock acquisition SHALL fail with an error message
- **AND** no console log file SHALL be created
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Lock acquisition succeeds - console log created
- **GIVEN** no gauntlet run is in progress (lock file does not exist)
- **WHEN** the user executes `agent-gauntlet run`
- **THEN** the lock SHALL be acquired first
- **AND** the console log file SHALL be created after lock acquisition
- **AND** the command SHALL proceed normally

### Requirement: Unified Execution State with Working Tree Reference

The execution state file (`.execution_state`) MUST include a `working_tree_ref` field that captures the working tree state (including uncommitted changes) at run completion. This field is used to compute narrower diffs on subsequent runs after logs have been cleaned.

#### Scenario: Execution state structure
- **WHEN** the system writes `.execution_state`
- **THEN** the file SHALL contain a JSON object with fields:
  - `last_run_completed_at`: ISO 8601 timestamp
  - `branch`: current branch name
  - `commit`: HEAD SHA at run completion
  - `working_tree_ref`: stash SHA capturing working tree state

#### Scenario: Working tree ref creation with uncommitted changes
- **GIVEN** the working tree has uncommitted changes (staged, unstaged, or untracked files)
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash create --include-untracked`
- **AND** the command SHALL return a stash SHA
- **AND** the system SHALL store this SHA as `working_tree_ref`

#### Scenario: Working tree ref creation with clean working tree
- **GIVEN** the working tree has no uncommitted changes
- **WHEN** a run completes (success or failure)
- **THEN** the system SHALL execute `git stash create --include-untracked`
- **AND** the command SHALL return empty (no output)
- **AND** the system SHALL store the current HEAD SHA as `working_tree_ref`

#### Scenario: Working tree ref captures uncommitted changes
- **GIVEN** the working tree has uncommitted changes (staged or unstaged)
- **WHEN** the system creates `working_tree_ref`
- **THEN** the stash SHA SHALL include all tracked changes and untracked files
- **AND** the working tree SHALL NOT be modified (stash create does not apply the stash)

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

#### Scenario: Auto-clean resets execution state on commit merged (clean tree)

- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **AND** `working_tree_ref` equals `commit` (no uncommitted changes were captured)
- **WHEN** auto-clean detects the merged commit
- **THEN** `.execution_state` SHALL be deleted (reset)
- **AND** the next run SHALL operate in first-run mode against base branch

#### Scenario: Commit merged but uncommitted changes present (dirty tree)

- **GIVEN** `.execution_state` exists with `commit: "abc123"`
- **AND** commit "abc123" is now an ancestor of the base branch
- **AND** `working_tree_ref` differs from `commit` (uncommitted changes were captured)
- **WHEN** auto-clean evaluates the context
- **THEN** auto-clean SHALL NOT fire
- **AND** `.execution_state` SHALL be preserved
- **AND** logs SHALL remain in place for the retry counter to function correctly

### Requirement: Runtime Usage Limit Detection
This requirement MUST record unhealthy adapters in the global unhealthy adapter state file rather than `.execution_state`.

The system MUST detect usage limits from actual review adapter output rather than from preflight health probes. When a review adapter returns output or throws an error that matches usage-limit patterns, the system SHALL mark the review as failed with an error status and record the adapter as unhealthy in the global unhealthy adapter state file.

#### Scenario: Usage limit detected in review output
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter returns output containing usage-limit text (e.g. "usage limit", "quota exceeded")
- **THEN** the review slot SHALL report `status: "error"` with a message indicating the usage limit
- **AND** the adapter SHALL be marked unhealthy in the global unhealthy adapter state file with reason "Usage limit exceeded"
- **AND** the system SHALL log that the adapter was marked unhealthy for 1 hour

#### Scenario: Usage limit detected in adapter exception
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error whose message matches usage-limit patterns
- **THEN** the review slot SHALL report `status: "error"` with the usage-limit message
- **AND** the adapter SHALL be marked unhealthy in the global unhealthy adapter state file

#### Scenario: Non-usage-limit error does not mark adapter unhealthy
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error that does not match usage-limit patterns (e.g. timeout, parse error)
- **THEN** the review slot SHALL report `status: "error"` as before
- **AND** the adapter SHALL NOT be marked unhealthy

### Requirement: Adapter Cooldown and Recovery
This requirement MUST read and clear cooldown state from the global unhealthy adapter state file rather than `.execution_state`.

Adapters marked as unhealthy SHALL be skipped for a 1-hour cooldown period. After the cooldown expires, the system SHALL attempt to use the adapter again. If the adapter's CLI binary is available, the unhealthy flag SHALL be cleared in the global unhealthy adapter state file.

#### Scenario: Adapter within cooldown period
- **GIVEN** adapter "claude" was marked unhealthy 30 minutes ago
- **WHEN** the system selects adapters for a review gate
- **THEN** "claude" SHALL be skipped (not included in healthy adapter list)
- **AND** the system SHALL log that "claude" is cooling down

#### Scenario: Adapter cooldown expired and binary available
- **GIVEN** adapter "claude" was marked unhealthy 2 hours ago
- **AND** the `claude` CLI binary is available on PATH
- **WHEN** the system selects adapters for a review gate
- **THEN** the system SHALL clear the unhealthy flag for "claude" in the global unhealthy adapter state file
- **AND** "claude" SHALL be included in the healthy adapter list

#### Scenario: Adapter cooldown expired but binary missing
- **GIVEN** adapter "claude" was marked unhealthy 2 hours ago
- **AND** the `claude` CLI binary is NOT available on PATH
- **WHEN** the system selects adapters for a review gate
- **THEN** "claude" SHALL remain excluded from the healthy adapter list
- **AND** the unhealthy flag SHALL NOT be cleared (binary missing is a separate issue)

#### Scenario: All adapters cooling down
- **GIVEN** all configured adapters are within their cooldown period
- **WHEN** the system selects adapters for a review gate
- **THEN** the gate SHALL return an error status with message including "no healthy adapters"

### Requirement: Run Interval Detection in Executor

The run-executor MUST support optional interval-based run throttling via a `checkInterval` option. When enabled, the executor loads global config and checks the interval internally.

#### Scenario: checkInterval enabled and interval not elapsed
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 5 minutes ago
- **WHEN** the executor starts
- **THEN** it SHALL return `{ status: "interval_not_elapsed", message: "..." }` immediately
- **AND** it SHALL NOT acquire a lock
- **AND** it SHALL NOT run any gates

#### Scenario: checkInterval enabled and interval elapsed
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 15 minutes ago
- **WHEN** the executor starts
- **THEN** it SHALL proceed with normal execution (lock acquisition, auto-clean, gates)

#### Scenario: checkInterval not provided (default false)
- **GIVEN** `executeRun()` is called without `checkInterval`
- **WHEN** the executor starts
- **THEN** it SHALL skip interval checking entirely
- **AND** it SHALL NOT load global config for interval purposes
- **AND** it SHALL proceed with normal execution

#### Scenario: No execution state file with checkInterval enabled
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** no `.execution_state` file exists
- **AND** the system cannot determine when the last run completed
- **WHEN** the executor starts
- **THEN** it SHALL treat this as "interval elapsed"
- **AND** it SHALL proceed with normal execution

#### Scenario: checkInterval enabled, interval elapsed - normal run proceeds
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** the interval has elapsed
- **WHEN** the executor completes
- **THEN** the result SHALL reflect the actual gate outcomes (passed, failed, etc.)
- **AND** the interval check SHALL have no effect on the final status

### Requirement: CLI Commands Do Not Check Interval

CLI commands (`run`, `check`, `review`) SHALL always execute immediately without interval checking. They do not pass `checkInterval: true` to the executor.

#### Scenario: Run command executes immediately
- **GIVEN** the user runs `agent-gauntlet run`
- **WHEN** the command executes
- **THEN** it SHALL NOT pass `checkInterval: true` to `executeRun()`
- **AND** the gauntlet SHALL run immediately regardless of last run time

#### Scenario: Stop-hook passes checkInterval
- **GIVEN** the stop-hook is invoked
- **WHEN** the stop-hook calls `executeRun()`
- **THEN** it SHALL pass `checkInterval: true` to the executor
- **AND** the executor SHALL load global config to get `run_interval_minutes`

### Requirement: Interval Check Precedes Other Operations

When interval checking is enabled, the executor SHALL check interval before acquiring a lock or running auto-clean.

#### Scenario: Interval check precedes lock acquisition
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **WHEN** the interval has not elapsed
- **THEN** the executor SHALL return `interval_not_elapsed` immediately
- **AND** it SHALL NOT attempt to acquire the lock
- **AND** it SHALL NOT check for auto-clean conditions
- **AND** no side effects SHALL occur

#### Scenario: Interval check precedes auto-clean
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** auto-clean would normally trigger (branch changed)
- **WHEN** the interval has not elapsed
- **THEN** the executor SHALL return `interval_not_elapsed`
- **AND** auto-clean SHALL NOT run

### Requirement: Adapter Health Tracking in Global State
The system MUST store unhealthy adapter cooldown state in a global state file located in the global config directory (default: `~/.config/agent-gauntlet/unhealthy_adapters.json`). Each entry is keyed by adapter name and contains the timestamp when the adapter was marked unhealthy and the reason. The global state file SHALL be used to determine adapter cooldown across projects.

#### Scenario: Global unhealthy adapter file structure
- **GIVEN** one or more adapters have been marked unhealthy
- **WHEN** the system writes the global unhealthy adapter state file
- **THEN** the file SHALL contain an `unhealthy_adapters` object
- **AND** each key in `unhealthy_adapters` SHALL be an adapter name (e.g. `"claude"`)
- **AND** each value SHALL contain `marked_at` (ISO 8601 timestamp) and `reason` (string)

#### Scenario: Global state file missing or invalid
- **GIVEN** the global unhealthy adapter state file does not exist or is invalid
- **WHEN** the system reads unhealthy adapter state
- **THEN** all adapters SHALL be considered healthy

#### Scenario: Global state directory override
- **GIVEN** the `GAUNTLET_GLOBAL_STATE_DIR` environment variable is set
- **WHEN** the system resolves the unhealthy adapter state path
- **THEN** it SHALL use that directory instead of the default global config directory

#### Scenario: Manual clean does not clear global adapter state
- **GIVEN** a project `clean` command runs
- **WHEN** the clean operation completes
- **THEN** the global unhealthy adapter state file SHALL remain intact


## MODIFIED Requirements

### Requirement: Automatic Rerun Detection
The `run`, `check`, and `review` commands MUST automatically detect whether to operate in first-run or rerun mode based on the presence of log files. Explicit flags (`--uncommitted`, `--commit`) override only the diff source; failure context injection is controlled solely by log presence. When a session reference exists, rerun mode SHALL use it to scope the review diff to fix-only changes.

The persistent `validation-metrics.json` snapshot and private telemetry lifecycle, receipt, and pending-delivery state SHALL NOT count as current validation logs for rerun detection or previous-failure lookup. Retained telemetry alone SHALL NOT activate rerun mode, alter diff selection, advance the log-derived retry count, or inject failure context.

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

#### Scenario: Rerun with no changes but all previous failures resolved
- **GIVEN** the log directory contains log files (rerun mode)
- **AND** all previous review violations have been addressed (status set to "fixed" or "skipped" in the review JSON files)
- **AND** no unresolved check or review failures remain (findPreviousFailures returns an empty list after filtering out "skipped" violations)
- **AND** no code changes have been made since the session ref
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL NOT report "No changes detected"
- **AND** if any review JSON file contains violations with status "skipped", the command SHALL report "Passed with warnings" and exit with code 0
- **AND** if no violations have status "skipped" (all were "fixed"), the command SHALL report "Passed" and exit with code 0, and logs SHALL be archived
- **NOTE** This handles the edge case where an agent skips all review violations without making code changes. Without this, the rerun would bail out with "No changes detected" and never reach a terminal status, leaving logs unarchived.

#### Scenario: Rerun with no changes and outstanding violations
- **GIVEN** the log directory contains log files (rerun mode)
- **AND** previous violations exist that have NOT been resolved (status remains "new" — not set to "fixed" or "skipped" in the review JSON files)
- **AND** no code changes have been made since the session ref
- **WHEN** the command executes without explicit diff flags
- **THEN** the command SHALL report "Failed" with a message indicating the number of outstanding violations (e.g. "No changes detected — 5 violation(s) still outstanding.")
- **AND** the command SHALL exit with a non-zero exit code
- **AND** log files SHALL remain in the log directory (no clean)
- **NOTE** Without this, the system would return "No changes detected" (success exit code 0) even though violations were outstanding, causing agents to believe the run passed. This was the root cause of verification mode false positives where violations were incorrectly reported as "Fixed".

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

#### Scenario: Closed-session telemetry remains without current logs
- **WHEN** a command starts after a session was cleaned and only the latest metrics snapshot or private telemetry state remains
- **THEN** retained telemetry does not activate rerun mode or inject previous failures
- **AND** first-run diff behavior and explicit diff overrides remain unchanged

#### Scenario: Pending delivery does not advance retries
- **WHEN** pending telemetry or delivery receipts coexist with ordinary current validation logs
- **THEN** only the ordinary validation logs influence existing retry numbering and previous-failure lookup

### Requirement: Auto-Clean on Retry Limit Exceeded

When the retry limit is exceeded, the system MUST automatically perform the log clean process to archive the session logs. The execution state file SHALL be preserved (not deleted) so that the next session can use `working_tree_ref` as a valid baseline for scoping changes. The clean operation SHALL use the project-configured `max_previous_logs` for rotation depth.

The final allowed invocation and its measured attempts SHALL be finalized before session-close telemetry is materialized, subject to the warning-and-degraded-history policy for failed persistence. Cleanup SHALL close the validation-metrics session without discarding unacknowledged delivery evidence. The next validation SHALL receive a new metrics-session identity while retaining existing execution-state baseline behavior. Telemetry MUST NOT change the retry limit, permitted number of dispatches, or terminal validation status.

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

#### Scenario: Exhausted retry remains measured after clean
- **WHEN** the final allowed invocation fails and its terminal telemetry is successfully recorded before auto-clean
- **THEN** the latest session snapshot includes that invocation's failure and measured usage along with earlier attempts
- **AND** unacknowledged evidence remains available for consumer export independently of historical log retention

### Requirement: Lock Acquisition Before Console Logging
The `run`, `check`, and `review` commands MUST acquire the run lock before starting console logging. This ensures that failed lock acquisitions do not create orphaned console log files.

An invocation identity SHALL still be allocated for a lock-rejected command, and its structured result SHALL report its own `lock_conflict` and zero-dispatch outcome. It MUST NOT modify the active command's shared metrics snapshot or claim that snapshot as its own publication. Unestablished session association or unavailable publication SHALL remain explicit.

#### Scenario: Lock acquisition fails - no console log created
- **GIVEN** another validator run is in progress (lock file exists)
- **WHEN** the user executes `agent-validate run`
- **THEN** the lock acquisition SHALL fail with an error message
- **AND** no console log file SHALL be created
- **AND** the command SHALL exit with a non-zero exit code

#### Scenario: Lock acquisition succeeds - console log created
- **GIVEN** no validator run is in progress (lock file does not exist)
- **WHEN** the user executes `agent-validate run`
- **THEN** the lock SHALL be acquired first
- **AND** the console log file SHALL be created after lock acquisition
- **AND** the command SHALL proceed normally

#### Scenario: Lock conflict has independent invocation identity
- **WHEN** a concurrent command is rejected by the run lock
- **THEN** its result identifies a distinct invocation, the lock-conflict outcome, and confirmed absence of model dispatch
- **AND** the lock owner's snapshot and invocation identity are unchanged

<!-- deferred-to-design: Define safely isolated recording/export of lock-rejected consumer-correlated invocations without altering the active session snapshot; unavailable persistence must not masquerade as a recorded zero-dispatch marker. -->

## ADDED Requirements

### Requirement: Validation telemetry session lifecycle

Validator SHALL establish and persist a telemetry-session identity for the initial validation and subsequent invocations belonging to the same active validation session. Retries across processes SHALL retain that identity and append invocation/attempt history rather than overwrite earlier measurements. Cleaning the active session SHALL finalize its telemetry and persist a closed boundary; subsequent validation SHALL establish a new session identity even if no ordinary logs were present at closure. Pending delivery of closed-session evidence SHALL not keep that validation session open.

Invocation terminal state and session closure SHALL be distinct: an invocation that returns while its session remains active does not close that session merely by returning. Telemetry SHALL observe existing clean decisions, not add new cleanup triggers or change validation policy. If persisted evidence cannot establish session history or association, those limitations SHALL remain explicit rather than reconstructing complete metrics from console logs or guessing identities.

#### Scenario: Failed run is retried in another process
- **WHEN** a failed invocation leaves its active session logs and a later process retries validation
- **THEN** the new invocation retains the active session ID, receives a new invocation ID, and appends any newly dispatched attempts without replacing prior failures

#### Scenario: Early return leaves an active session open
- **WHEN** an invocation returns without dispatch and existing validation policy leaves its active session uncleaned
- **THEN** the invocation records its terminal outcome and empty attempt set while the session remains available for later invocations

#### Scenario: Clean establishes the next session boundary
- **WHEN** manual or existing automatic cleanup closes an active validation session
- **THEN** the next validation establishes a new session ID while old pending delivery retains its original session and invocation identities

#### Scenario: Session closes without ordinary logs
- **WHEN** an active telemetry session exists and cleanup is requested with no ordinary current logs
- **THEN** the session-close boundary still applies and the next validation does not append to the closed session

#### Scenario: Earlier telemetry history cannot be established
- **WHEN** a retry has validation context but its earlier telemetry history is unavailable
- **THEN** validation continues with explicit history limitations and does not fabricate missing attempts or complete session totals

### Requirement: Invocation recording across all validation exits

Every `run`, `review`, and `check` execution SHALL receive its invocation identity before any early result can be returned. The invocation SHALL record its command, applicable session association, originating consumer context when supplied, status, timestamps, attempt set, and applicable aggregates/completeness. Controlled terminal paths SHALL finalize that invocation even when no review was dispatched, subject to explicit telemetry persistence limitations.

No changes, trusted reconciliation, no applicable gates, checks-only execution, configuration errors, and other pre-dispatch outcomes SHALL NOT reuse an earlier invocation's measurements. A failure before session or storage resolution SHALL still expose invocation identity and available facts in the structured result without inventing a durable artifact. Consumer export SHALL distinguish recorded zero-dispatch evidence from an invocation whose evidence could not be persisted.

#### Scenario: Trusted snapshot exits before gates
- **WHEN** reconciliation returns `trusted` without running gates
- **THEN** the command has a new invocation identity and a terminal zero-dispatch record when persistence is available
- **AND** existing trusted status and exit behavior are unchanged

#### Scenario: No changes or no applicable gates
- **WHEN** a validation command exits with `no_changes` or `no_applicable_gates` before model dispatch
- **THEN** its invocation records that outcome and an empty attempt set rather than presenting prior session usage as new work

#### Scenario: Checks-only command completes
- **WHEN** `check` executes shell checks but no model-backed reviews
- **THEN** the invocation records its actual validation outcome with zero model attempts rather than adding check activity as model usage

#### Scenario: Configuration error occurs before storage resolution
- **WHEN** a validation command fails to load usable configuration before telemetry storage or session association can be established
- **THEN** its structured error result retains its new invocation ID and known dispatch state with explicit unavailable session/publication metadata
- **AND** no earlier snapshot is claimed as evidence for that invocation

### Requirement: Dispatch lifecycle preserves failed and interrupted work

Each actual adapter dispatch SHALL allocate a new model attempt under its originating invocation, persist initial evidence before dispatch when possible, and retain evidence through success, review failure, adapter error, timeout, and controlled interruption. Controlled terminal outcomes SHALL finalize the same attempt before the invocation summary is finalized. Uncontrolled interruption SHALL leave already persisted attempts intact and incomplete; later execution SHALL NOT relabel them as successful or reuse their IDs for new work.

#### Scenario: Adapter failure follows partial usage
- **WHEN** a review adapter fails after reporting partial usage
- **THEN** invocation finalization retains the failed attempt and its known usage rather than dropping it from the invocation aggregate

#### Scenario: Parallel dispatches finish independently
- **WHEN** parallel reviews complete with different outcomes
- **THEN** invocation finalization preserves each attempt independently and derives the summary from the distinct attempts

#### Scenario: Retry follows process interruption
- **WHEN** a process is interrupted after initial attempt evidence is persisted and a later validation retries the work
- **THEN** the earlier attempt remains identifiable and incomplete while the actual new dispatch receives a distinct attempt ID

### Requirement: Telemetry preserves review scheduling and preservation policy

Telemetry SHALL NOT change existing gate selection, adapter eligibility, multi-review skip rules, safety-latch dispatches, one-shot suppression, or retry policy. Only actual adapter dispatches SHALL create model attempts. Results synthesized from earlier review JSON MAY retain historical attempt references when available, but SHALL NOT create new consumption or relocate the earlier attempt to the current invocation.

#### Scenario: Previously passed slot is skipped
- **WHEN** existing multi-review policy skips a passed slot while another slot runs
- **THEN** only the dispatched slot creates a new model attempt and the skip decision/result behavior is unchanged

#### Scenario: Safety latch dispatches a reviewer
- **WHEN** existing policy dispatches a review slot because all slots previously passed
- **THEN** that actual dispatch creates a new attempt without changing which slot the policy selected

#### Scenario: One-shot result is preserved
- **WHEN** a one-shot gate is synthesized from prior review evidence without dispatch
- **THEN** it retains existing findings, status, and per-iteration reporting behavior without adding a model attempt or new usage

#### Scenario: One-shot error permits real redispatch
- **WHEN** existing one-shot policy dispatches again because prior review JSON is erroneous or unparseable
- **THEN** the new dispatch receives a new attempt ID and any recorded prior attempt remains historical evidence

### Requirement: Additive structured results and telemetry failure isolation

Structured validation results SHALL add invocation identity, established session identity, resolvable artifact location, telemetry publication/completeness metadata, and actual review-attempt references without changing existing validation-result fields or semantics. Validation status, exit codes, findings, retry behavior, console status/report behavior, and `--report` output SHALL remain compatible. Additional telemetry warnings SHALL not become review violations or change a passing validation to a failed validation or `passed_with_warnings` gate outcome.

Telemetry persistence/finalization failures SHALL be surfaced as warnings and explicit degraded metadata, not silently reported as successful durable publication. These warnings SHALL NOT prevent otherwise permitted validation or overwrite the original validation error. Metrics export/acknowledgment commands retain their own operational failure semantics as specified by `nested-metrics-handoff`.

#### Scenario: Validation passes but metrics publication fails
- **WHEN** all applicable validation work passes and telemetry publication fails
- **THEN** validation retains its passing status and existing exit code while surfacing a telemetry warning and unavailable/degraded publication metadata

#### Scenario: Validation fails and metrics finalization also fails
- **WHEN** a gate fails and recording terminal telemetry fails independently
- **THEN** the original validation failure remains authoritative and the telemetry failure is reported separately

#### Scenario: Existing report consumer runs validation
- **WHEN** a caller uses `run --report` with telemetry enabled
- **THEN** existing report content and exit semantics remain compatible and the caller is not required to parse added telemetry from report text

#### Scenario: Programmatic caller receives measured review results
- **WHEN** model reviews execute and structured results are returned
- **THEN** the result includes invocation/session/publication metadata and actual attempt references in addition to the existing gate result information

<!-- deferred-to-design: Define additive result fields and publication diagnostics for all controlled early exits without changing existing report text. -->

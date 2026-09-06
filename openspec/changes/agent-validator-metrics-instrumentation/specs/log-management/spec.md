## MODIFIED Requirements

### Requirement: Run-Numbered Log Filenames
The Logger MUST write log files with a dot-separated run-number suffix. The run number for a given execution SHALL be one greater than the highest run-number suffix found across ALL log files in the log directory (regardless of job ID, adapter, or gate type). This ensures all gates in a single invocation share the same run number. For review gates with multiple reviews, the review index is the 1-based position in the round-robin dispatch order and SHALL be included in the filename using `@` as the delimiter between adapter name and index, to avoid ambiguity with adapter names that contain hyphens (e.g., `github-copilot`).

The latest metrics snapshot and private telemetry lifecycle, receipt, and pending-delivery files SHALL be excluded from log run-number discovery. Historical telemetry identifiers and delivery revisions SHALL NOT advance the ordinary run-number suffix.

#### Scenario: First run with no existing logs
- **GIVEN** the log directory exists and contains no `.log` files
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.1.log`

#### Scenario: Subsequent run with existing logs
- **GIVEN** the log directory contains `check_src_test.1.log`
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.2.log`

#### Scenario: Single review (review index)
- **GIVEN** a review gate with `num_reviews: 1` using adapter "claude"
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_claude@1.1.log`
- **AND** the JSON file SHALL be named `review_src_claude@1.1.json`

#### Scenario: Multiple reviews from different adapters
- **GIVEN** a review gate with `num_reviews: 2` using adapters "claude" and "gemini"
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log` and `review_src_gemini@2.1.log`
- **AND** the JSON files SHALL follow the same pattern

#### Scenario: Multiple reviews from same adapter (round-robin)
- **GIVEN** a review gate with `num_reviews: 3` and only "claude" is healthy
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log`, `review_src_claude@2.1.log`, and `review_src_claude@3.1.log`

#### Scenario: Adapter name with hyphens
- **GIVEN** a review gate using adapter "github-copilot" with review index 1
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_github-copilot@1.1.log`
- **AND** the review index is unambiguously the digits after `@`

#### Scenario: Run number shared across all gates
- **GIVEN** the log directory contains `check_src_test.1.log`, `review_src_claude@1.1.log`, and `review_src_gemini@2.1.log`
- **WHEN** the Logger writes logs for a new execution
- **THEN** the run number SHALL be 2 for ALL gates (checks and reviews alike)

#### Scenario: Run number stable across adapter changes
- **GIVEN** the log directory contains `review_src_codex@1.1.log` from a previous run where codex was healthy
- **AND** codex is now unavailable and claude is assigned to slot 1
- **WHEN** the Logger writes logs for the new run
- **THEN** the run number SHALL be 2 (based on the global max of 1)
- **AND** the filename SHALL be `review_src_claude@1.2.log`

#### Scenario: Filename pattern structure
- **GIVEN** a job with sanitized ID "my_job", adapter "gemini", and review index 2
- **WHEN** the Logger constructs the log path
- **THEN** the filename SHALL follow the pattern `<sanitized-job-id>_<adapter>@<review-index>.<run-number>.log` for review gates
- **AND** `<sanitized-job-id>.<run-number>.log` for check gates (unchanged)
- **AND** the run number is always the last dot-separated segment before the extension
- **AND** the run number is derived from the highest run-number suffix across all log files in the directory
- **AND** the review index is parsed as the digits immediately following `@` in the filename

#### Scenario: Telemetry does not affect log numbering
- **WHEN** telemetry snapshots or private delivery records remain after ordinary current logs were cleaned
- **THEN** the next ordinary log uses the existing first-run numbering behavior, irrespective of telemetry IDs or revisions

### Requirement: Configurable Log Rotation Depth

The system MUST support configurable N-deep log rotation via the `max_previous_logs` field in `.validator/config.yml` (default: 3). Archived sessions are stored in logrotate-style directories: `previous/` (most recent), `previous.1/`, `previous.2/`, etc. The oldest directory beyond the configured count is evicted when a clean operation creates a new session archive.

A finalized session's historical metrics copy SHALL follow the same archive retention as its ordinary logs. The persistent latest snapshot and unacknowledged delivery evidence SHALL NOT be subject to this historical rotation depth. At depth zero, cleanup SHALL retain the latest snapshot and pending delivery evidence without creating a new historical metrics archive. An already-closed snapshot or pending evidence alone SHALL NOT cause a new archive rotation.

#### Scenario: Default rotation depth

- **GIVEN** `max_previous_logs` is not specified in the config
- **WHEN** the system reads the configuration
- **THEN** the default value SHALL be 3

#### Scenario: Rotation with default depth (3)

- **GIVEN** `max_previous_logs` is 3
- **AND** `previous/`, `previous.1/`, and `previous.2/` all exist
- **AND** ordinary current logs require archival
- **WHEN** the log clean process runs
- **THEN** `previous.2/` SHALL be deleted (evicted as the oldest)
- **AND** `previous.1/` SHALL be renamed to `previous.2/`
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** current logs SHALL be moved into the new `previous/`

#### Scenario: Rotation with depth 1 (pre-existing behavior)

- **GIVEN** `max_previous_logs` is 1
- **AND** `previous/` exists with files
- **AND** ordinary current logs require archival
- **WHEN** the log clean process runs
- **THEN** `previous/` SHALL be deleted
- **AND** a new `previous/` SHALL be created
- **AND** current logs SHALL be moved into the new `previous/`

#### Scenario: Rotation with depth 0 (no archiving)

- **GIVEN** `max_previous_logs` is 0
- **WHEN** the log clean process runs
- **THEN** current logs SHALL be deleted (not archived)
- **AND** no `previous/` directory SHALL be created or modified

#### Scenario: Invalid max_previous_logs value

- **GIVEN** `max_previous_logs` is set to a negative number or non-integer value in the config
- **WHEN** the system reads the configuration
- **THEN** schema validation SHALL reject the value with an error
- **AND** the `max_previous_logs` field SHALL be constrained to non-negative integers by the Zod schema

#### Scenario: Missing intermediate directories

- **GIVEN** `max_previous_logs` is 3
- **AND** `previous/` exists but `previous.1/` does not exist
- **AND** ordinary current logs require archival
- **WHEN** the log clean process runs
- **THEN** the rename of `previous.1/` to `previous.2/` SHALL be skipped (no error)
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** current logs SHALL be moved into the new `previous/`

#### Scenario: Historical metrics rotate with their session
- **WHEN** cleanup creates a new session archive at nonzero retention depth
- **THEN** the closed session's immutable metrics copy is retained alongside its archived logs and rotates or is evicted with that archive

#### Scenario: Depth zero preserves latest and pending evidence
- **WHEN** cleanup runs with `max_previous_logs: 0` for a session containing unacknowledged measurements
- **THEN** ordinary current logs are deleted without creating a new archive
- **AND** the latest session snapshot and pending evidence remain available
- **AND** existing historical directories are not newly rotated or removed by the depth-zero operation

### Requirement: Log Clean Process

The system MUST support a log clean operation that archives current logs using configurable N-deep rotation into `previous/` subdirectories. The clean operation SHALL preserve persistent state files (`.execution_state`, `.debug.log`, `.debug.log.1`), the latest `validation-metrics.json` snapshot, and private telemetry lifecycle, receipt, and pending-delivery state. It SHALL be a no-op if the log directory does not exist, or if there are neither ordinary current logs nor an active telemetry session requiring closure. An active telemetry session SHALL be closed even if no ordinary logs exist. The latest snapshot and private telemetry state SHALL NOT themselves count as ordinary current logs. The rotation depth is controlled by the `max_previous_logs` configuration field (default: 3).

Every existing cleanup caller SHALL use this same session-close coordinator and explicitly resolved project retention depth: manual clean, `skip`, run/check/review success, retry-limit cleanup, and context-change cleanup. The coordinator SHALL resolve/freeze depth from loaded project configuration; the default applies only when configuration omits it, not when a caller forgets to pass it. `skip` SHALL close an active telemetry session before advancing the baseline while retaining pending evidence; it SHALL NOT create a validation invocation or model attempt. Subsequent validation SHALL begin a new session.

#### Scenario: Skip closes an active measured session
- **WHEN** the user advances the baseline with `skip` while a telemetry session is active
- **THEN** cleanup closes that session under the run lock using configured retention and preserves pending delivery
- **AND** skip creates no validation/model consumption record, and the next validation receives a new session ID

#### Scenario: Check or review uses zero configured retention
- **WHEN** successful check or review triggers cleanup with `max_previous_logs: 0`
- **THEN** closure freezes depth zero rather than a helper default, creates no archive, and leaves preexisting archives untouched
- **AND** latest and pending measurements survive

#### Scenario: Clean with existing previous logs

- **GIVEN** `previous/` and `previous.1/` subdirectories exist and contain files
- **AND** the log directory root contains ordinary current `.log` or `.json` files
- **AND** `max_previous_logs` is 3
- **WHEN** the log clean process runs
- **THEN** `previous.2/` SHALL be deleted if it exists (evict oldest)
- **AND** `previous.1/` SHALL be renamed to `previous.2/`
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** all ordinary current `.log` and `.json` files in the log directory root SHALL be moved into the new `previous/`, excluding persistent telemetry and other protected state
- **AND** `.execution_state` SHALL remain in place (NOT moved)
- **AND** `.debug.log` and `.debug.log.1` SHALL remain in place

#### Scenario: Clean with no previous directory

- **GIVEN** no `previous/` subdirectory exists
- **AND** the log directory root contains ordinary current `.log` or `.json` files
- **AND** historical retention is nonzero
- **WHEN** the log clean process runs
- **THEN** the `previous/` directory SHALL be created
- **AND** all ordinary current `.log` and `.json` files in the log directory root SHALL be moved into `previous/`, excluding persistent telemetry and other protected state
- **AND** `.execution_state` SHALL remain in place (NOT moved)

#### Scenario: Clean with empty log directory

- **GIVEN** no ordinary current `.log` or `.json` files exist in the log directory root
- **AND** no active telemetry session requires closure
- **WHEN** the log clean process runs
- **THEN** the process SHALL complete successfully with no file operations
- **AND** existing `previous/` and `previous.N/` subdirectory contents SHALL NOT be modified

#### Scenario: Clean when log directory does not exist

- **GIVEN** the log directory does not exist
- **WHEN** the log clean process runs
- **THEN** the process SHALL complete successfully with no file operations
- **AND** no directories SHALL be created

#### Scenario: Clean preserves debug log

- **GIVEN** the log directory contains `.debug.log` and/or `.debug.log.1`
- **WHEN** the log clean process runs
- **THEN** `.debug.log` SHALL remain in place
- **AND** `.debug.log.1` SHALL remain in place (if it exists)

#### Scenario: Active session without ordinary logs is closed
- **WHEN** cleanup finds an active telemetry session but no ordinary current logs
- **THEN** it finalizes and records the session-close boundary, publishes the latest snapshot, and writes the session's historical metrics copy if retention is nonzero
- **AND** protected pending evidence is retained

#### Scenario: Repeated clean of a closed session is a no-op
- **WHEN** cleanup runs again after successful session closure with no new ordinary logs or active session
- **THEN** it does not duplicate the session archive, rotate historical directories, or delete the latest snapshot or pending evidence

### Requirement: Auto-Clean on Success

When all gates pass (exit code 0), the system MUST automatically perform the log clean process before exiting. The clean operation SHALL use the project-configured `max_previous_logs` for rotation depth.

When the existing success path triggers cleanup, terminal invocation and attempt evidence SHALL be finalized before session-close telemetry is materialized, subject to the warning-and-degraded-history policy. The closed session's latest snapshot SHALL remain discoverable after cleanup, and pending delivery SHALL remain available independently of historical retention. This requirement SHALL NOT extend automatic cleanup to other successful early-return or warning paths that do not already trigger cleanup; retry-limit cleanup remains governed by `run-lifecycle`.

#### Scenario: All gates pass

- **GIVEN** a run has completed with all gates passing
- **WHEN** the runner reports success
- **THEN** the log clean process SHALL execute automatically with the configured rotation depth
- **AND** the process SHALL exit with code 0

#### Scenario: Some gates fail

- **GIVEN** a run has completed with one or more gate failures
- **AND** the retry limit has not been exhausted
- **WHEN** the runner reports failure
- **THEN** the log clean process SHALL NOT execute
- **AND** log files SHALL remain in the log directory root for the next rerun

#### Scenario: Successful auto-clean retains terminal measurements
- **WHEN** the ordinary success path automatically cleans a session whose telemetry was successfully persisted
- **THEN** the retained latest snapshot contains its final invocation outcome and attempt measurements
- **AND** unacknowledged revisions remain retrievable through the metrics CLI

### Requirement: Clean CLI Command
The system MUST provide an `agent-validate clean` CLI command that performs the log clean process on demand.

This command SHALL perform the same telemetry-session closure and protected-state preservation as automatic cleanup. Ordinary `clean` SHALL NOT acknowledge consumer delivery or act as explicit discard of pending evidence.

#### Scenario: User runs clean command
- **GIVEN** a `.validator/config.yml` exists with a configured `log_dir`
- **WHEN** the user executes `agent-validate clean`
- **THEN** the log clean process SHALL execute using the configured `log_dir`

#### Scenario: Clean command with no config
- **GIVEN** no `.validator/config.yml` exists in the working directory
- **WHEN** the user runs `agent-validate clean`
- **THEN** the command SHALL use the default log directory (`validator_logs`)

#### Scenario: Manual clean preserves pending delivery
- **WHEN** the user invokes ordinary `clean` while telemetry is unacknowledged
- **THEN** cleanup retains pending evidence without recording consumer acknowledgment or explicit discard

### Requirement: JSON Review Result Files
The review gate MUST write a structured JSON file for each adapter's review result alongside the markdown log file.

Result artifacts for actual model dispatches SHALL additionally reference the stable telemetry attempt ID. Review JSON remains mutable review evidence under its existing schema and lifecycle; its raw review output SHALL NOT be copied into metrics evidence. Missing or invalid review-result JSON SHALL NOT erase a separately recorded model attempt or its usage. Synthesized skipped/preserved results SHALL not fabricate a new attempt reference for work that did not occur; any reference retained from prior evidence remains historical.

#### Scenario: JSON file generation
- **WHEN** a review adapter completes execution
- **THEN** the system SHALL write a `.json` file with the same base name as the log file (e.g., `review_src_claude.1.json` alongside `review_src_claude.1.log`)
- **AND** the JSON file SHALL contain the adapter name, timestamp, status, raw LLM output, and violations array

#### Scenario: JSON schema for violations
- **WHEN** a violation is recorded in the JSON file
- **THEN** the violation object SHALL include a `status` field with initial value `"new"`
- **AND** the violation object SHALL include `file`, `line`, `issue`, `priority`, and optional `fix` fields
- **AND** the violation object MAY include a `result` field (initially null) for fix descriptions

#### Scenario: Invalid JSON output
- **WHEN** the reviewer LLM produces output that cannot be parsed as valid JSON
- **THEN** the system SHALL log an error indicating JSON parsing failed
- **AND** the system SHALL NOT write an incomplete JSON file
- **AND** the gate SHALL report an error status

#### Scenario: Missing required fields
- **WHEN** the reviewer LLM produces valid JSON but violations are missing required fields (`file`, `issue`, or `priority`)
- **THEN** the system SHALL log a warning indicating which fields are missing
- **AND** the malformed violation SHALL be excluded from the results

#### Scenario: Review artifact references its actual attempt
- **WHEN** an actual review dispatch produces a result artifact
- **THEN** the artifact identifies its telemetry attempt in addition to the existing review fields

#### Scenario: Invalid review output retains separate telemetry
- **WHEN** model usage was observed but the review response cannot be parsed into a valid result
- **THEN** the review continues to report its existing error outcome while separately persisted attempt telemetry retains the observed usage and failure evidence

#### Scenario: Preserved review creates no new measurement
- **WHEN** existing one-shot or passed-slot behavior writes a synthesized per-iteration result without dispatch
- **THEN** no new model attempt is created, and any prior attempt reference remains a reference to historical work

## ADDED Requirements

### Requirement: Atomic latest-session snapshot publication

Validator SHALL retain `<log_dir>/validation-metrics.json` as the latest successfully published session snapshot independently of ordinary review-log cleanup and historical retention. Each replacement SHALL be atomic so readers observe a complete prior snapshot or a complete new snapshot, never torn JSON. A later session MAY replace the fixed latest snapshot; pending evidence from an older session remains governed by acknowledgment/discard rather than that replacement.

The snapshot SHALL identify its session, invocation context, lifecycle state, and completeness. Publication failure SHALL not represent an older snapshot as the current invocation's successful publication, and the result SHALL surface the applicable warning/degraded metadata without changing validation outcome.

#### Scenario: Reader overlaps a snapshot update
- **WHEN** a reader opens the fixed metrics path while Validator replaces its snapshot
- **THEN** the reader observes complete old or complete new JSON rather than a partially written artifact

#### Scenario: New session replaces latest without losing pending history
- **WHEN** a new session publishes a snapshot while an older session still has unacknowledged evidence
- **THEN** the fixed path may identify the new session and the older evidence remains exportable under its original context

#### Scenario: Snapshot replacement fails
- **WHEN** publishing an updated latest snapshot fails
- **THEN** any previously valid snapshot is not presented as successful publication for the new invocation
- **AND** the failure is surfaced without changing the validation result

### Requirement: Recoverable session closure and immutable archive

Session closure SHALL finalize the session with the evidence actually recorded, write an immutable historical metrics copy into that session's archive when retention is nonzero, publish the fixed latest-session snapshot, and persist the closed-session boundary used to allocate the next validation session. Finalized history SHALL retain known failed/interrupted attempts and explicit limitations; closure MUST NOT fabricate missing terminal evidence.

The overall close transition SHALL be recoverable across interruption: persisted closure evidence SHALL allow recovery without archiving the same session repeatedly, losing protected pending evidence, or attaching new validation work to a session already closed. A session's historical metrics copy SHALL retain its original identities and as-of-closure measurements; subsequent acknowledgment or replay SHALL not rewrite that archived measurement history. A session with no ordinary logs is still eligible for closure and, when enabled, a metrics-only archive.

A metrics-only session archive SHALL consume one ordinary historical rotation slot at nonzero retention, with the same eviction rules as an archive containing review logs. Depth zero SHALL create no such archive and SHALL leave preexisting historical directories untouched. Repeated cleanup after the closed boundary SHALL not consume another slot.

#### Scenario: Metrics-only closure uses one rotation slot
- **WHEN** an active measured session has no ordinary logs and closes with nonzero historical retention
- **THEN** exactly one metrics-only archive participates in the configured rotation, including normal oldest-archive eviction
- **AND** repeating cleanup without a new active session performs no additional rotation

Guarantees apply to successfully persisted evidence. If closure persistence fails, Validator SHALL warn and expose incomplete publication/history rather than claim a fully durable close. Telemetry write failures SHALL NOT change validation outcomes, and recovery MUST NOT invent history when evidence is insufficient.

#### Scenario: Session closure archives complete known history
- **WHEN** a session closes at nonzero retention after several invocations and failed or successful attempts
- **THEN** the session archive receives one immutable metrics copy of its known history and limitations
- **AND** the fixed latest snapshot identifies the closed session and its final invocation
- **AND** the next validation session receives a different session ID

#### Scenario: Closure is interrupted after archive publication
- **WHEN** a process is interrupted after persisting the session's historical metrics copy but before completing the remaining close transition
- **THEN** recovery uses the persisted session identity and closure evidence to avoid creating a second archive or performing the same historical rotation twice
- **AND** protected pending evidence remains available with original attribution

Closure SHALL use a persisted transaction identity and frozen session/revision and ordinary-file/archive inventory before destructive rotation. The transition SHALL stage moves at transaction-specific locations, retain recoverable operation identities, and reconcile unfinished operations before associating new validation work. Recovery SHALL NOT repeat the ordinary rotation loop against already shifted archives or use a fresh wildcard inventory that could capture newer files. The historical metrics copy SHALL contain the frozen as-of-close measurements.

Manual and automatic closure SHALL coordinate under the validation run lock. Short telemetry metadata transactions SHALL separately serialize recording and receipt/disposition changes without holding that metadata lock throughout model execution or bulk archive movement. A durable closing boundary SHALL prevent new work from joining the closing session. If storage prevents safe recovery, Validator SHALL preserve known evidence, skip unsafe replay, and expose unavailable/degraded association while permitting otherwise allowed validation; it SHALL NOT guess a complete history or change validation outcome because of telemetry failure.

Closure recovery SHALL NOT be a prerequisite for metrics export or acknowledgment against intact committed delivery state. Closure staging and recovery SHALL preserve independently accessible delivery records/receipts and SHALL merge current delivery dispositions when committing metadata, rather than overwrite acknowledgment state from a frozen closure snapshot.

#### Scenario: Delivery is acknowledged before archive recovery finishes
- **WHEN** a consumer exports and acknowledges committed evidence while closure remains unfinished
- **THEN** those metrics operations require no new validation or clean invocation
- **AND** later closure recovery preserves the acknowledgment without replaying the records as newly pending work

#### Scenario: Recovery encounters conflicting file evidence
- **WHEN** an interrupted closure's frozen file identities no longer match files found during recovery
- **THEN** recovery reports the conflict and does not overwrite or delete files by guessing that they belong to the old closure
- **AND** unavailable/degraded telemetry is explicit without turning the telemetry failure into a validation failure

#### Scenario: Interruption occurs before the closed boundary is fully published
- **WHEN** durable closure evidence exists but interruption prevents all close operations from finishing
- **THEN** recovery resolves that closure before assigning new work and does not append new attempts to the closed session

#### Scenario: Acknowledgment does not rewrite historical measurements
- **WHEN** a consumer acknowledges or replays exported revisions from an archived session
- **THEN** the historical metrics copy is unchanged and only applicable delivery state may change

#### Scenario: Closing interrupted work preserves uncertainty
- **WHEN** a session closes with attempts lacking observed terminal usage
- **THEN** its latest and historical snapshots retain those incomplete attempts without inventing successful completion or zero usage

#### Scenario: Storage cannot complete closure
- **WHEN** a telemetry archive, snapshot, or boundary write fails during closure
- **THEN** the failure is reported as a telemetry warning/degraded state without changing validation outcome
- **AND** retained evidence is not falsely described as a fully completed durable close

### Requirement: Independent protected delivery retention

Ordinary cleanup and historical rotation SHALL preserve private pending-delivery evidence and the lifecycle/receipt state needed to export and acknowledge it safely. This preservation SHALL apply at every historical retention depth and to manual and automatic cleanup, including existing context-change cleanup. Resetting validation execution state SHALL NOT discard another session's pending measurements.

Only acknowledgment of the applicable exported revisions or explicit user-directed discard SHALL permit release of pending delivery evidence as specified by `nested-metrics-handoff`. A receipt for an earlier revision MUST NOT release a later update during concurrent cleanup. The latest snapshot, historical copies, and pending evidence SHALL remain distinct retention concerns: retaining one is not proof that another was delivered.

Private storage paths remain an implementation detail; a hidden filename by itself is not a preservation guarantee. These requirements do not protect against external deletion or disk loss.

#### Scenario: Historical session is evicted before acknowledgment
- **WHEN** ordinary archive rotation evicts a session with unacknowledged measurements
- **THEN** the historical copy may be removed but the pending evidence and required delivery state remain retrievable through Validator's metrics CLI

#### Scenario: Context change resets execution state
- **WHEN** existing validation policy cleans logs and resets execution state because the project context changed
- **THEN** pending measurements retain their original session and consumer context and are not discarded by that reset

#### Scenario: Cleanup overlaps acknowledgment of an older revision
- **WHEN** cleanup occurs while a receipt for an earlier attempt revision is acknowledged and a newer revision remains pending
- **THEN** the newer revision remains exportable and the combined operations do not acknowledge or delete it

#### Scenario: Ordinary cleanup cannot serve as explicit discard
- **WHEN** the user invokes ordinary cleanup rather than the explicit discard operation
- **THEN** pending delivery evidence remains protected and no successful-delivery or user-discard assertion is recorded

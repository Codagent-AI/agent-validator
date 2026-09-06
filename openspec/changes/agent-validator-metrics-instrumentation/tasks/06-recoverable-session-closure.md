# Task: Integrate recoverable session closure across every cleanup path

## Goal

Close and rotate measured sessions safely through interruption while preserving delivery independently, and complete the real CLI retry and recovery journeys.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Implement the close coordinator and recovery journal under `src/metrics/` and replace ordinary rotation at `src/commands/shared.ts` with its production transition. Route `src/commands/clean.ts`, `skip.ts`, `detect.ts`, `gate-command.ts`, `gate-command-support.ts`, `src/core/run-executor.ts`, `run-executor-helpers.ts`, and startup reconciliation through the same coordinator. Inspect every `cleanLogs`/`performAutoClean` caller, `src/utils/execution-state.ts`, `src/output/logger.ts` and log-parser predicates. Required interfaces are the real recorder/store, non-exiting finalization owners, measured adapters and public metrics CLI; tests use those interfaces without faking the Validator product. Add filesystem/caller coverage in `test/metrics/` and `test/commands/`, and the representative public journeys in `test/integration/`.

Read design “Recoverable session closure,” “Command orchestration,” “Private storage, commits, and concurrency,” and Migration Plan. Build the closure implementation together with its actual caller cutover; do not leave a separate unused archive implementation. Use only existing cleanup triggers. The shared finalization owner must finish known attempt and invocation outcomes before close materialization; trusted/no-change/warning paths that currently retain logs must not acquire new cleanup behavior.

Under the run lock freeze session/revisions, snapshot digest, a collision-resistant `close_id`, configured retention depth, ordinary-file/archive inventories and transaction-owned staging destinations; durably mark closing under a short metadata lock before destructive work. Persist required file/directory flushes. Stage on the same filesystem under `.metrics/closures/<close-id>/`, with recoverable identities/preconditions for each move/install/eviction. Nonzero depth installs exactly one immutable as-of-close metrics archive and rotates older ones; depth zero deletes only inventoried ordinary files and leaves all preexisting archives untouched. Journal progress, atomically publish latest, then commit closed boundary. Recognize a move/install completed before its phase marker; never repeat the old rotate loop against already shifted archives or sweep a fresh wildcard inventory.

Manual clean, skip, run/check/review success, retry-limit and context-change cleanup all use the explicitly resolved loaded `max_previous_logs`, including zero. Fix both depth-dropping sites: the success-path `cleanLogs(config.project.log_dir)` in `src/commands/gate-command.ts` and `autoCleanIfNeeded()` → `performAutoClean(logDir, result)` in `src/commands/detect.ts`. Thread loaded retention through detect’s helpers. Its existing context-change cleanup must enter the same coordinator under the run lock without introducing a validation invocation/model attempt for detect. Exercise every context-change entry point: `src/core/run-executor.ts` `handleAutoClean`, `src/commands/gate-command.ts` `handleAutoClean`, and `src/commands/detect.ts` `autoCleanIfNeeded`. This is coverage of the approved existing context-change cleanup behavior, not a new cleanup trigger. Freeze that value into the journal; later config changes do not affect recovery. `skip` closes before advancing the baseline and creates no validation invocation/attempt. Preserve execution-state baseline/reset rules and existing debug/run-lock files. Active sessions with no ordinary logs close and consume one normal archive slot at nonzero depth; closed-only snapshots/pending state do not rotate, increment retries or reopen a session. Missing/empty directories remain existing no-ops when no active session needs closure; old unmeasured logs still rotate without manufactured history.

Recover under the run lock before normal session association/log writing. Never join a closing session. Conflict or failed required persistence preserves evidence and warns/degrades session association/publication, skipping unsafe replay while permitting otherwise allowed validation; do not alter its verdict or claim a fully durable close. Validate frozen identities on retries so newer logs cannot be deleted as old inventory. Acknowledgment cannot mutate immutable archived measurements.

Export/acknowledgment must work on intact committed delivery through every unfinished closure phase and archive-only conflict, with no new validation/clean or run-lock acquisition. Merge current dispositions under the metadata lock rather than reinstating a frozen index. Only acknowledged/discarded revisions lose delivery references; pending/newer/unrelated records survive all retention depths, context resets, snapshot replacement and archive eviction. Once active/latest/closure references are naturally released, collect disposed payloads even when abandoned overlapping receipts remain; preserve idempotence/gap manifests.

Document closure/retention/metrics-only behavior, local-filesystem guarantees, honest degradation and original-location recovery limits under `docs/` following its instructions. Rollback must preserve/export pending evidence and keep telemetry-aware cleanup or use an isolated log directory; an older cleanup-unaware binary must not operate on the new store without compatibility checks. Do not backfill unmeasured logs or reset pending evidence as rollback. Final automated evidence prepares producer acceptance, not a release or a claim of complete nested eval costs.

## Spec

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

`RunResult.telemetry` SHALL expose the additive identity, location, and publication fields specified by `validation-metrics`, with independent history and delivery diagnostics. Validation-command invocation allocation SHALL precede controlled configuration and context-file errors. Controlled command helpers SHALL return their outcomes to a finalization owner before CLI process exit. No metric-operation invocation SHALL be confused with a validation-command invocation.

The run, check, and review executors SHALL all return non-exiting structured internal/programmatic results carrying the common telemetry metadata. Only CLI wrappers SHALL format the existing output and choose process exit behavior. Controlled pre-storage errors SHALL retain invocation identity and known facts in those results; when no evidence could be persisted, CLI export SHALL report missing/unavailable delivery rather than invent a marker. This SHALL NOT add a second machine-readable console/failure transport.

#### Scenario: Check and review return controlled error outcomes
- **WHEN** a programmatic caller invokes the check or review executor and configuration, context-file, or lock handling fails in a controlled way
- **THEN** the executor returns its structured outcome and telemetry metadata without terminating the caller's process
- **AND** the corresponding CLI wrapper preserves the existing validation error and exit semantics

#### Scenario: Context file cannot be read
- **WHEN** a validation command encounters a controlled context-file read error before adapter dispatch
- **THEN** it retains its own invocation identity, known zero-dispatch state, original validation error, and explicit persistence/publication availability
- **AND** finalization occurs before the command exits without changing the existing validation exit semantics

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Validator-owned metrics retrieval interface

Agent Validator SHALL provide a versioned, machine-readable CLI interface for consumer-scoped telemetry export and acknowledgment. Validator SHALL resolve its own telemetry storage using the project/configuration context supplied to these operations. Consumers MUST NOT need to discover or read private snapshot, archive, or pending-delivery files to perform this handoff. Export and acknowledgment SHALL NOT execute validations, dispatch model work, or create validation-command invocations.

The supported Runner integration SHALL use this pull-and-acknowledge interface rather than require Validator to write `AGENT_RUNNER_NESTED_METRICS_PATH`. The standalone `validation-metrics.json` artifact remains a separate supported surface for standalone callers, not a second accounting source for Runner's integration.

Export and acknowledgment SHALL remain usable against valid committed delivery evidence during unfinished session closure, including after a crash. They SHALL NOT require another validation, `clean`, archive-journal completion, or acquisition of the validation run lock. Short telemetry metadata coordination MAY be required. A later closure operation SHALL preserve intervening delivery dispositions rather than restore a stale index. Unfinished closure alone SHALL NOT yield an error requiring the caller to run validation or cleanup.

#### Scenario: Retrieve and acknowledge after a closure crash without validation
- **WHEN** Validator crashes during closure after committing consumer delivery evidence and the consumer resumes solely to collect that evidence
- **THEN** metrics export returns the committed records and metrics acknowledgment can durably acknowledge their exact receipt without another validation or clean command
- **AND** subsequent closure recovery does not undo that acknowledgment or reassign the measurements

#### Scenario: Archive conflict does not block intact delivery evidence
- **WHEN** an unfinished archive operation requires intervention but committed delivery records and receipt state remain valid and accessible
- **THEN** export and acknowledgment remain usable without repairing the archive first

#### Scenario: Export without storage-path knowledge
- **WHEN** Runner requests telemetry using the original validation's project/configuration context and consumer correlation context
- **THEN** Validator resolves the applicable stored evidence and returns a versioned structured response without requiring Runner to supply an internal telemetry filename

The interface SHALL expose `metrics capabilities`, `metrics pending`, `metrics export`, `metrics acknowledge`, and `metrics discard`. Scoped export/acknowledgment/discard operations SHALL accept `--project <dir>` (default cwd), optional `--config <file>` relative to that project, `--consumer <name>`, `--context <id>`, and `--protocol-version <version>`. Export SHALL additionally accept repeatable `--measurement-version <version>` options declaring the consumer's supported measurement versions and optional `--max-records <count>`; acknowledgment and discard SHALL accept `--receipt <opaque-token>`. Discard SHALL require `--confirm`. Pending inventory SHALL accept the same project/configuration/protocol selection, an optional consumer filter, and bounded `--limit`/opaque `--after` pagination without requiring a known context.

Capabilities SHALL advertise supported operations and independent protocol, measurement, and artifact versions through `capabilities_version: 1` without requiring project configuration or creating storage. It SHALL also advertise documented default/maximum inventory/export counts, byte budgets, and maximum individual record size. Valid record bounds SHALL permit at least one retained record plus response overhead to fit a supported export batch. Excessive requested limits SHALL yield `invalid_arguments`. The initial new protocol and common measurement versions SHALL each be `1`, independently of existing Runner versions. Data responses SHALL identify `protocol_version`, producer metadata, operation, `ok`, and diagnostics; exports SHALL also identify `measurement_schema_versions`, the distinct versions actually returned. Each metrics command SHALL emit one JSON response to stdout. Operational and argument errors SHALL use `ok: false` with `error.code`, safe `error.message`, and `error.retryable`, and exit nonzero. Unsupported versions SHALL be explicit and SHALL NOT cause silent downgrade or acknowledgment.

The measurement and record-envelope contracts SHALL use the closed versioned allowlists specified by `validation-metrics`. A consumer SHALL validate every record against its negotiated protocol and measurement schemas before durable incorporation and acknowledgment, preserving all accepted fields including already-declared optional fields. Undeclared fields or unsupported versions SHALL cause explicit rejection without acknowledgment; consumers SHALL NOT strip those fields and acknowledge a lossy projection or forward them as opaque evidence. Adding a record-envelope field requires a protocol-version change; adding a measurement field requires a measurement-version change.

Each revision SHALL identify its own `measurement_schema_version` and preserve it in its digest input and every delivery. Producer upgrades SHALL NOT relabel retained evidence. Before issuing an export receipt, Validator SHALL check that the selected pending scope's measurement versions are supported by both producer and caller, reporting `unsupported_version` and the required set if not. It SHALL NOT silently filter unsupported revisions from a seemingly complete scope. The response version set SHALL NOT substitute for per-record interpretation or aggregate conversion.

#### Scenario: Mixed-version pending evidence is exported losslessly
- **WHEN** a pending scope includes revisions from two supported measurement versions and the consumer declares both
- **THEN** bounded export preserves each revision's original version and digest, and reports the versions present in its returned batch
- **AND** the revisions remain replacement evidence rather than new consumption or rewritten historical measurements

#### Scenario: One pending measurement version is unsupported
- **WHEN** the selected scope includes a retained measurement version outside the caller's declared support set
- **THEN** export returns the required-version incompatibility without issuing a partial-scope receipt or consuming any revision

#### Scenario: Undeclared field is rejected without acknowledgment
- **WHEN** an exported record contains a field outside the consumer's supported closed schema
- **THEN** the consumer reports incompatibility without forwarding or silently dropping the field and does not acknowledge the receipt
- **AND** pending evidence remains available for a compatible consumer

Storage resolution SHALL read location configuration without loading or validating review definitions or invoking model/check work. Default configuration selection SHALL match validation's `.validator/config.yml` then legacy `.gauntlet/config.yml` selection. Missing configuration MAY use the documented default location; unreadable/malformed location configuration SHALL report its limitation. Recovery requires the original project/configuration location; automatic migration when `log_dir` changes or storage is externally moved/deleted is not promised. A missing location or record SHALL NOT establish zero usage.

#### Scenario: Invalid review definition does not prevent retrieval
- **WHEN** location configuration remains usable but a configured review definition is invalid
- **THEN** metrics export can retrieve retained evidence without loading that review definition or executing validation

#### Scenario: Protocol is unsupported
- **WHEN** a caller requests an unsupported protocol or measurement version
- **THEN** the command returns a structured unsupported-version error and supported-version information
- **AND** pending evidence remains unacknowledged and retained

#### Scenario: Metrics operations do not rerun validation
- **WHEN** a consumer exports or acknowledges telemetry after validation has failed or completed
- **THEN** the operation launches no checks or model reviews and creates no new validation invocation or model attempt

#### Scenario: Existing sink is not a required second transport
- **WHEN** Runner integrates through the supported export and acknowledgment commands
- **THEN** delivery does not require a JSONL sink path or direct filesystem ingestion of Validator's telemetry

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Pending evidence survives ordinary cleanup

For consumer-correlated work, Validator SHALL retain pending delivery evidence until the applicable receipt is acknowledged or the user explicitly discards the evidence. Ordinary log cleanup, session closure, historical rotation, and `max_previous_logs: 0` MUST NOT evict pending evidence. Pending evidence SHALL NOT itself trigger rerun/current-log detection or reopen a closed validation session.

Pending delivery storage is independent of historical log retention and may accumulate while delivery remains broken. These guarantees apply to successfully persisted evidence under Validator-managed operations, not external directory deletion, disk loss, or a write that failed. Explicit discard SHALL be a distinct user-directed action with a visible delivery-gap result, not ordinary cleanup, acknowledgment, or proof of zero usage.

#### Scenario: Cleanup uses zero historical retention
- **WHEN** an invocation has unacknowledged evidence and ordinary cleanup runs with `max_previous_logs: 0`
- **THEN** the pending evidence remains retrievable through the CLI despite removal of disposable logs and omission of historical archives

#### Scenario: Later sessions rotate historical logs
- **WHEN** subsequent sessions close and rotate older logs while earlier delivery remains unacknowledged
- **THEN** pending evidence for the earlier context remains retrievable with its original attribution

#### Scenario: Only pending telemetry remains
- **WHEN** no ordinary current logs remain but pending delivery evidence exists
- **THEN** its presence does not classify the next validation as a retry of a closed session or trigger ordinary log rotation

#### Scenario: User explicitly discards pending evidence
- **WHEN** the user explicitly selects pending evidence for discard
- **THEN** Validator reports the affected scope and a delivery gap rather than reporting acknowledged delivery or zero consumption
- **AND** unrelated pending evidence is preserved

Explicit discard SHALL use `metrics discard` with the selected consumer/context, an export receipt, and `--confirm`. It SHALL release only still-pending covered revisions after committing their `user_discarded` delivery-gap disposition. It SHALL NOT expand to newer revisions or delete latest/historical measurement snapshots. Durable gap metadata SHALL identify the original scope and affected record revisions without retaining unrestricted provider payloads. Repeated discard SHALL not expand its original scope.

Acknowledgment and discard SHALL serialize their disposition changes: acknowledged revisions SHALL NOT later be relabeled discarded; discarded revisions SHALL remain visible as a delivery gap rather than being erased by a later acknowledgment. An acknowledgment covering discarded revisions SHALL report the gap instead of claiming complete acknowledgment.

#### Scenario: Explicit discard races with completion
- **WHEN** the user discards a receipt for an earlier revision while a newer completion is recorded
- **THEN** only still-pending revisions covered by that receipt are discarded and the completion remains exportable

#### Scenario: Acknowledgment and discard race
- **WHEN** acknowledgment and explicit discard target the same pending revision concurrently
- **THEN** their durable disposition changes are serialized and the first committed disposition is preserved
- **AND** discarded evidence cannot subsequently be represented as fully acknowledged delivery

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Idempotent and scoped acknowledgment

Validator SHALL provide a structured acknowledgment operation accepting an export receipt. A successful acknowledgment SHALL durably record receipt of only the covered revisions and MAY release their pending-delivery copies. It SHALL NOT delete newer or unrelated pending evidence or alter measured usage, validation outcomes, or ordinary snapshot/history retention.

Repeated acknowledgment SHALL be harmless. An invalid or mismatched receipt SHALL NOT release any pending evidence. If acknowledgment cannot be durably recorded, the operation SHALL report failure and preserve recoverability rather than report successful receipt.

Receipt payload pins SHALL be revision-specific. Once a covered revision has a durable acknowledgment or discard disposition through any valid receipt, it SHALL no longer remain pinned solely by any overlapping receipt. A fully disposed receipt SHALL retain only the small manifest/disposition metadata necessary for scope validation and idempotence, not require its payload files. Exporting a newer batch alone SHALL NOT release pending evidence. Independent active/latest-session and closure references MAY still retain the same payload.

#### Scenario: A newer receipt disposes evidence covered by an abandoned receipt
- **WHEN** R1 covers revision 1, R2 covers revisions 1 and 2, and the consumer durably incorporates and acknowledges R2 without acknowledging R1
- **THEN** neither payload remains retained solely by R1 after other retention references are gone
- **AND** a later R1 acknowledgment remains idempotent using retained metadata even after payload reclamation

#### Scenario: New export is not disposition
- **WHEN** R2 overlaps R1 but neither receipt has been acknowledged or explicitly discarded
- **THEN** all still-pending revisions remain protected and exportable

#### Scenario: Consumer saves then crashes before acknowledgment
- **WHEN** Runner durably incorporates a batch but crashes before acknowledging it
- **THEN** Validator permits replay of the pending evidence with stable record identities and revisions so Runner can deduplicate it and subsequently acknowledge it

#### Scenario: Acknowledgment is retried
- **WHEN** Runner repeats an acknowledgment whose effect was already durably recorded
- **THEN** Validator reports the already-acknowledged or successful state without releasing unrelated evidence or changing consumption

#### Scenario: Older receipt does not discard new completion
- **WHEN** Runner acknowledges a receipt for an earlier attempt revision after a newer completion revision was recorded
- **THEN** the newer revision remains pending and exportable

#### Scenario: Receipt does not match the requested scope
- **WHEN** an acknowledgment supplies an invalid receipt or one bound to a different consumer/context
- **THEN** Validator reports the error without releasing pending evidence

#### Scenario: Acknowledgment persistence fails
- **WHEN** Validator cannot durably record the acknowledgment
- **THEN** the CLI reports failure and does not release evidence that would make retry or recovery impossible

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Handoff failures are explicit and independent

Validation-time telemetry storage failures SHALL warn without changing validation outcomes or exit codes. Standalone snapshot publication and consumer delivery SHALL have independently observable states. Export or acknowledgment commands SHALL report their own operational failures through structured diagnostics and a failing command status, rather than return a successful empty measurement or acknowledgment. Such metrics-operation failures MUST NOT retroactively alter validation results.

Metrics errors SHALL distinguish retryable metadata contention/transient I/O from conditions needing configuration restoration, a compatible producer, or operator investigation of corrupt/conflicting committed evidence. The error SHALL identify whether retry is meaningful without that intervention. An archive-only recovery problem SHALL NOT be represented as corruption or unavailability of intact delivery records. No recovery path SHALL silently reset delivery state or infer zero from failed access.

#### Scenario: Committed delivery evidence is corrupt
- **WHEN** export cannot validate committed delivery metadata or record digests independently of any archive operation
- **THEN** it reports a non-retryable-without-intervention storage/conflict error and preserves the evidence for investigation
- **AND** it does not direct the consumer to run validation as a way to fabricate or clear the missing history

#### Scenario: Snapshot publication succeeds but export fails
- **WHEN** a validation snapshot exists but the consumer export operation cannot read or serialize the applicable evidence
- **THEN** export reports its failure without claiming zero usage or invalidating the recorded validation outcome

#### Scenario: Validation-time persistence fails
- **WHEN** telemetry persistence fails while validation is executing
- **THEN** validation continues with a warning and explicitly degraded telemetry state rather than claiming the evidence was durably retained

#### Scenario: Consumer cannot interpret the exported protocol
- **WHEN** Runner cannot support an exported protocol version and therefore does not acknowledge its receipt
- **THEN** Validator retains the unacknowledged evidence for subsequent compatible retrieval rather than treating export as delivery completion

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Versioned standalone artifact and invocation discovery

Agent Validator SHALL publish a machine-readable artifact at `<log_dir>/validation-metrics.json` containing explicit schema versioning, validation-session identity and state, command invocation records, model attempt records, and separate current-invocation and cumulative-session aggregates. Its measurement payload SHALL use the common versioned semantics shared with the consumer handoff; domain-specific outer artifacts need not have identical layouts or version numbers.

Structured validation results SHALL expose the command's `invocation_id`, its `session_id` when established, the artifact path when resolvable, and publication metadata that distinguishes a successfully published snapshot for this invocation from unavailable or stale evidence. A failed publication MUST NOT make an earlier snapshot appear to measure the current command. Session, invocation, and attempt records SHALL include lifecycle state and applicable timestamps; unobserved terminal times SHALL remain unavailable rather than invented.

#### Scenario: First invocation publishes its measurements
- **WHEN** the initial validation invocation records model attempts and snapshot publication succeeds
- **THEN** the artifact identifies that invocation and session, contains its attempt records, and exposes both invocation and session aggregates
- **AND** the structured result identifies the published artifact and its owning invocation

#### Scenario: Retry separates new work from session history
- **WHEN** another command invocation dispatches new reviews within the same open validation session
- **THEN** the artifact retains earlier invocation and attempt history
- **AND** its current-invocation aggregate includes only the later invocation's attempts while its session aggregate includes both

#### Scenario: Confirmed zero dispatch
- **WHEN** an invocation is confirmed to have dispatched no model and publication succeeds
- **THEN** its attempt set is empty and its model-consumption aggregate expresses confirmed zero dispatch
- **AND** no provider token observations or model attempts are manufactured

#### Scenario: Lock-rejected command does not replace the active snapshot
- **WHEN** another command owns the validation lock and the current command is rejected before dispatch
- **THEN** the rejected command's structured result identifies its own invocation and zero-dispatch outcome without mutating the active command's shared snapshot
- **AND** it does not claim that snapshot belongs to the rejected command

#### Scenario: Configuration or storage prevents publication
- **WHEN** configuration, session association, or storage cannot be established sufficiently to publish the current command's snapshot
- **THEN** the structured result explicitly identifies unavailable metadata and publication limitations
- **AND** an older snapshot is not presented as current-command evidence

The standalone artifact SHALL identify `artifact_schema_version`, `measurement_schema_versions` (the distinct versions of contained record heads), `aggregate_measurement_schema_version` (the root aggregate semantics), producer/version metadata, `snapshot_id`, `published_at`, `session`, `current_invocation_id`, invocation/attempt records, and separate `aggregates.current_invocation` and `aggregates.session`. Each invocation/attempt revision SHALL carry its own `measurement_schema_version`, preserved in the standalone artifact, storage, export, and digest input. Invocation-local aggregates SHALL follow that record's version. Initial artifact and measurement versions SHALL each be `1` and SHALL evolve independently of the export protocol and Runner's outer artifact. The common language-neutral schema and compatibility fixtures SHALL initially be owned and distributed by Validator; consumers SHALL pin reviewed versions rather than depend on Validator's implementation language.

Sessions and retained delivery scopes SHALL support records spanning producer/measurement upgrades without rewriting, dropping, or relabeling immutable earlier revisions. A version set or maximum version SHALL NOT imply a semantic conversion. New revisions MAY use a newer supported measurement version while retaining record identity; aggregate interpretation SHALL follow the explicit cross-version rules below.

#### Scenario: Retry after a measurement schema upgrade
- **WHEN** an initial failed invocation records measurement v1 and a retry in the same session records a later supported measurement version
- **THEN** each retained head identifies its actual measurement schema, and the snapshot lists the contained versions separately from the root aggregate version
- **AND** no historical revision is rewritten or mislabeled to force a single measurement version

Published telemetry schema versions SHALL define closed allowlists for their fields, nested objects, and source variants. Adding fields, including optional fields, SHALL require a new version of the owning measurement, artifact, or protocol contract. Already-declared optional fields MAY remain optional as specified. No opaque unknown-field forwarding or unrestricted extension object SHALL be required or permitted as a substitute for version agreement. Accepted evidence SHALL be preserved losslessly; unsupported fields or versions SHALL be explicitly rejected rather than silently dropped or interpreted as compatible evidence.

#### Scenario: A new telemetry field requires a new schema version
- **WHEN** a producer adds a field not declared by a published measurement schema, even if the field is optional
- **THEN** it identifies that field under a new measurement version rather than extending the old version's allowlist implicitly
- **AND** consumers lacking that version do not silently accept, drop, or forward the new field

Additive `RunResult.telemetry` metadata SHALL identify the invocation, explicitly available/unavailable session and artifact location, and publication state (`published`, `degraded`, or `unavailable`) with snapshot identity, owning invocation, and reasons. CLI consumers SHALL use the fixed snapshot's ownership metadata for standalone use or the consumer-scoped metrics export interface for integrated use; they SHALL NOT need console or `--report` parsing.

All three validation command executors SHALL return non-exiting structured internal/programmatic outcomes with this telemetry shape, including controlled errors before storage resolution. `RunResult.telemetry` is the run executor's surface; check/review result types SHALL expose the same shape. CLI wrappers SHALL preserve existing human output and exit behavior. This requirement adds no separate JSON console/failure transport and does not imply durable export where persistence was impossible.

#### Scenario: Snapshot exists but final publication is incomplete
- **WHEN** a current-invocation snapshot exists but recording or publishing terminal evidence fails
- **THEN** result metadata identifies degraded or unavailable final publication rather than claiming that the existing file establishes complete terminal evidence

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/validation-metrics/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Attempt lifecycle and failure evidence

Validator SHALL persist attempt identity and initial lifecycle evidence before dispatch when storage permits, retain observed evidence through controlled success and failure paths, and finalize the same attempt on terminal execution. Parallel updates SHALL NOT lose another attempt's recorded evidence. Adapter execution outcome, review findings, and telemetry completeness SHALL be independently represented.

Interrupted attempts SHALL retain their last persisted evidence and explicit incomplete lifecycle/collection state; Validator MUST NOT invent terminal usage or success. Initial or final telemetry persistence failure SHALL warn and make publication/history degradation explicit without preventing validation or changing its outcome or exit code.

#### Scenario: Review violations with complete telemetry
- **WHEN** an adapter completes with review violations and complete source usage
- **THEN** the attempt retains the failed review outcome and independently complete usage collection

#### Scenario: Failure or timeout retains partial evidence
- **WHEN** an adapter fails or times out after reporting some usage or identity evidence
- **THEN** the terminal attempt retains that evidence with its failure and applicable collection limitations

#### Scenario: Process interruption leaves an incomplete attempt
- **WHEN** initial attempt evidence was persisted but the process is interrupted before finalization
- **THEN** the stored attempt retains its identity and known evidence without a fabricated successful outcome or final usage count

#### Scenario: Initial persistence fails
- **WHEN** recording initial telemetry fails before an otherwise permitted dispatch
- **THEN** validation continues with a warning and degraded telemetry state rather than claiming successful durable recording

#### Scenario: Final persistence fails
- **WHEN** validation completes but writing terminal telemetry fails
- **THEN** validation outcome and exit code remain unchanged while publication/history limitations are surfaced

#### Scenario: Parallel finalizations retain both attempts
- **WHEN** two reviews finalize concurrently
- **THEN** successful telemetry persistence retains both attempts and their evidence rather than overwriting one with the other

## Test Plan

Own INT-002 and both E2E-001/E2E-002 at the first complete production cleanup/retry/recovery boundary. Carry out all seven cleanup-caller categories at configured depths, expanding context-change cleanup into the run, gate-command and detect entry points listed above. Prove loaded depth propagation, especially zero, and run-lock coordination at each entry point; do not let one shared-coordinator test substitute for caller coverage. Keep the exhaustive phase-crash matrix concentrated in representative coordinator cases as approved. Use independent processes and explicit barriers for intent, staging/moves/install, publication and boundary commits; inject required flush failures as well as kills. After each crash following a delivery commit, use only public export/ack before any validation/clean recovery and verify subsequent closure cannot undo ack.

Complete INT-003's production-lifecycle receipt-reclamation supplement: R1 rev1, R2 rev1+2, ack/discard/mixed dispositions, normal closure/latest replacement/retention-reference release, repeated cycles and late R1 disposition after payload reclamation. This supplements its protocol owner with actual archive transitions, not a second receipt implementation. Include archive-only conflicts separately from corrupt committed delivery, with independent errors.

Reuse measured adapter fixtures and the built CLI/durable consumer for E2E-001/E2E-002. Run the three existing approved journeys, not a multiplied adapter-by-error E2E matrix. Preserve CI wiring under `bun run test:e2e` and its Docker coverage. Automated evidence must identify any unmet recording or companion prerequisites; do not execute AT-001/002/003 or treat automated substitutes as completed agent acceptance.

From the approved `test-plan.md`, retained verbatim:

### INT-002: Recoverable closure and independent delivery retention

- Covers: LM “Recoverable session closure and immutable archive,” “Configurable Log Rotation Depth,” “Log Clean Process,” and “Independent protected delivery retention”; RL “Automatic Rerun Detection,” “Validation telemetry session lifecycle,” and “Auto-Clean on Retry Limit Exceeded”; NH “Pending evidence survives ordinary cleanup.”
- Boundary: Close coordinator → run/metadata locks → ordinary files/archives → session boundary and independent delivery store.
- Setup: Sessions with failed and successful invocations, pending receipts, existing archives, and execution state. Exercise depths 0, 1, and 3, missing intermediate archives, metrics-only active sessions, and closed-only stores. Explicit caller matrix: manual clean, `skip`, run success, check success, review success, retry-limit cleanup, and context-change cleanup. Each caller must prove configured-depth propagation, especially depth zero; representative shared-coordinator tests carry the exhaustive crash-phase matrix. Freeze inventories and install explicit phase barriers.
- Action: Interrupt before/after closure intent, archive staging/moves/installation, latest publication, and closed-boundary commit. Resume recovery repeatedly. After each closure-phase crash that follows a delivery commit, use only metrics export/acknowledgment before any subsequent validation or clean. Later complete closure. Introduce an archive-only conflicting file separately from corrupt delivery evidence.
- Assertions: One session archive/rotation per close; immutable as-of-close metrics; a new session after the boundary; no newer file swept into an old inventory. Depth zero preserves pending/latest evidence and leaves preexisting archives untouched. Closed telemetry alone does not advance retry/log numbering or trigger another archive. Context reset preserves pending original attribution and existing execution-state rules. Export/acknowledgment work while closure remains unfinished or has an archive-only conflict; later recovery cannot undo acknowledgment. Corrupt delivery state is a distinct explicit failure, not zero evidence or a directive to rerun validation.
- **Caller/retention assertions:** `skip` closes the active session before baseline advance, creates no validation invocation/model attempt, and preserves pending evidence; the next validation has a new session. A metrics-only archive consumes exactly one ordinary slot at nonzero depth, including eviction; depth zero creates none. Every caller freezes loaded configuration depth rather than a helper default. Changing configuration after a crash does not change the journal's frozen depth during recovery.
- **Constraints:** Destructive operations target only validated test-owned inventories. Repeated phase recovery must use persisted identity, not fresh wildcard assumptions. Cover required-flush failures as well as process termination.
- Execution: Real-filesystem tests under `test/metrics/` and `test/commands/`, wired into `bun run test`; representative built-CLI recovery is covered by E2E-002 rather than duplicating the entire phase matrix there.

From the approved `test-plan.md`, retained verbatim:

### E2E-001: Failed review, retry, success, and retained metrics

- Covers: VM stable IDs, review-result correlation, and distinct invocation/session aggregates; RL session lifecycle and preservation policy; LM automatic success cleanup and historical retention.
- Surface: Built Validator CLI under Node in an isolated Git repository.
- Setup: A small tracked source change, multiple configured review slots, deterministic provider processes with known usage, and an existing supported retry/preserved-review configuration. Configure a named consumer context and nonzero history retention. Expected source usage and review findings are fixed fixtures.
- Journey: Run a review-containing validation that fails; change the fixture/project as a normal retry would; retry successfully; inspect the fixed snapshot, review-attempt references where retained, and scoped export after automatic cleanup.
- Assertions: Each command has its own invocation ID; actual redispatches get new attempt IDs under the same session; skipped/preserved results add no consumption. Failed work remains measured. Current-invocation totals contain only its dispatches while session totals include earlier attempts once. Success closes the session while latest and pending evidence survive; report text, findings, and exit codes remain compatible. Parallel attempt work is not counted as additional elapsed time.
- Execution: `test/integration/` after `bun run build:npm`, included in `bun run test:e2e`. Detailed parser/retention matrices remain in INT-002/004 rather than repeated here.

From the approved `test-plan.md`, retained verbatim:

### E2E-002: Interruption, metrics-only recovery, and replay-safe receipt delivery

- Covers: NH original context, non-consuming export, revision-bound acknowledgment, and independent failures; LM recoverable closure and protected delivery; RL interrupted work.
- Surface: Built Validator validation and metrics CLI processes plus a controlled durable consumer client.
- Setup: Temporary Git project with zero historical retention, recorded usage, and saved original consumer/project context. Use a test barrier at a representative closure point after committed invocation/attempt evidence. Keep the client receipt/data store separate from Validator logs.
- Journey: Execute validation, terminate it at the barrier, then use only `metrics export` and `metrics acknowledge` to retrieve the committed evidence. Exercise client interruption before saving and after durable saving but before acknowledgment, followed by replay. Only after delivery succeeds, allow normal closure recovery to finish.
- Assertions: Recovery requires neither validation nor clean to unlock evidence. Replays retain producer IDs/revisions and original context; the controlled client incorporates one selected head per attempt. Pending evidence survives zero-retention cleanup; acknowledgment is durable/idempotent and remains so after later closure recovery. Unobserved terminal work stays incomplete. No missing/discarded/previously acknowledged state is represented as zero consumption.
- Execution: `test/integration/` after building, in `bun run test:e2e`. Exhaustive closure and stale-receipt races are INT-002/003; this journey proves the delivered command composition, not actual Runner ingestion.

## Done When

- Every cleanup caller, including detect’s context-change path, uses one recoverable coordinator with configured depth frozen, terminal evidence finalized first where a validation invocation exists, and the run lock held through cleanup. Skip closes before baseline advance; neither skip nor detect creates a validation invocation/model attempt. Caller tests cover all three context-change entry points and both formerly depth-dropping calls at depth zero.
- INT-002 passes across the approved caller/depth/crash/flush/conflict matrix, including no-log active closure, metrics-only slot eviction, depth-zero historical preservation, repeated no-op clean and unchanged execution-state behavior.
- Metrics export/ack works after every relevant closure crash and archive-only conflict without validation/clean, and later recovery preserves intervening dispositions and immutable historical measurements.
- E2E-001 and E2E-002 pass through the built Node CLI with representative recorded provider output and a durable controlled consumer; IDs/revisions/original attribution, retries, failed/interrupted work, unknowns and elapsed-time semantics remain correct.
- INT-003's normal-lifecycle overlapping-receipt reclamation supplement passes, including late receipt retries after disk payload removal and durable gaps under mixed dispositions.
- Retention, recovery and rollback documentation matches delivered behavior; all assigned automated obligations are wired into source/E2E checks, with acceptance and companion prerequisites visibly outstanding until actually executed.

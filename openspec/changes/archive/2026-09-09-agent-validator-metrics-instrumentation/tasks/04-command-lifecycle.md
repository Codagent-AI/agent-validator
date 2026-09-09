# Task: Record every validation invocation and correlate actual review dispatches

## Goal

Expose non-exiting structured run/check/review results with truthful invocation/session/publication metadata and preserve all actual dispatches without changing validation behavior.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Use `src/commands/run.ts`, `check.ts`, `review.ts`, `gate-command.ts`, `gate-command-support.ts`, `shared.ts`, `src/core/run-executor.ts`, `run-executor-helpers.ts`, `run-executor-lock.ts`, `reconciliation.ts`, `runner.ts`, `src/gates/review-runtime-helpers.ts`, `review.ts`, `review-eval.ts`, `review-agg.ts`, `review-helpers.ts`, `review-one-shot.ts`, `review-dispatch-types.ts`, `review-types.ts`, `result.ts`, and `src/types/validator-status.ts`. The required interfaces are the `src/metrics/` recorder/store/publisher and structured adapter success/failure/update telemetry. Document programmatic result and standalone discovery behavior in `docs/` following its local instructions.

Read design “Command orchestration,” “Adapter integration and finalization,” “Record model,” and snapshot/publication fields. Today `executeRun()` returns a `RunResult`, but context-file handling precedes it in the CLI, and `executeGateCommand()` plus support helpers call `process.exit()`. Refactor all controlled paths, including configuration, context-file and lock errors, into structured results handled by a finalization owner. Allocate invocation identity before these errors. Only CLI wrappers choose exit behavior and format existing output; do not add a second JSON console/failure transport or change `--report` semantics. Unknown commands/help are not validation invocations.

Add paired `--metrics-consumer` and `--metrics-context` to all three validation commands and their programmatic options; validate bounded nonempty values as data, never paths. Persist original context on invocations/attempts and keep it separate from provider, session and attempt identity. Runner's durable mapping before launch is a documented consumer prerequisite, not work implemented in Validator.

Acquire the run lock before console logging. A rejected command retains its own terminal lock-conflict/zero-dispatch facts; attempt isolated consumer recording through the short metadata lock without attaching to the owner's session or replacing its snapshot. A failed isolated write remains explicit unavailable durable evidence. Pre-storage failures return known facts without asserting an artifact/export marker. Avoid acquiring the run lock inside an already locked finalization path.

Under the run lock, startup reconciliation and any required closure recovery/context cleanup precede session association; never join a closing/closed session. Preserve active sessions across failed invocations and separate process retries. Finalize trusted/no-change/no-applicable/checks-only/other early paths even when empty. Keep existing cleanup decisions; a terminal invocation need not close its session. The recorder's lifecycle operations must be integrated without inventing a complete session when prior history is unknown.

Wrap the actual `adapter.execute()` boundary with atomic attempt preparation/parent membership and meaningful safe evidence updates. Commit execution telemetry before review interpretation, attach the independent review result afterward, and wait for controlled attempt finalization before invocation finalization. Keep the failed attempt and partial usage on adapter errors, timeout and invalid review JSON. A persistence error is a telemetry warning, never a review violation or `passed_with_warnings` gate outcome. Preserve original error/status if finalization also fails.

Add attempt references to actual gate/subresults and review JSON without copying review payload into metrics. In `src/gates/review-agg.ts`, propagate actual-dispatch references through `writeJsonResult()` and `buildSubResults()` and its builders. Separately cover `writeSkippedSlotLog()` in `src/gates/review-helpers.ts`, which writes `skipped_prior_pass` JSON and the synthesized result. It must not allocate a new attempt or make a historical reference appear to be current dispatch evidence; existing historical references may be retained as the approved specification permits. Preserved/passed/one-shot synthesized results may retain historical references but create no attempt; safety-latch and erroneous-one-shot redispatches create real new IDs. Preserve slot selection, round-robin and skip policy. Publish the current invocation and session view with accurate ownership and independent history/delivery diagnostics.

Establish one controlled finalization boundary before existing success/retry-limit cleanup callbacks and retain the run lock through cleanup. Recoverable archive construction and the exhaustive cleanup caller/depth matrix are the close coordinator's boundary, not a reason to change cleanup policy in these executors. This unit verifies execution/result behavior with real recorder and injected cleanup seams; it must not claim final archive/recovery acceptance from those seams.

## Spec

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

### Requirement: Stable attempt identity and review correlation

Every `run`, `review`, and `check` command execution SHALL receive a distinct invocation identity. Every actual model-backed adapter dispatch SHALL receive a distinct stable `attempt_id` and retain its parent invocation/session identity, gate, review slot, adapter, and retry/run context. Review result records and per-review JSON artifacts for actual dispatches SHALL reference their telemetry attempts. Provider CLI session identity and consumer workflow correlation SHALL remain separate from Validator's identities.

Finalization, rereading, archival, or delivery replay SHALL preserve an existing attempt identity. New dispatches SHALL NOT reuse it. Skipped review slots and preserved one-shot results SHALL NOT create new model attempts or assign earlier consumption to the current invocation; an available reference to earlier evidence remains a historical reference. One adapter dispatch is one attempt, not one attempt per provider-internal request or observed model.

#### Scenario: Parallel dispatches use the same adapter
- **WHEN** multiple gates or review slots dispatch the same adapter concurrently
- **THEN** each actual dispatch has its own attempt ID and unambiguous gate/slot and parent-invocation context
- **AND** collection sources are isolated per dispatch, including same-clock-tick launches, and one dispatch's cleanup cannot destroy another's evidence

Collection from a shared source SHALL require source-supported per-attempt correlation. Ambiguous or cross-contaminated observations SHALL NOT support complete per-attempt measurements; unaffected established evidence MAY remain available with explicit partial/unavailable affected fields. Source cleanup SHALL affect only the owning attempt's resources.

#### Scenario: Shared collection cannot establish ownership
- **WHEN** a collection source contains observations from several attempts without reliable source correlation
- **THEN** the adapter reports attribution/collection limitations rather than assigning their combined usage to one attempt or guessing a split

#### Scenario: Actual retry creates new consumption
- **WHEN** a previously failed review is dispatched again
- **THEN** it receives a new attempt ID and retains the earlier attempt as distinct history

#### Scenario: Finalization and archival preserve identity
- **WHEN** an attempt is finalized, reread, archived, or exported again
- **THEN** its identity and originating invocation/session remain unchanged

#### Scenario: Review result joins to telemetry
- **WHEN** a review dispatch produces a result and its JSON artifact
- **THEN** the result and artifact identify the corresponding telemetry attempt without requiring filename or execution-order inference

#### Scenario: Preserved and skipped reviews create no attempts
- **WHEN** a command skips a previously passed review or preserves a one-shot result without dispatch
- **THEN** that decision creates no new model attempt or current-invocation usage
- **AND** the enclosing validation command still has its own invocation identity

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

Lock-rejected invocations SHALL be eligible for isolated consumer-scoped recording/export through a short telemetry metadata lock independent of the validation run lock. Isolated recording SHALL NOT update the active session association or latest snapshot. If it fails, the local result SHALL retain known invocation/dispatch facts and explicitly unavailable durable evidence; export SHALL NOT synthesize a persisted zero-dispatch marker from the failed write.

#### Scenario: Lock-rejected invocation is exported independently
- **WHEN** a consumer-correlated command loses the run lock but its isolated terminal invocation record is successfully persisted
- **THEN** its scoped export identifies `lock_conflict`, its own invocation ID, unavailable session association, and confirmed zero dispatch
- **AND** the lock owner's session snapshot is unchanged

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/run-lifecycle/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/log-management/spec.md`. The following requirement and all its scenarios are copied verbatim.

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

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Original consumer context and producer identity

Validator SHALL accept consumer correlation context at validation launch and retain it with the originating command invocation and its model attempts. The context SHALL allow Runner to associate measured work with the original workflow run, execution session, and parent step attempt without replacing Validator's session, command invocation, or model attempt identifiers. Provider CLI session identity SHALL remain separate.

Exports SHALL be scoped to the selected consumer and originating context. Later export, recovery, or acknowledgment SHALL NOT reassign measurements to the invocation or Runner step performing retrieval. Different actual model dispatches SHALL remain distinct even when their adapter, model, gate, or review slot is the same.

#### Scenario: Parallel reviews share a command but not an attempt
- **WHEN** one Runner-correlated Validator command dispatches several parallel reviews
- **THEN** export retains the common originating context and Validator invocation ID with a distinct model attempt ID for each review

#### Scenario: Recovery retrieves work from an earlier execution
- **WHEN** a resumed Runner process exports retained telemetry for an earlier step attempt
- **THEN** the response preserves that earlier work's original context and producer identities rather than attributing its usage to the recovery step

The validation commands SHALL accept paired `--metrics-consumer <name>` and `--metrics-context <id>` options. The context SHALL be an opaque bounded correlation identifier, not a private telemetry filename. Runner's integration contract SHALL require it to durably map that identifier to its original workflow run, execution session, and parent step attempt before launch and retain the original project/configuration context for recovery. Validator SHALL validate scope identifiers as data and SHALL NOT interpret them as filesystem paths. Separate invocations using the same context SHALL remain separately identifiable.

#### Scenario: Recovery uses a durable launch mapping
- **WHEN** Runner resumes after interruption and exports using an earlier launch's saved project/configuration and consumer/context identifiers
- **THEN** exported records retain the original invocation and attempt identities and can be joined to the saved original parent mapping
- **AND** retrieval does not require Runner to know private storage filenames

#### Scenario: Export is isolated to its context
- **WHEN** pending records exist for two distinct originating contexts and a consumer requests one of them
- **THEN** the response does not merge the other context's measurements into the requested work

Source: `openspec/changes/agent-validator-metrics-instrumentation/specs/nested-metrics-handoff/spec.md`. The following requirement and all its scenarios are copied verbatim.

### Requirement: Invocation evidence distinguishes zero dispatch from missing delivery

Export SHALL include retained attempt lifecycle evidence and invocation finalization. Finalization SHALL identify the invocation outcome, its attempt set, and collection/history limitations so a consumer can distinguish completed delivery, interrupted or partial work, and confirmed zero dispatch. An empty export alone MUST NOT be represented as evidence of zero model consumption.

Previously acknowledged delivery, where established by retained delivery state, SHALL remain distinguishable from a confirmed zero-dispatch invocation. If invocation or delivery evidence cannot be established, the response SHALL state that limitation rather than infer zero consumption.

#### Scenario: Successful command dispatches no models
- **WHEN** a recorded invocation completes without model dispatch, including a legitimate early exit
- **THEN** export includes finalization evidence with an empty attempt set and the recorded outcome, without inventing model attempts or provider usage observations

#### Scenario: Failed command retains measurements
- **WHEN** a command fails after one or more reviews consumed model usage
- **THEN** export retains the failed invocation and attempts with all recorded usage rather than filtering them out because validation failed

#### Scenario: Interruption leaves an unresolved attempt
- **WHEN** initial attempt evidence exists but interruption prevents terminal evidence from being recorded
- **THEN** export preserves the attempt identity and known evidence with explicit incompleteness rather than treating it as zero work or a completed attempt

#### Scenario: No matching invocation exists
- **WHEN** a consumer requests a context for which Validator cannot establish invocation evidence
- **THEN** export reports missing or unavailable evidence rather than a successful zero-dispatch measurement

#### Scenario: All exported revisions were previously acknowledged
- **WHEN** no unacknowledged revisions remain and retained state establishes prior delivery
- **THEN** export distinguishes that state from a command that dispatched no models

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

## Test Plan

Carry INT-001's result-preservation and dispatch-membership guarantees into actual executor integration tests in `test/core/`, `test/commands/`, and `test/gates/`; this is the command-level supplement to its independently exercised recorder boundary. Exercise all controlled statuses and pre-storage context/configuration/lock errors through non-exiting executors, plus actual dispatch, parallel finalization, skipped/preserved/safety-latch/one-shot-error variants. These checks are the executor portion explicitly required by E2E-003; the complete built-command plus retrieval journey requires the public metrics CLI and must not be marked complete here.

Verify finalization-before-clean and report compatibility through existing executor cleanup seams without claiming recoverable archive coverage. Keep real filesystem recorder assertions and meaningful independent-process interruption evidence; dependency injection may control validation outcomes, not replace the designated persistence boundary.

## Done When

- Run, check and review expose non-exiting structured outcomes with the common telemetry shape for every controlled exit; wrappers retain existing output, findings, report and exit semantics.
- Executor regression coverage required by INT-001 and E2E-003 passes, including pre-storage configuration/context errors, live lock conflicts with isolated recording, failed recording without fabricated export evidence, and explicit stale/degraded publication.
- Only actual dispatches create new attempts; prepared membership, failure/invalid-output evidence, retries, independent outcomes and review references survive orchestration and preserve scheduling policy. Tests join real-dispatch review JSON and aggregated subresults to the same attempt and cover skipped-slot/one-shot synthesis without new consumption or falsely current references.
- Attempts and invocation finalize before existing cleanup callbacks, and ordinary early returns retain the existing session/cleanup behavior. Tests do not misrepresent an injected cleanup seam as archive durability evidence.
- Paired launch correlation options and structured metadata are documented; no console parser, JSON failure transport, new cleanup trigger or pricing behavior is introduced.

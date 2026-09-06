# Task: Persist invocation and attempt revisions with atomic snapshots

## Goal

Provide the real recorder, durable file store and snapshot publisher needed to retain concurrent and interrupted measurements without changing the result of validation.

## Background

Paths under `src/`, `test/`, `docs/`, `contracts/`, and `.github/` are relative to the repository root. Definition references are relative to `openspec/changes/agent-validator-metrics-instrumentation/`. New metrics modules, contract assets, and `test/metrics/` are planned implementation paths, not claims that they already exist.

Read the approved `proposal.md`, the relevant sections of `design.md`, and `test-plan.md` (including Coverage Strategy and Completion and Evidence Boundaries), together with repository `AGENTS.md` and `test/AGENTS.md`. The verbatim specification requirements below are authoritative; the scope explanation identifies this delivery unit's portion where a requirement spans several boundaries.

This change implements Validator only. Preserve Validator measurement → Runner attribution/consolidation → Evals valuation ownership. Do not implement companion repositories, modify/regenerate the stopped evaluation artifact, introduce pricing/rate lookup, backfill from logs, or add a JSONL sink. Both companion reviews and the resolutions are approved; targeted confirmation of the revised contracts remains an implementation prerequisite, not a reason to repeat broad design review or claim interoperability passed. Track that prerequisite from `handoffs/agent-runner/handoff.md` and `handoffs/agent-evals/handoff.md`; these task files do not assert that confirmation has occurred.

Implement specification behavior with meaningful TDD and regression coverage. Use dependency injection, unique absolute temporary directories, restored child environments, and explicit synchronization barriers. Persistence/locking/termination checks use real filesystems and independent processes; failure injection supplements those checks. Use deterministic provider executables for all child calls including health/version probes, without real provider credentials or fallback to authenticated installed CLIs. Existing sanitized recordings must substantiate supported mappings; synthetic variations cannot establish provider accounting semantics. New live/paid captures are not authorized.

Source tests belong in the affected `test/metrics/`, `test/cli-adapters/`, `test/gates/`, `test/core/`, and `test/commands/` areas and run with `bun run test`. Built CLI tests belong in `test/integration/`, after `bun run build:npm`, and must be wired into `bun run test:e2e`, retaining its Docker coverage. Use an explicit Node executable with the absolute built `dist/index.js`; Bun's `process.execPath` is not Node coverage. Required build/runtime/assets must fail their designated check when absent, not silently pass. Run applicable lint/type checks as well. Automated filesystem/process evidence uses Linux CI; record runtime versions and filesystem context. No tests may clean/discard real project metrics or publish/install packages globally.

Do not execute `AT-*` or human acceptance as implementor work. Leave acceptance to the acceptance workflow, with accurate prerequisites and sanitized automated evidence. Producer tests do not establish actual Runner/Evals integration. No human-only flow is required. If full Validator review is explicitly requested during implementation, use `bun run build:npm && node dist/index.js run` from this checkout, never a Validator executable from PATH.

Use `src/metrics/` for the recorder/store/publisher with the versioned contract, reducers and projection functions as required interfaces. Integrate protected-file predicates in `src/commands/shared.ts`, `src/output/logger.ts`, `src/utils/log-parser.ts` and its helpers wherever applicable. Current `getCurrentLogFiles()` in `src/commands/shared.ts` feeds recursive removal; explicitly exclude the entire `.metrics` subtree and fixed `validation-metrics.json`, not just hidden filenames. Preserve execution/debug/run-lock exclusions. Add recorder/store tests under `test/metrics/` and relevant predicate regressions under `test/commands/` and `test/output/`.

Read design “Record model,” “Private storage, commits, and concurrency,” and “Aggregates and standalone snapshot.” This independently verifiable foundation owns recorder/storage operations and publication, not command-entry refactoring, provider mappings or archive movement. Where copied requirements include command behavior, verify the recorder's returned durability/publication facts using controlled callers; actual CLI callers must later preserve those facts. Receipt requirements here constrain retained indexes/references; this unit does not expose receipt commands or assert consumer incorporation.

Implement `.metrics/store.json`, atomically replaced `state.json`, immutable `records/<record-id>/<revision>.json`, and storage support for independently committed scope/disposition, receipt and closure references. Concrete internal modules may follow repository conventions; the design's private layout is not a consumer API. Allocate stable UUID identities and positive revisions; atomically commit attempt creation with invocation membership. Persist prepared/running/terminal evidence and original parent/context; in-memory attempted dispatch membership must survive an individual failed write as an explicit history gap. Recovery of a known-dead owner retains interrupted state without invented completion time, usage or success.

Serialize metadata changes using a bounded interprocess lock with PID plus ownership nonce, live-owner protection and dead-owner verification before stale recovery. If a run lock is also needed the order is run then metadata. Do not hold metadata ownership during model execution or bulk archive moves. Under the lock reread current metadata, commit immutable files on the same filesystem using write/flush/close/rename and required directory flushes before publishing the commit root. Failed required flushes cannot yield durable success. Uncommitted orphan files are not evidence. Corrupt or unsupported storage is preserved and diagnosed, never reset to empty complete history.

Expose recorder operations for creating/joining active sessions, recording invocation/attempt updates, marking lifecycle boundaries, isolated no-session invocation writes, selecting committed heads and publishing a single-session snapshot. Closing/closed sessions cannot be joined. Archive recovery itself belongs to the close coordinator; delivery access must read a committed generation without reading its journal. Metadata updates merge latest indexes/dispositions, never restore stale closure state. Keep pending revisions across newer heads and session replacement. Retention tracks active/latest, pending consumer, receipt and closure references; no TTL releases pending work. Revision dispositions eventually release overlapping receipt pins while small idempotence/gap metadata remains.

Publish `<log_dir>/validation-metrics.json` atomically from committed heads with owner invocation, snapshot ID and independent current/session aggregates. Failed or incomplete final writes report degraded/unavailable publication rather than claiming a prior file as current. The recorder should return safe bounded diagnostics so callers preserve their original operational results. Standalone uncorrelated records are not scoped consumer work. Retain per-record mixed versions exactly and use the contract's explicit aggregate mapping behavior.

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

## Test Plan

Own INT-001 at the first executable real recorder → store → publisher boundary. Use independently scheduled controlled review workers and controlled validation outcomes, not actual paid adapters. Include actual file/metadata locks across processes, interrupted writes and deterministic file/directory flush failure injection; test that the recorder's failure path preserves a caller's original result. Command integration also needs regression checks that its finalization owner uses these guarantees. The copied retention/receipt scenarios define reference semantics; integrated archive/receipt journeys must use the eventual public operations, not private edits presented as acceptance.

From the approved `test-plan.md`, retained verbatim:

### INT-001: Recorder, filesystem commits, and concurrent publication

- Covers: VM “Stable attempt identity and review correlation” and “Attempt lifecycle and failure evidence”; RL “Dispatch lifecycle preserves failed and interrupted work” and “Additive structured results and telemetry failure isolation”; LM “Atomic latest-session snapshot publication.”
- Boundary: Real invocation/attempt recorder → file-backed store → snapshot publisher; independently scheduled review workers and concurrent readers.
- Setup: Unique temporary store; multiple gates/slots sharing an adapter; controlled execution outcomes; barriers around revision write, required flush, rename, commit-root publication, and attempt/invocation finalization. Use independent processes for metadata-lock contention, live-owner protection, and stale-owner recovery.
- Action: Commit prepared/running/terminal evidence concurrently; kill a writer at selected persistence boundaries; reopen the store; overlap snapshot reads with replacement; inject initial/final persistence and required-flush failures.
- Assertions: Parent membership and committed attempts agree; no lost parallel update; IDs persist across revisions; new dispatches use new IDs; uncommitted orphan files are not exported as complete evidence. Readers see complete old or complete new snapshots. Failure leaves honest incomplete history/publication and preserves the original validation result/exit semantics. A successful durable acknowledgment/publication claim cannot precede required successful persistence steps. Unobserved execution completion/time/usage is never synthesized after a kill.
- **Constraints:** Inspect private state only in integration tests; caller acceptance must use public surfaces. Test file and directory flush failures deterministically instead of relying solely on permissions that may not fail under elevated CI users.
- Execution: `test/metrics/` and affected core/command integration tests via `bun run test` in local development and Linux CI; include actual subprocess tests, not only mocked promises.

## Done When

- Recorder operations preserve all committed attempts and parent membership under parallel updates; initial/final failures report degraded evidence and preserve the controlled caller's original outcome.
- The recorder/store/publisher portion of INT-001 passes against real filesystems and subprocesses, including live-owner protection, stale recovery, orphans, required flush ordering/failures, atomic concurrent readers and incomplete interrupted records. Record the actual-executor result-preservation and dispatch-membership supplement as outstanding until command lifecycle integration exercises it; do not mark the complete INT-001 obligation passed at this foundation boundary.
- Snapshot ownership and mixed-version provenance are truthful; no previous snapshot masquerades as the current invocation's successful final publication.
- Existing current-log/run-number/rerun/removal predicates explicitly protect the fixed snapshot and entire private store, and regression tests preserve ordinary log naming, retry and failure-context behavior.
- Storage exposes independently accessible committed delivery state and lifecycle/reference operations without requiring archive recovery or promising that receipt/closure CLI integration is complete.

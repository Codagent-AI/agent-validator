## ADDED Requirements

### Requirement: One-shot review suppression on rerun
When the validator runs in rerun mode (existing logs in the log directory) and a review gate has `one_shot: true` in its loaded config, the system MUST suppress AI dispatch for that review and synthesise the gate result from the most recent review JSON for that review in the log directory. Suppression applies to every review slot of a one-shot gate regardless of `num_reviews`. Suppression SHALL NOT apply on a first run (no existing logs) — the initial dispatch always runs the AI.

The gate's status SHALL be derived from the violations array of the most recent prior JSON for each slot as follows:

- Any violation with `status: "new"` (or missing `status`) → the slot's status is `"fail"` and the violations array carries those `new` violations forward.
- All violations have `status: "fixed"` or `status: "skipped"`, and at least one is `"skipped"` → the slot's status is `"pass"` and the resulting gate result SHALL be treated as `passed_with_warnings` by the run aggregator (mirroring existing skipped-violation handling).
- All violations have `status: "fixed"` (none `"skipped"`, none `"new"`) → the slot's status is `"pass"`.
- The prior JSON had no violations (initial run reported `status: "pass"` with an empty array) → the slot's status is `"pass"`.

When a one-shot review's most recent JSON has `status: "error"`, or no parseable JSON exists for that review, the system MUST NOT suppress the review. Instead, it SHALL dispatch the review as a first-run AI invocation (no rerun-mode prompt, full diff, no previous-violations injection) and write the result as a fresh first-iteration log.

A one-shot review SHALL NOT be redispatched on rerun by passing `--enable-review <name>`. The flag continues to govern whether disabled reviews generate jobs, but does not override suppression.

#### Scenario: One-shot review with outstanding new violations on rerun
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the log directory contains a prior review JSON for `task-compliance` with two violations both with `status: "new"`
- **WHEN** the validator runs in rerun mode
- **THEN** no AI review SHALL be dispatched for `task-compliance`
- **AND** the gate SHALL report a fail status carrying both violations forward
- **AND** the gate's contribution to the overall run status SHALL count as a failure

#### Scenario: One-shot review with all violations fixed on rerun
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the log directory contains a prior review JSON with three violations all with `status: "fixed"`
- **WHEN** the validator runs in rerun mode
- **THEN** no AI review SHALL be dispatched for `task-compliance`
- **AND** the gate SHALL report a pass status
- **AND** the run SHALL NOT mark the gate as a failure

#### Scenario: One-shot review with mixed fixed and skipped violations on rerun
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the log directory contains a prior review JSON with violations: two `"fixed"` and one `"skipped"`
- **WHEN** the validator runs in rerun mode
- **THEN** no AI review SHALL be dispatched for `task-compliance`
- **AND** the gate SHALL report a pass status
- **AND** the overall run aggregator SHALL surface `passed_with_warnings` (consistent with existing `hasSkippedViolationsInLogs` semantics)

#### Scenario: One-shot review whose prior run errored
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the most recent prior review JSON for `task-compliance` has `status: "error"`
- **WHEN** the validator runs in rerun mode
- **THEN** the AI review SHALL be dispatched normally (full first-run prompt, no rerun-mode header, no previous-violations injection)
- **AND** the dispatch SHALL write a fresh review log

#### Scenario: One-shot review with unparseable prior JSON
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the most recent prior review JSON for `task-compliance` cannot be parsed (corrupt file or missing required fields)
- **WHEN** the validator runs in rerun mode
- **THEN** the AI review SHALL be dispatched normally as a first-run invocation

#### Scenario: First run of a one-shot review always dispatches
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** the log directory is empty or contains no JSON for `task-compliance`
- **WHEN** the validator runs
- **THEN** the AI review SHALL be dispatched normally (first-run mode)

#### Scenario: Non-one-shot reviews continue to rerun normally
- **GIVEN** a review `code-quality` with `one_shot: false` (or omitted)
- **AND** the log directory contains a prior review JSON with outstanding violations
- **WHEN** the validator runs in rerun mode
- **THEN** the AI review SHALL be dispatched in rerun-verification mode against the narrowed diff (existing behaviour)

#### Scenario: --enable-review does not override suppression on rerun
- **GIVEN** a review `task-compliance` with `one_shot: true` and `enabled: false`
- **AND** the log directory contains a prior review JSON with outstanding violations
- **WHEN** the validator runs with `--enable-review task-compliance` in rerun mode
- **THEN** no AI review SHALL be dispatched
- **AND** the gate result SHALL be synthesised from the stored JSON

#### Scenario: One-shot review after logs cleaned
- **GIVEN** a review `task-compliance` with `one_shot: true`
- **AND** a previous session ended successfully and auto-clean archived the logs (no JSON remains in the active log dir)
- **WHEN** the validator runs again
- **THEN** the run SHALL be a first-run (logs are empty) and the AI review SHALL be dispatched normally

### Requirement: Preserved one-shot iteration log
When the validator suppresses AI dispatch for a one-shot review on rerun, it MUST write a fresh per-iteration log file for that review slot so the retry loop, the run aggregator, the report flag output, and any external orchestrator see that the gate ran. The new log SHALL use the existing review log filename convention (`review_<entrypoint>_<name>_<adapter>@<slot>.<iteration>.json` and the corresponding `.log`) with the iteration number advanced as for any rerun.

The JSON SHALL include:

- `status`: one of `"preserved_one_shot"` (when slot's synthesised status is `"pass"`) or `"fail"` (when carrying forward `new` violations).
- `violations`: the violations carried forward from the most recent prior JSON, with each violation's `status` preserved (`new`, `fixed`, or `skipped`) so subsequent `update-review` operations continue to work against the latest log file.
- `rawOutput`: empty string.
- `adapter`: copied from the most recent prior JSON.
- `timestamp`: ISO 8601 timestamp of the suppression decision.
- A `preservedFromIteration: <number>` field indicating the iteration number of the prior JSON whose state was preserved.

The new `preserved_one_shot` status SHALL be treated by `hasSkippedViolationsInLogs`, log parsers, and the rerun status aggregator as a non-failure terminal state equivalent to `"pass"`/`"skipped_prior_pass"`. Skipped violations contained in a `preserved_one_shot` log SHALL continue to surface `passed_with_warnings` via the existing `hasSkippedViolationsInLogs` path.

#### Scenario: Preserved log written for suppressed pass
- **GIVEN** a one-shot review whose prior JSON had all violations `"fixed"`
- **WHEN** the validator suppresses dispatch and synthesises the gate result on rerun
- **THEN** a new `.json` log file SHALL be written for the slot with `status: "preserved_one_shot"`
- **AND** the violations array SHALL match the prior JSON's violations (with their statuses)
- **AND** the filename iteration number SHALL be one greater than the highest existing iteration for the slot

#### Scenario: Preserved log written for suppressed fail
- **GIVEN** a one-shot review whose prior JSON had at least one violation with `status: "new"`
- **WHEN** the validator suppresses dispatch on rerun
- **THEN** a new `.json` log file SHALL be written for the slot with `status: "fail"`
- **AND** the violations array SHALL include all carried-forward violations (preserving each `status`)
- **AND** `update-review fix <id>` operations SHALL target the new log file's violations

#### Scenario: Preserved log included in run report
- **GIVEN** the validator suppressed a one-shot review and wrote a `preserved_one_shot` log
- **WHEN** the run produces its status output (with or without `--report`)
- **THEN** the gate SHALL appear in the executed-gates list (not the skipped-gates list)
- **AND** the gate's status SHALL contribute to the overall run status using the synthesised pass/fail

#### Scenario: Skipped violations in preserved log produce warnings
- **GIVEN** a one-shot review whose prior JSON had violations all `"fixed"` or `"skipped"` with at least one `"skipped"`
- **WHEN** the validator writes the preserved log on rerun and aggregates results
- **THEN** the run SHALL report `passed_with_warnings` (consistent with `hasSkippedViolationsInLogs` semantics applied to the new log)

#### Scenario: preserved_one_shot recognised by log parser
- **GIVEN** a `.json` review log with `status: "preserved_one_shot"`
- **WHEN** the log parser scans the directory for previous passed slots
- **THEN** the slot SHALL be treated as passed (matching the existing `pass` / `skipped_prior_pass` treatment)

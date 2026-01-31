# stop-hook Spec Delta

## MODIFIED Requirements

### Requirement: Unified Status Type

The system MUST use a single `GauntletStatus` type for all gauntlet outcomes, shared between the run executor and stop-hook.

#### Scenario: Direct status usage
- **GIVEN** executeRun returns a RunResult with status
- **WHEN** the stop-hook processes the result
- **THEN** it SHALL use the `GauntletStatus` value directly in the hook response
- **AND** it SHALL NOT map or translate the status to a different value
- **AND** the same status type is used by both executor and hook response

#### Scenario: No status mapping
- **GIVEN** the executor returns a `GauntletStatus` value
- **WHEN** the stop-hook builds its response
- **THEN** it SHALL use that exact status value in the hook response
- **AND** no mapping function SHALL exist between different status types

#### Scenario: Blocking determination
- **GIVEN** a `GauntletStatus` value is received
- **WHEN** the stop-hook determines the hook decision
- **THEN** it SHALL use a shared `isBlockingStatus()` helper
- **AND** `"failed"`, `"pr_push_required"`, `"ci_pending"`, and `"ci_failed"` statuses SHALL result in a block decision

## ADDED Requirements

### Requirement: StopHookResult CI Fields

The `StopHookResult` interface (`src/hooks/adapters/types.ts:24`) SHALL include additional fields for CI workflow instructions.

#### Scenario: ciFixReason field for ci_failed status
- **GIVEN** the handler determines status is `ci_failed`
- **WHEN** the `StopHookResult` is constructed
- **THEN** it SHALL include a `ciFixReason` field with fix instructions on `StopHookResult` (`src/hooks/adapters/types.ts:24`)
- **AND** adapters SHALL use this field for their blocking response message

#### Scenario: ciPendingReason field for ci_pending status
- **GIVEN** the handler determines status is `ci_pending`
- **WHEN** the `StopHookResult` is constructed
- **THEN** it SHALL include a `ciPendingReason` field with wait-and-retry instructions on `StopHookResult` (`src/hooks/adapters/types.ts:24`)
- **AND** adapters SHALL use this field for their blocking response message

### Requirement: Auto Fix PR Configuration

The stop hook SHALL support an `auto_fix_pr` boolean setting that controls whether the agent waits for CI and addresses failures after a PR is created.

#### Scenario: Setting defaults to false
- **GIVEN** no `auto_fix_pr` setting is configured at any level
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_fix_pr` SHALL default to `false`

#### Scenario: Environment variable override
- **GIVEN** `GAUNTLET_AUTO_FIX_PR` environment variable is set to `"true"` or `"1"`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_fix_pr` SHALL be `true` regardless of project or global config

#### Scenario: Three-tier precedence
- **GIVEN** `GAUNTLET_AUTO_FIX_PR` is set to `"false"`
- **AND** project config has `stop_hook.auto_fix_pr: true`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_fix_pr` SHALL be `false` (env var wins)

#### Scenario: Requires auto_push_pr
- **GIVEN** `auto_fix_pr` is configured as `true`
- **AND** `auto_push_pr` is configured as `false`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_fix_pr` SHALL be treated as `false`
- **AND** the system SHALL log a warning

#### Scenario: auto_push_pr flow completes before CI wait
- **GIVEN** `auto_fix_pr` is `true`
- **AND** `auto_push_pr` is `true`
- **AND** no PR exists for the current branch (or PR is not up to date)
- **WHEN** the stop hook processes the result
- **THEN** it SHALL follow the `auto_push_pr` flow first (block with `pr_push_required`)
- **AND** it SHALL NOT enter the CI wait workflow until the PR exists and is up to date

### Requirement: CI Workflow Status Values

The system SHALL include `ci_pending`, `ci_failed`, `ci_passed`, and `ci_timeout` statuses in the `GauntletStatus` type for CI workflow states.

#### Scenario: ci_pending blocks the stop
- **GIVEN** the stop hook determines status is `ci_pending`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: ci_failed blocks the stop
- **GIVEN** the stop hook determines status is `ci_failed`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: ci_passed approves the stop
- **GIVEN** the stop hook determines status is `ci_passed`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `false`

#### Scenario: ci_passed is a success status
- **GIVEN** the status is `ci_passed`
- **WHEN** `isSuccessStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: ci_timeout approves the stop
- **GIVEN** the stop hook determines status is `ci_timeout`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `false`

#### Scenario: ci_timeout is not a success status
- **GIVEN** the status is `ci_timeout`
- **WHEN** `isSuccessStatus()` is called
- **THEN** it SHALL return `false`

### Requirement: Wait CI Command

The system SHALL provide an `agent-gauntlet wait-ci` CLI command that polls GitHub CI status and review comments for the current branch's PR.

#### Scenario: PR found for current branch
- **GIVEN** the current branch has an open PR
- **WHEN** `wait-ci` runs
- **THEN** it SHALL poll CI check status via `gh pr checks`
- **AND** it SHALL fetch review comments via `gh api`

#### Scenario: No PR found
- **GIVEN** no PR exists for the current branch
- **WHEN** `wait-ci` runs
- **THEN** it SHALL output JSON with `ci_status: "error"` and a message indicating no PR found
- **AND** it SHALL exit with code 1

#### Scenario: All checks pass with no blocking reviews
- **GIVEN** all CI checks have completed successfully
- **AND** there are no blocking review comments
- **WHEN** `wait-ci` evaluates the results
- **THEN** it SHALL output JSON with `ci_status: "passed"`
- **AND** exit with code 0

#### Scenario: One or more checks fail
- **GIVEN** one or more CI checks have failed
- **WHEN** `wait-ci` evaluates the results
- **THEN** it SHALL output JSON with `ci_status: "failed"` and details of failed checks
- **AND** exit with code 1

#### Scenario: Some checks failed while others pending
- **GIVEN** some CI checks have failed
- **AND** other CI checks are still pending or in progress
- **WHEN** `wait-ci` evaluates the results
- **THEN** it SHALL output JSON with `ci_status: "failed"` immediately without waiting for pending checks
- **AND** exit with code 1

#### Scenario: Blocking review comments present
- **GIVEN** all CI checks have passed
- **AND** there are blocking review comments (see Blocking Review Comment Definition)
- **WHEN** `wait-ci` evaluates the results
- **THEN** it SHALL output JSON with `ci_status: "failed"` and the review comment details
- **AND** exit with code 1

#### Scenario: Checks still pending at timeout
- **GIVEN** some CI checks are still pending or in progress
- **AND** no checks have failed
- **AND** the timeout has elapsed
- **WHEN** `wait-ci` evaluates the results
- **THEN** it SHALL output JSON with `ci_status: "pending"`
- **AND** exit with code 2

#### Scenario: Configurable timeout
- **GIVEN** `wait-ci` is invoked with `--timeout 120`
- **WHEN** the command runs
- **THEN** it SHALL poll for at most 120 seconds before timing out

#### Scenario: Configurable poll interval
- **GIVEN** `wait-ci` is invoked with `--poll-interval 30`
- **WHEN** the command polls
- **THEN** it SHALL wait 30 seconds between each poll

#### Scenario: gh CLI not installed
- **GIVEN** the `gh` CLI is not available on the system
- **WHEN** `wait-ci` runs
- **THEN** it SHALL exit with code 1 and a clear error message indicating `gh` is required

### Requirement: Blocking Review Comment Definition

The `wait-ci` command SHALL define blocking review comments as reviews or threads that indicate the PR needs changes before merging.

#### Scenario: REQUEST_CHANGES review is blocking
- **GIVEN** a PR review has state `REQUEST_CHANGES`
- **AND** the review has not been dismissed
- **WHEN** `wait-ci` evaluates review comments
- **THEN** it SHALL treat the review as blocking

#### Scenario: APPROVED review is not blocking
- **GIVEN** a PR review has state `APPROVED`
- **WHEN** `wait-ci` evaluates review comments
- **THEN** it SHALL NOT treat the review as blocking

#### Scenario: COMMENTED review is not blocking
- **GIVEN** a PR review has state `COMMENTED` (informational comment without approval or change request)
- **WHEN** `wait-ci` evaluates review comments
- **THEN** it SHALL NOT treat the review as blocking

#### Scenario: Review comments included in output regardless of blocking status
- **GIVEN** there are review comments from any source (human or bot)
- **WHEN** `wait-ci` produces output
- **THEN** it SHALL include all review comments in the `review_comments` array for informational purposes
- **AND** only `REQUEST_CHANGES` reviews SHALL affect the `ci_status` determination

### Requirement: CI Wait Retry Tracking

The stop hook SHALL track CI wait attempts across invocations using a marker file to prevent indefinite CI polling.

#### Scenario: First CI wait attempt
- **GIVEN** `auto_fix_pr` is enabled
- **AND** a PR exists for the current branch and is up to date
- **AND** no CI wait attempts marker file exists
- **WHEN** the stop hook runs `wait-ci` and CI is still pending
- **THEN** it SHALL create the marker file with attempt count 1
- **AND** block with `ci_pending` status and instructions to retry

#### Scenario: Subsequent CI wait attempt
- **GIVEN** the CI wait attempts marker file shows count 1
- **WHEN** the stop hook runs `wait-ci` and CI is still pending
- **THEN** it SHALL increment the marker to count 2
- **AND** block with `ci_pending` status and instructions to retry

#### Scenario: Maximum attempts reached
- **GIVEN** the CI wait attempts marker file shows count >= 3
- **WHEN** the stop hook checks the attempt count
- **THEN** it SHALL approve the stop with `ci_timeout` status and a message indicating CI wait was exhausted
- **AND** it SHALL clean up the marker file

#### Scenario: CI completes (pass or fail) cleans marker
- **GIVEN** the CI wait attempts marker file exists
- **WHEN** `wait-ci` returns `passed` or `failed`
- **THEN** the stop hook SHALL clean up the marker file

### Requirement: CI Fix Instructions

When blocking with `ci_failed` status, the `reason` prompt SHALL instruct the agent to fix CI failures and address review comments.

#### Scenario: Instructions include failure details
- **GIVEN** the stop hook blocks with `ci_failed`
- **AND** the `wait-ci` result includes failed check names and review comments
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL include the specific failed check names and review comment details

#### Scenario: Instructions tell agent to fix and push
- **GIVEN** the stop hook blocks with `ci_failed`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to fix issues and push changes
- **AND** it SHALL instruct the agent to try stopping again after pushing

### Requirement: CI Pending Instructions

When blocking with `ci_pending` status, the `reason` prompt SHALL instruct the agent to wait and retry.

#### Scenario: Instructions include attempt count
- **GIVEN** the stop hook blocks with `ci_pending`
- **AND** this is attempt 2 of 3
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL indicate the attempt number (e.g., "attempt 2 of 3")

#### Scenario: Instructions tell agent to wait and stop again
- **GIVEN** the stop hook blocks with `ci_pending`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to wait approximately 30 seconds and then try to stop again

### Requirement: Adapter Protocol CI Status Handling

Both Claude Code and Cursor adapters MUST handle the CI workflow statuses (`ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout`) in their output formatting (`src/hooks/adapters/cursor-stop-hook.ts:77`, `src/hooks/adapters/claude-stop-hook.ts:55`; spec reference: `specs/stop-hook/spec.md`).

#### Scenario: Cursor adapter handles ci_failed
- **GIVEN** the handler returns status `ci_failed` with `ciFixReason`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<ciFixReason>" }`

#### Scenario: Cursor adapter handles ci_pending
- **GIVEN** the handler returns status `ci_pending` with `ciPendingReason`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<ciPendingReason>" }`

#### Scenario: Cursor adapter handles ci_passed
- **GIVEN** the handler returns status `ci_passed`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be an empty object `{}`
- **AND** no `followup_message` field SHALL be present

#### Scenario: Cursor adapter handles ci_timeout
- **GIVEN** the handler returns status `ci_timeout`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be an empty object `{}`
- **AND** no `followup_message` field SHALL be present

#### Scenario: Claude Code adapter handles ci_failed
- **GIVEN** the handler returns status `ci_failed` with `ciFixReason`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"`
- **AND** `reason` SHALL contain the `ciFixReason` instructions

#### Scenario: Claude Code adapter handles ci_pending
- **GIVEN** the handler returns status `ci_pending` with `ciPendingReason`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"`
- **AND** `reason` SHALL contain the `ciPendingReason` instructions

#### Scenario: Claude Code adapter handles ci_passed
- **GIVEN** the handler returns status `ci_passed`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "approve"`
- **AND** `reason` SHALL contain the `ci_passed` status message

#### Scenario: Claude Code adapter handles ci_timeout
- **GIVEN** the handler returns status `ci_timeout`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "approve"`
- **AND** `reason` SHALL contain the `ci_timeout` status message

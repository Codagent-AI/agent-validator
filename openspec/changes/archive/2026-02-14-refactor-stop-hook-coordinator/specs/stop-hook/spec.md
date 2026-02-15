## MODIFIED Requirements

### Requirement: Gauntlet Execution

The stop hook command SHALL NOT execute gates itself. Instead, it SHALL read observable state (run logs, execution state, PR/CI status) and instruct the agent to invoke the appropriate skill when action is needed.

#### Scenario: No gate execution in stop hook
- **GIVEN** the stop-hook determines validation is needed
- **WHEN** it processes the stop event
- **THEN** it SHALL NOT call `executeRun()` or any gate execution function
- **AND** it SHALL block the stop with an instruction to use the `gauntlet-run` skill

#### Scenario: State-based decision from run logs
- **GIVEN** run log files exist in the log directory from a previous failed run
- **WHEN** the stop hook evaluates state
- **THEN** it SHALL detect the failed state by reading existing logs
- **AND** it SHALL block with an instruction to use the `gauntlet-run` skill

#### Scenario: State-based decision from change detection
- **GIVEN** no failed run logs exist
- **AND** the execution state has a `working_tree_ref` from a previous passing run
- **AND** the current working tree differs from that `working_tree_ref`
- **WHEN** the stop hook evaluates state
- **THEN** it SHALL detect the change and block with an instruction to use the `gauntlet-run` skill

#### Scenario: No changes since last passing run
- **GIVEN** no failed run logs exist
- **AND** the execution state has a `working_tree_ref` from a previous passing run
- **AND** the current working tree matches that `working_tree_ref`
- **WHEN** the stop hook evaluates state
- **THEN** it SHALL allow the stop

#### Scenario: No execution state exists
- **GIVEN** no `.execution_state` file exists
- **AND** no run logs exist
- **WHEN** the stop hook evaluates state
- **THEN** it SHALL check for changes vs the base branch
- **AND** if changes exist, it SHALL block with an instruction to use the `gauntlet-run` skill
- **AND** if no changes exist, it SHALL allow the stop

### Requirement: Simplified Stop Hook Flow

The stop-hook command SHALL be a stateless coordinator that reads observable state and instructs the agent to invoke skills. It performs pre-checks, reads state, and returns a decision without executing any gates.

#### Scenario: Execution order
- **GIVEN** the stop-hook receives a stop event
- **WHEN** it processes the event
- **THEN** it SHALL execute checks in this order:
  1. Check `GAUNTLET_STOP_HOOK_ACTIVE_ENV` environment variable
  2. Check for `.gauntlet/config.yml` presence
  3. Check marker file for nested stop-hooks
  4. Parse stdin JSON and detect adapter
  5. Check adapter-specific early exit (e.g., Cursor loop_count)
  6. Check if stop hook is disabled via configuration
  7. Check for failed run logs
  8. Check if run interval has elapsed (only when no failed logs exist)
  9. Check for changes since last passing run
  10. Check PR status (if `auto_push_pr` enabled)
  11. Check CI status (if `auto_fix_pr` enabled, single read, no polling)
- **AND** no gate execution SHALL occur in the stop hook

#### Scenario: Run interval not elapsed
- **GIVEN** no failed run logs exist
- **AND** the `run_interval_minutes` has not elapsed since the last run
- **WHEN** the stop hook evaluates state
- **THEN** it SHALL allow the stop without checking for changes

#### Scenario: No duplicate utility functions
- **GIVEN** the stop-hook implementation
- **WHEN** it needs to determine gauntlet state
- **THEN** it SHALL read existing log files and execution state
- **AND** it SHALL NOT define gate execution functions

### Requirement: Enhanced Stop Reason Instructions

When the stop-hook blocks the agent, the `reason` message SHALL be a concise instruction to invoke the appropriate skill, not detailed failure logs or fix procedures.

#### Scenario: Block when validation is required
- **GIVEN** the stop hook detects changes that need validation (failed logs exist or working tree changed)
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `reason` SHALL instruct the agent to use the `gauntlet-run` skill
- **AND** the `reason` SHALL NOT include log file paths, trust level guidance, or violation handling procedures

#### Scenario: Block when a PR is required
- **GIVEN** the stop hook detects that a PR needs to be created or updated
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `reason` SHALL instruct the agent to use the `gauntlet-push-pr` skill

#### Scenario: Block when a CI fix is required
- **GIVEN** the stop hook detects CI failures or pending checks
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `reason` SHALL instruct the agent to use the `gauntlet-fix-pr` skill

### Requirement: Status-Based Decision Making

The command SHALL determine allow/block decisions based on observable state, using the unified GauntletStatus for response output.

#### Scenario: Status passed (no changes since)
- **GIVEN** no failed run logs exist
- **AND** working tree has not changed since last passing run
- **WHEN** the command processes state
- **THEN** it SHALL allow stop (approve decision)

#### Scenario: Status validation_required (failed logs)
- **GIVEN** failed run logs exist in the log directory
- **WHEN** the command processes state
- **THEN** it SHALL block stop with status `validation_required`

#### Scenario: Status validation_required (changes detected)
- **GIVEN** no failed run logs exist
- **AND** the working tree has changed since the last passing run
- **WHEN** the command processes state
- **THEN** it SHALL block stop with status `validation_required`

#### Scenario: Status passed_with_warnings
- **GIVEN** the last run completed with `passed_with_warnings` status
- **AND** no changes since
- **WHEN** the command processes state
- **THEN** it SHALL allow stop (approve decision)

#### Scenario: Status retry_limit_exceeded
- **GIVEN** the last run completed with `retry_limit_exceeded` status (logs auto-archived)
- **AND** no changes since
- **WHEN** the command processes state
- **THEN** it SHALL allow stop (approve decision) because the runner archived the logs

### Requirement: Block Decision Output

The command SHALL output skill invocation instructions for the agent when blocking stop.

#### Scenario: Block with skill instruction for validation
- **GIVEN** validation is needed (changes detected or failed logs)
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field instructing the agent to use the `gauntlet-run` skill
- **AND** the JSON SHALL include a `status` field set to `"validation_required"`
- **AND** the JSON SHALL include a `message` field with a brief summary

#### Scenario: Block with skill instruction for PR
- **GIVEN** gates have passed but PR is missing or outdated
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field instructing the agent to use the `gauntlet-push-pr` skill
- **AND** the JSON SHALL include a `status` field set to `"pr_push_required"`

#### Scenario: Block with skill instruction for CI
- **GIVEN** PR exists but CI is pending or failed
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field instructing the agent to use the `gauntlet-fix-pr` skill
- **AND** the JSON SHALL include a `status` field set to `"ci_pending"` or `"ci_failed"`

#### Scenario: Handler result structure
- **GIVEN** the handler determines a block is needed
- **WHEN** it returns the result to the adapter
- **THEN** the result SHALL include `status`, `message`, and `reason` fields
- **AND** the adapter SHALL format the final output according to its protocol (see Adapter Protocol requirements)

### Requirement: Post-Gauntlet PR Detection

When `auto_push_pr` is enabled and the stop hook determines validation has passed (no failed logs, no changes since last pass), the stop hook SHALL check whether a PR exists and is up-to-date for the current branch before allowing stop.

#### Scenario: No PR exists after validation passed
- **GIVEN** `auto_push_pr` is `true`
- **AND** no failed run logs exist and working tree has not changed since last pass
- **AND** no open PR exists for the current branch
- **WHEN** the stop hook processes state
- **THEN** it SHALL block with `pr_push_required` status
- **AND** the `reason` field SHALL instruct the agent to use the `gauntlet-push-pr` skill

#### Scenario: PR exists but is not up-to-date
- **GIVEN** `auto_push_pr` is `true`
- **AND** validation has passed
- **AND** an open PR exists for the current branch
- **AND** the PR head SHA does not match the local HEAD SHA
- **WHEN** the stop hook processes state
- **THEN** it SHALL block with `pr_push_required` status

#### Scenario: PR exists and is up-to-date
- **GIVEN** `auto_push_pr` is `true`
- **AND** validation has passed
- **AND** an open PR exists with matching head SHA
- **WHEN** the stop hook processes state
- **THEN** it SHALL proceed to CI check (if `auto_fix_pr` enabled) or allow stop

#### Scenario: auto_push_pr is disabled
- **GIVEN** `auto_push_pr` is `false`
- **AND** validation has passed
- **WHEN** the stop hook processes state
- **THEN** it SHALL allow stop without checking PR status

#### Scenario: auto_fix_pr is disabled
- **GIVEN** `auto_fix_pr` is `false`
- **AND** validation has passed and PR is up to date
- **WHEN** the stop hook processes state
- **THEN** it SHALL allow stop without checking CI status

#### Scenario: gh CLI not available
- **GIVEN** `auto_push_pr` is `true`
- **AND** the `gh` CLI is not installed
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning
- **AND** it SHALL allow stop (graceful degradation)

#### Scenario: PR detection fails due to gh error
- **GIVEN** `auto_push_pr` is `true`
- **AND** `gh pr view` fails (network, auth, etc.)
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning and allow stop (graceful degradation)

### Requirement: Push PR Instructions

When blocking with `pr_push_required` status, the `reason` prompt SHALL instruct the agent to invoke the push-pr skill.

#### Scenario: Instructions reference skill
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to use the `gauntlet-push-pr` skill

#### Scenario: Skipped issues note
- **GIVEN** the last passing run had `passed_with_warnings` status
- **AND** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL note that some issues were skipped during validation

### Requirement: CI Status Check

The stop hook SHALL check CI status once per invocation via a single `gh pr checks` read with no polling loop and no cross-invocation attempt tracking. The stop hook blocks until CI passes; there is no `ci_timeout` escape hatch.

#### Scenario: CI status check (single read, no polling)
- **GIVEN** `auto_fix_pr` is enabled
- **AND** a PR exists for the current branch and is up to date
- **WHEN** the stop hook checks CI status
- **THEN** it SHALL check `gh pr checks` once (no polling loop)
- **AND** it SHALL NOT maintain cross-invocation state (no marker files or attempt counters)
- **AND** it SHALL return the result immediately

#### Scenario: CI pending
- **GIVEN** CI checks are still pending
- **WHEN** the stop hook checks CI status
- **THEN** it SHALL block with `ci_pending` status instructing the agent to use the `gauntlet-fix-pr` skill

#### Scenario: CI failed
- **GIVEN** CI checks have failed
- **WHEN** the stop hook checks CI status
- **THEN** it SHALL block with `ci_failed` status instructing the agent to use the `gauntlet-fix-pr` skill

#### Scenario: CI passed
- **GIVEN** all CI checks passed
- **WHEN** the stop hook checks CI status
- **THEN** it SHALL allow the stop with `ci_passed` status

#### Scenario: No PR exists when checking CI
- **GIVEN** `auto_fix_pr` is enabled
- **AND** no PR exists for the current branch
- **WHEN** the stop hook attempts to check CI status
- **THEN** it SHALL skip the CI check and allow stop

#### Scenario: gh pr checks fails due to error
- **GIVEN** `auto_fix_pr` is enabled
- **AND** `gh pr checks` fails (network, auth, etc.)
- **WHEN** the stop hook attempts to check CI status
- **THEN** it SHALL log a warning and allow stop (graceful degradation)

### Requirement: CI Fix Instructions

When blocking with `ci_failed` status, the `reason` prompt SHALL instruct the agent to invoke the fix-pr skill.

#### Scenario: Instructions reference skill
- **GIVEN** the stop hook blocks with `ci_failed`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to use the `gauntlet-fix-pr` skill
- **AND** it SHALL NOT include inline failure details or fix procedures

### Requirement: CI Pending Instructions

When blocking with `ci_pending` status, the `reason` prompt SHALL instruct the agent to wait and invoke the fix-pr skill.

#### Scenario: Instructions reference skill
- **GIVEN** the stop hook blocks with `ci_pending`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to use the `gauntlet-fix-pr` skill to check CI status and wait

### Requirement: Adapter Protocol CI Status Handling

Both Claude Code and Cursor adapters MUST handle the CI workflow statuses (`ci_pending`, `ci_failed`, `ci_passed`) and the new `validation_required` status in their output formatting.

#### Scenario: Cursor adapter handles the `validation_required` status
- **GIVEN** the handler returns status `validation_required` with a skill instruction
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<skill instruction>" }`

#### Scenario: Cursor adapter handles ci_failed
- **GIVEN** the handler returns status `ci_failed` with a skill instruction
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<skill instruction>" }`

#### Scenario: Cursor adapter handles ci_pending
- **GIVEN** the handler returns status `ci_pending` with a skill instruction
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<skill instruction>" }`

#### Scenario: Cursor adapter handles ci_passed
- **GIVEN** the handler returns status `ci_passed`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be an empty object `{}`

#### Scenario: Claude Code adapter handles the `validation_required` status
- **GIVEN** the handler returns status `validation_required` with a skill instruction
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"` and `reason` containing the skill instruction

#### Scenario: Claude Code adapter handles ci_failed
- **GIVEN** the handler returns status `ci_failed` with a skill instruction
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"` and `reason` containing the skill instruction

#### Scenario: Claude Code adapter handles ci_pending
- **GIVEN** the handler returns status `ci_pending` with a skill instruction
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"` and `reason` containing the skill instruction

#### Scenario: Claude Code adapter handles ci_passed
- **GIVEN** the handler returns status `ci_passed`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "approve"`

## ADDED Requirements

### Requirement: Validation Required Status

The system SHALL include a `validation_required` status in the `GauntletStatus` type that indicates the working tree has changes that need validation or a previous run has unresolved failures.

#### Scenario: Status blocks the stop
- **GIVEN** the stop hook determines status is `validation_required`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: Status message
- **GIVEN** the status is `validation_required`
- **WHEN** the status message is generated
- **THEN** it SHALL indicate that changes were detected and validation is required

### Requirement: Stop Hook State Reading

The stop hook SHALL read observable state from the filesystem and git to determine the current validation status without executing gates.

#### Scenario: Read failed run logs
- **GIVEN** the log directory contains run log files from a failed run
- **WHEN** the stop hook checks state
- **THEN** it SHALL detect the failed logs exist
- **AND** it SHALL determine that validation is incomplete

#### Scenario: Read execution state for change detection
- **GIVEN** an `.execution_state` file exists with a `working_tree_ref`
- **WHEN** the stop hook checks for changes
- **THEN** it SHALL create a new working tree ref via `git stash create --include-untracked`
- **AND** it SHALL compare the new ref against the stored `working_tree_ref` to determine if changes exist

#### Scenario: Check changes vs base branch when no execution state
- **GIVEN** no `.execution_state` file exists
- **WHEN** the stop hook checks for changes
- **THEN** it SHALL detect changes against the configured base branch
- **AND** if changes exist, it SHALL block with `validation_required`

## REMOVED Requirements

### Requirement: Run Executor Function
**Reason**: The stop hook no longer calls `executeRun()`. The run executor remains for the `run` CLI command but is no longer part of the stop hook's contract.
**Migration**: The stop hook reads state instead of executing. The `executeRun()` function continues to exist for `agent-gauntlet run`.

### Requirement: Block Status for Failed Gates
**Reason**: The stop hook no longer runs gates, so it never gets a `failed` status from gate execution. It instead observes failed logs and returns `validation_required`.
**Migration**: The `failed` status still exists for the `run` command output. The stop hook uses `validation_required` for its blocking response when it detects unresolved failures.

### Requirement: Unified Status Type
**Reason**: The stop hook no longer receives `RunResult` from `executeRun()`, so the tight coupling between executor status and hook status is removed. The `GauntletStatus` type still exists but the stop hook produces its own statuses from state observation.
**Migration**: `GauntletStatus` is extended with `validation_required`. The stop hook still uses `isBlockingStatus()` for decision-making.

### Requirement: StopHookResult CI Fields
**Reason**: The `ciFixReason` and `ciPendingReason` fields are no longer needed because the stop hook returns simple skill instructions instead of detailed CI failure formatting.
**Migration**: The `reason` field on `StopHookResult` carries the skill instruction for all blocking statuses.

### Requirement: Stop Hook Stdout Purity
**Reason**: The stop hook no longer calls `executeRun()`, so there is no gate execution output that could pollute stdout. The stdout purity concern is eliminated at the source.
**Migration**: None needed — the stop hook only outputs its JSON response to stdout.

### Requirement: Diff Stats Scoped to Working Tree Reference
**Reason**: This requirement was about the executor computing diff stats during gate execution. The stop hook no longer executes gates, so this is not part of the stop hook spec. The requirement still applies to the `run` command (in `run-lifecycle` spec).
**Migration**: No change to `run` command behavior. This requirement already exists in the `run-lifecycle` spec.

### Requirement: CI Workflow Status Values
**Reason**: The `ci_timeout` status is removed because the stop hook no longer tracks CI wait attempts across invocations. The stop hook blocks as long as CI hasn't passed — there is no timeout escape hatch. The `ci_pending`, `ci_failed`, and `ci_passed` statuses remain.
**Migration**: Remove `ci_timeout` from `GauntletStatus`. The `gauntlet-fix-pr` skill owns the CI wait/fix loop and may implement its own timeout logic.

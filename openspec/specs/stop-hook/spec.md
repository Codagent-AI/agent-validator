# stop-hook Specification

## Purpose
TBD - created by archiving change add-stop-hook. Update Purpose after archive.
## Requirements
### Requirement: Stop Hook Protocol Compliance

The command SHALL read JSON input from stdin and output JSON decisions per the Claude Code hook protocol.

#### Scenario: Valid hook input
- **GIVEN** the command receives valid JSON via stdin with `hook_event_name: "Stop"`
- **WHEN** the command processes the input
- **THEN** it SHALL parse `stop_hook_active`, `cwd`, and other fields correctly

#### Scenario: Missing or invalid JSON
- **GIVEN** the command receives invalid JSON or empty stdin
- **WHEN** the command attempts to parse
- **THEN** it SHALL allow stop (exit 0) to avoid blocking on parse errors

### Requirement: Infinite Loop Prevention

The command MUST check for infinite loop conditions in a specific order to optimize for fast exit.

#### Scenario: Environment variable check before stdin
- **GIVEN** the stop-hook command starts
- **WHEN** `GAUNTLET_STOP_HOOK_ACTIVE_ENV` environment variable is set
- **THEN** it SHALL output `stop_hook_active` response immediately
- **AND** it SHALL NOT read from stdin
- **AND** it SHALL NOT parse any JSON input
- **AND** this allows child Claude processes to exit without waiting for stdin timeout

#### Scenario: Input flag check after stdin
- **GIVEN** the environment variable is not set
- **AND** the stop-hook parses stdin JSON
- **WHEN** the input has `stop_hook_active: true`
- **THEN** it SHALL output `stop_hook_active` response
- **AND** it SHALL NOT proceed to config detection or gauntlet execution

### Requirement: Gauntlet Project Detection

The command SHALL only enforce gauntlet completion for projects with gauntlet configuration.

#### Scenario: No gauntlet config exists
- **GIVEN** the current working directory has no `.gauntlet/config.yml`
- **WHEN** the command runs
- **THEN** it SHALL exit 0 (allowing stop) without running any gates

#### Scenario: Gauntlet config exists
- **GIVEN** the current working directory has `.gauntlet/config.yml`
- **WHEN** the command runs
- **THEN** it SHALL proceed to run the gauntlet

### Requirement: Gauntlet Execution

The command SHALL invoke the gauntlet run logic directly as a function call, passing `checkInterval: true` to enable interval checking in the executor.

#### Scenario: Direct function invocation with checkInterval
- **GIVEN** the stop-hook determines gauntlet should run
- **WHEN** it executes the gauntlet
- **THEN** it SHALL call `executeRun({ cwd, checkInterval: true })` directly
- **AND** it SHALL NOT load global config (executor does this)
- **AND** it SHALL NOT pre-check lock file (executor handles this)
- **AND** it SHALL NOT pre-check interval (executor handles this)
- **AND** it SHALL receive a structured `RunResult` object

#### Scenario: Executor returns interval_not_elapsed
- **GIVEN** the executor determines interval has not elapsed
- **WHEN** `executeRun()` returns `{ status: "interval_not_elapsed" }`
- **THEN** the stop-hook SHALL output an approve response with that status
- **AND** the stop-hook SHALL NOT contain interval-checking logic itself

#### Scenario: Executor returns lock_conflict
- **GIVEN** the executor cannot acquire the lock
- **WHEN** `executeRun()` returns `{ status: "lock_conflict" }`
- **THEN** the stop-hook SHALL output an approve response with that status
- **AND** the stop-hook SHALL NOT contain lock-checking logic itself

---

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
- **AND** `"failed"` and `"pr_push_required"` statuses SHALL result in a block decision

### Requirement: Run Executor Function

The system MUST provide an `executeRun()` function that encapsulates run command logic without process termination.

#### Scenario: No process.exit in executor
- **GIVEN** a caller invokes executeRun()
- **WHEN** the run completes (success or failure)
- **THEN** the function SHALL return a RunResult
- **AND** the function SHALL NOT call process.exit()
- **AND** the caller can inspect the result and decide on next steps

#### Scenario: RunResult contains metadata
- **GIVEN** a gauntlet run completes
- **WHEN** executeRun returns
- **THEN** the RunResult SHALL contain:
  - `status`: the GauntletStatus value (used directly, no mapping)
  - `message`: human-readable explanation
  - `consoleLogPath`: path to latest console.N.log (if applicable)
  - `errorMessage`: error details (if status is error)

### Requirement: Status-Based Decision Making

The command SHALL determine allow/block decisions based on the unified GauntletStatus.

#### Scenario: Status passed
- **GIVEN** executeRun returns `{ status: "passed" }`
- **WHEN** the command processes the result
- **THEN** it SHALL allow stop (approve decision)

#### Scenario: Status passed_with_warnings
- **GIVEN** executeRun returns `{ status: "passed_with_warnings" }`
- **WHEN** the command processes the result
- **THEN** it SHALL allow stop (approve decision)

#### Scenario: Status retry_limit_exceeded
- **GIVEN** executeRun returns `{ status: "retry_limit_exceeded" }`
- **WHEN** the command processes the result
- **THEN** it SHALL allow stop (approve decision) to prevent further retry attempts

#### Scenario: Status failed
- **GIVEN** executeRun returns `{ status: "failed" }`
- **WHEN** the command processes the result
- **THEN** it SHALL output JSON `{"decision": "block", "reason": "..."}` (Claude Code processes the JSON, blocks the stop, and feeds `reason` back as the next prompt)

### Requirement: Block Decision Output

The command SHALL output actionable feedback for the agent when blocking stop. This modification extends the original requirement to include `status` and `message` fields in addition to the existing `reason` field.

#### Scenario: Block with reason
- **GIVEN** gates have failed and stop must be blocked
- **WHEN** the command outputs the decision
- **THEN** the JSON SHALL include a `reason` field explaining that gauntlet gates did not pass
- **AND** the JSON SHALL include a `status` field set to "failed"
- **AND** the JSON SHALL include a `message` field with a brief failure summary

#### Scenario: Output format
- **GIVEN** the command needs to block stop
- **WHEN** it outputs the decision
- **THEN** the output SHALL be valid JSON on a single line: `{"decision": "block", "status": "failed", "message": "...", "reason": "..."}`
- **AND** the format extends the original `{"decision": "block", "reason": "..."}` with additional fields

### Requirement: Execution State Tracking

The system MUST track execution metadata in a `.execution_state` JSON file in the log directory. This file SHALL be written ONLY when gates actually execute (statuses: `passed`, `passed_with_warnings`, `failed`, `retry_limit_exceeded`), not for early-exit conditions (statuses: `no_changes`, `no_applicable_gates`, `error`). The file SHALL contain the branch name, commit SHA, and completion timestamp.

#### Scenario: State file written on successful run
- **GIVEN** the gauntlet run completes successfully with status `passed`
- **WHEN** the run command exits
- **THEN** the `.execution_state` file SHALL be written to the log directory
- **AND** it SHALL contain `last_run_completed_at` with the current ISO timestamp
- **AND** it SHALL contain `branch` with the current git branch name
- **AND** it SHALL contain `commit` with the current HEAD commit SHA

#### Scenario: State file written on failed run
- **GIVEN** the gauntlet run completes with failures (status `failed` or `retry_limit_exceeded`)
- **WHEN** the run command exits
- **THEN** the `.execution_state` file SHALL be written to the log directory
- **AND** it SHALL contain the same fields as a successful run

#### Scenario: State file written for passed_with_warnings
- **GIVEN** the gauntlet run completes with status `passed_with_warnings`
- **WHEN** the run command exits
- **THEN** the `.execution_state` file SHALL be written to the log directory
- **AND** it SHALL contain the same fields as a successful run

#### Scenario: State file NOT written for no_changes
- **GIVEN** the gauntlet run detects no changes
- **WHEN** the run completes with status `no_changes`
- **THEN** the `.execution_state` file SHALL NOT be written or updated

#### Scenario: State file NOT written for no_applicable_gates
- **GIVEN** the gauntlet run finds no applicable gates for the changes
- **WHEN** the run completes with status `no_applicable_gates`
- **THEN** the `.execution_state` file SHALL NOT be written or updated

#### Scenario: State file NOT written for error
- **GIVEN** the gauntlet run encounters an unexpected error
- **WHEN** the run completes with status `error`
- **THEN** the `.execution_state` file SHALL NOT be written or updated

#### Scenario: State file cleared on clean
- **GIVEN** an `.execution_state` file exists in the log directory
- **WHEN** the clean command runs successfully
- **THEN** the `.execution_state` file SHALL be moved to `previous/` along with other logs

### Requirement: Automatic Log Cleaning on Context Change
The system MUST automatically clean logs when execution context has changed, before running gates. Context is considered changed if the current branch differs from the recorded branch, OR if the recorded commit is now reachable from the base branch (indicating the work was merged). Auto-clean applies to `run`, `check`, and `review` commands only; the `stop-hook` command delegates to the gauntlet subprocess which handles auto-clean internally. The base branch is determined by the existing `base_branch` setting in the project's `.gauntlet/config.yml` (defaulting to `origin/main` if not specified).

#### Scenario: Branch changed triggers auto-clean
- **GIVEN** the `.execution_state` file shows `branch: "feature-a"`
- **AND** the current git branch is `feature-b`
- **WHEN** the `run` command starts
- **THEN** the system SHALL automatically clean logs before proceeding
- **AND** the system SHALL log a message indicating auto-clean due to branch change

#### Scenario: Commit merged triggers auto-clean
- **GIVEN** the `.execution_state` file shows `commit: "abc123"`
- **AND** the current branch is still the same
- **AND** commit `abc123` is reachable from the base branch (via `git merge-base --is-ancestor`)
- **WHEN** the `run` command starts
- **THEN** the system SHALL automatically clean logs before proceeding
- **AND** the system SHALL log a message indicating auto-clean due to merged commit

#### Scenario: No auto-clean when context unchanged
- **GIVEN** the `.execution_state` file shows `branch: "feature-a"` and `commit: "abc123"`
- **AND** the current branch is `feature-a`
- **AND** commit `abc123` is NOT reachable from the base branch
- **WHEN** the `run` command starts
- **THEN** the system SHALL NOT auto-clean
- **AND** the system SHALL proceed with normal verification mode if logs exist

#### Scenario: No auto-clean when no state file
- **GIVEN** no `.execution_state` file exists in the log directory
- **WHEN** the `run` command starts
- **THEN** the system SHALL NOT auto-clean
- **AND** the system SHALL proceed normally

### Requirement: Global Configuration
The system MUST support a global configuration file at `~/.config/agent-gauntlet/config.yml` for user-level settings that apply across all projects. The `stop_hook` section supports both `enabled` and `run_interval_minutes` settings.

#### Scenario: Global config with stop hook enabled and interval
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains `stop_hook.enabled: true` and `stop_hook.run_interval_minutes: 15`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `enabled: true` and 15 minutes as the run interval

#### Scenario: Global config with stop hook disabled
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains `stop_hook.enabled: false`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL skip gauntlet execution entirely
- **AND** the system SHALL output `{ "decision": "approve", "status": "stop_hook_disabled", "message": "..." }`

#### Scenario: Global config missing enabled field (backwards compatibility)
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains only `stop_hook.run_interval_minutes: 15` (no `enabled` field)
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL default `enabled` to `true`
- **AND** the system SHALL use 15 minutes as the run interval

#### Scenario: Global config missing
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` does not exist
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use defaults: `enabled: true`, `run_interval_minutes: 10`

#### Scenario: Global config invalid
- **GIVEN** the global config file contains invalid YAML
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL log a warning to stderr
- **AND** the system SHALL use default values

### Requirement: Stop Hook Run Interval
The stop-hook command MUST skip gauntlet execution if the stop hook is disabled OR if the configured run interval has not elapsed since the last completed run. Configuration is resolved from three sources with precedence: environment variables > project config > global config.

#### Scenario: Environment variable overrides all other sources
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED=false` is set in the environment
- **AND** the project config has `stop_hook.enabled: true`
- **AND** the global config has `stop_hook.enabled: true`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `enabled: false` from the environment variable
- **AND** the system SHALL skip gauntlet execution

#### Scenario: Environment variable for interval
- **GIVEN** `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES=0` is set in the environment
- **AND** the project config has `stop_hook.run_interval_minutes: 10`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `run_interval_minutes: 0` from the environment variable
- **AND** the system SHALL always run the gauntlet (interval 0 means always run)

#### Scenario: Project config overrides global config
- **GIVEN** the project config (`.gauntlet/config.yml`) has `stop_hook.run_interval_minutes: 5`
- **AND** the global config has `stop_hook.run_interval_minutes: 10`
- **AND** no environment variables are set
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use 5 minutes from the project config

#### Scenario: Interval of zero means always run
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 0`
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet immediately without checking elapsed time
- **AND** the system SHALL NOT read or compare against `.execution_state` timestamps for interval purposes

#### Scenario: Stop hook disabled
- **GIVEN** the resolved config has `enabled: false`
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL allow stop by outputting `{ "decision": "approve", "status": "stop_hook_disabled", "message": "..." }`
- **AND** the system SHALL NOT invoke executeRun()
- **AND** the system SHALL log a message indicating the stop hook is disabled

#### Scenario: Interval not elapsed - skip run
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 5 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL allow stop by outputting `{ "decision": "approve", "status": "interval_not_elapsed", "message": "..." }`
- **AND** the system SHALL log a message to stderr indicating the interval has not elapsed

#### Scenario: Interval elapsed - run gauntlet
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 15 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

#### Scenario: No execution state - run gauntlet
- **GIVEN** the resolved config has `enabled: true`
- **AND** no `.execution_state` file exists
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

### Requirement: Enhanced Stop Reason Instructions

When the stop-hook blocks the agent due to gauntlet failures, the `stopReason` message MUST include detailed instructions for the agent on how to address the failures, including trust level guidance, violation handling procedures, termination conditions, and the path to the console log file containing full execution output. The trust level is fixed at "medium" for the stop-hook context (not configurable) to provide consistent agent behavior.

#### Scenario: Stop reason includes console log path
- **GIVEN** the gauntlet fails with gate failures
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include the absolute path to the latest `console.N.log` file in the log directory
- **AND** the instructions SHALL indicate the agent can read this file for full execution details

#### Scenario: Stop reason excludes manual re-run instruction
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL NOT include instructions to run `agent-gauntlet run` manually
- **AND** the rationale is that the stop hook will automatically re-trigger to verify fixes

#### Scenario: Stop reason includes urgent fix directive
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include emphatic language directing the agent to fix issues immediately
- **AND** the instructions SHALL make clear the agent cannot stop until issues are resolved or termination conditions are met

#### Scenario: Stop reason includes trust level
- **GIVEN** the gauntlet fails with review violations
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include text about trust level: "medium" as the default
- **AND** the instructions SHALL explain when to fix vs skip issues

#### Scenario: Stop reason includes violation handling
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL include instructions to update `"status"` and `"result"` fields in JSON files
- **AND** it SHALL explain `"fixed"` vs `"skipped"` status values

#### Scenario: Stop reason includes termination conditions
- **GIVEN** the gauntlet fails
- **WHEN** the stop-hook outputs a blocking response
- **THEN** the `stopReason` SHALL list the three termination conditions: "Status: Passed", "Status: Passed with warnings", and "Status: Retry limit exceeded"

### Requirement: Structured JSON Response for All Outcomes

The stop-hook command SHALL output a structured JSON response for ALL outcomes, not just blocks. Each response MUST include a `status` field indicating the specific reason for the decision, and a human-friendly `message` field.

#### Scenario: Response structure
- **GIVEN** any stop-hook execution completes
- **WHEN** the command outputs its decision
- **THEN** the response SHALL be valid JSON containing:
  - `decision`: "approve" or "block"
  - `status`: a machine-readable status code
  - `message`: a human-friendly explanation
- **AND** the `reason` field SHALL only be present when `decision` is "block"

### Requirement: Status Codes for Approval Scenarios

The system MUST use distinct status codes for different approval scenarios to enable debugging and transparency. Status determination follows a defined precedence order.

#### Scenario: Stop hook disabled via configuration
- **GIVEN** the resolved config has `enabled: false`
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be `"stop_hook_disabled"`
- **AND** `message` SHALL indicate the stop hook was disabled by configuration
- **AND** `decision` SHALL be `"approve"`

### Requirement: Block Status for Failed Gates

The stop-hook command SHALL only output `decision: "block"` when the gauntlet fails and retries are still available.

#### Scenario: Gates failed - block
- **GIVEN** the gauntlet fails (gates did not pass)
- **AND** no termination condition is met
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be "failed"
- **AND** `decision` SHALL be "block"
- **AND** `reason` SHALL contain the detailed instructions for the agent
- **AND** `message` SHALL provide a brief summary of the failure

### Requirement: Stop Hook Status Messages

The stop-hook command MUST always include a human-friendly status message in the `stopReason` field of the response, regardless of whether the decision is to block or approve. This ensures users have visibility into gauntlet behavior for non-blocking statuses.

**Note:** This requirement covers non-blocking statuses (approve decisions). For blocking statuses (block decisions with detailed fix instructions), see the existing "Enhanced Stop Reason Instructions" requirement which remains unchanged.

#### Scenario: Message included for blocking status
- **GIVEN** the gauntlet fails with status `failed`
- **WHEN** the stop-hook outputs the response
- **THEN** the response SHALL include `stopReason` with detailed fix instructions per "Enhanced Stop Reason Instructions"
- **AND** the `decision` SHALL be `block`

#### Scenario: Message included for non-blocking status
- **GIVEN** the stop-hook completes with a non-blocking status (e.g., `interval_not_elapsed`, `no_config`, `passed`)
- **WHEN** the stop-hook outputs the response
- **THEN** the response SHALL include `stopReason` with a brief human-friendly message
- **AND** the `decision` SHALL be `approve`
- **AND** the message SHALL explain the gauntlet result or why it was skipped

#### Scenario: Message format for interval_not_elapsed
- **GIVEN** the stop-hook skips the gauntlet due to interval not elapsed
- **WHEN** the response is output
- **THEN** the `stopReason` SHALL indicate that the run interval has not elapsed
- **AND** it SHALL include the configured interval duration

#### Scenario: Message format for no_config
- **GIVEN** the stop-hook detects no gauntlet configuration
- **WHEN** the response is output
- **THEN** the `stopReason` SHALL indicate this is not a gauntlet project

#### Scenario: Message format for lock_conflict
- **GIVEN** the stop-hook detects another gauntlet is running
- **WHEN** the response is output
- **THEN** the `stopReason` SHALL indicate another run is in progress

### Requirement: Stop Hook Configuration Resolution
The system MUST resolve stop hook configuration from three sources with clear precedence: environment variables (highest), project config, global config (lowest). Each field is resolved independently.

#### Scenario: Per-field independent resolution
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED=true` is set in the environment
- **AND** the project config has `stop_hook.run_interval_minutes: 5` (no `enabled` field)
- **AND** the global config has `stop_hook.enabled: false` and `stop_hook.run_interval_minutes: 10`
- **WHEN** the stop-hook command resolves configuration
- **THEN** `enabled` SHALL be `true` (from env var)
- **AND** `run_interval_minutes` SHALL be `5` (from project config, since no env var for interval)

#### Scenario: Environment variable parsing for enabled
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED` is set in the environment
- **WHEN** the stop-hook command parses the value
- **THEN** the system SHALL accept "true", "1" as truthy values
- **AND** the system SHALL accept "false", "0" as falsy values
- **AND** the system SHALL ignore invalid values and fall through to next source

#### Scenario: Environment variable parsing for interval
- **GIVEN** `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` is set in the environment
- **WHEN** the stop-hook command parses the value
- **THEN** the system SHALL parse the value as an integer
- **AND** the system SHALL accept non-negative integers (0 or greater)
- **AND** the system SHALL ignore invalid values (non-numeric, negative) and fall through to next source

### Requirement: Auto Push PR Configuration

The stop hook SHALL support an `auto_push_pr` boolean setting that controls whether the agent is instructed to create or update a PR after all local gates pass.

#### Scenario: Setting defaults to false
- **GIVEN** no `auto_push_pr` setting is configured at any level
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL default to `false`

#### Scenario: Environment variable override
- **GIVEN** `GAUNTLET_AUTO_PUSH_PR` environment variable is set to `"true"` or `"1"`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `true` regardless of project or global config

#### Scenario: Project config override
- **GIVEN** `.gauntlet/config.yml` contains `stop_hook.auto_push_pr: true`
- **AND** no `GAUNTLET_AUTO_PUSH_PR` environment variable is set
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `true`

#### Scenario: Three-tier precedence
- **GIVEN** `GAUNTLET_AUTO_PUSH_PR` is set to `"false"`
- **AND** project config has `stop_hook.auto_push_pr: true`
- **WHEN** the stop hook resolves configuration
- **THEN** `auto_push_pr` SHALL be `false` (env var wins)

### Requirement: PR Push Required Status

The system SHALL include a `pr_push_required` status in the `GauntletStatus` type that indicates local gates passed and a PR needs to be created or updated.

#### Scenario: Status blocks the stop
- **GIVEN** the stop hook determines status is `pr_push_required`
- **WHEN** `isBlockingStatus()` is called
- **THEN** it SHALL return `true`

#### Scenario: Status message
- **GIVEN** the status is `pr_push_required`
- **WHEN** the status message is generated
- **THEN** it SHALL indicate that gates passed and a PR needs to be created or updated

### Requirement: Post-Gauntlet PR Detection

When `auto_push_pr` is enabled and the gauntlet returns a success status, the stop hook SHALL check whether a PR exists and is up-to-date for the current branch before deciding to block. PR detection SHALL only be triggered by direct gauntlet success statuses (`passed`, `passed_with_warnings`), not by termination statuses or other approval statuses.

#### Scenario: No PR exists after gates pass
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** no open PR exists for the current branch
- **WHEN** the stop hook processes the result
- **THEN** it SHALL block with `pr_push_required` status
- **AND** the `reason` field SHALL contain instructions for creating or updating a PR

#### Scenario: PR exists but is not up-to-date
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** an open PR exists for the current branch
- **AND** the PR head SHA does not match the local HEAD SHA (unpushed commits exist)
- **WHEN** the stop hook processes the result
- **THEN** it SHALL block with `pr_push_required` status
- **AND** the `reason` field SHALL contain instructions for creating or updating a PR

#### Scenario: PR exists and is up-to-date
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns `passed` or `passed_with_warnings`
- **AND** an open PR exists for the current branch
- **AND** the PR head SHA matches the local HEAD SHA
- **WHEN** the stop hook processes the result
- **THEN** it SHALL approve the stop with the original gauntlet status

#### Scenario: auto_push_pr is disabled
- **GIVEN** `auto_push_pr` is `false`
- **AND** the gauntlet returns a success status
- **WHEN** the stop hook processes the result
- **THEN** it SHALL approve the stop with the original gauntlet status (unchanged behavior)

#### Scenario: Termination statuses do not trigger PR detection
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a termination status (e.g., `termination_passed`, `termination_warnings`, `termination_retry_limit`)
- **WHEN** the stop hook processes the result
- **THEN** it SHALL NOT check for PR existence
- **AND** it SHALL approve the stop with the original gauntlet status

#### Scenario: gh CLI not available
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a success status
- **AND** the `gh` CLI is not installed
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning
- **AND** it SHALL approve the stop with the original gauntlet status (graceful degradation)

#### Scenario: PR detection fails due to gh error
- **GIVEN** `auto_push_pr` is `true`
- **AND** the gauntlet returns a success status
- **AND** `gh pr view` fails for a reason other than missing CLI (e.g., network failure, auth failure, no remote tracking branch)
- **WHEN** the stop hook attempts to check for a PR
- **THEN** it SHALL log a warning with the error details
- **AND** it SHALL approve the stop with the original gauntlet status (graceful degradation)

### Requirement: Push PR Instructions

When blocking with `pr_push_required` status, the `reason` prompt SHALL instruct the agent to create or update a PR using project-level instructions when available, with minimal fallback instructions.

#### Scenario: Instructions prioritize project-level skills
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to first look for project-level commit/PR instructions (e.g., `/push-pr` skill, `.claude/commands/push-pr.md`, `.gauntlet/push_pr.md`, CONTRIBUTING.md)

#### Scenario: Instructions include minimal fallback
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL include minimal fallback instructions for git add, commit, push, and `gh pr create`
- **AND** `gh` availability is a prerequisite for the fallback instructions

#### Scenario: Skipped issues included in PR description guidance
- **GIVEN** the gauntlet status is `passed_with_warnings`
- **AND** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to include skipped issues in the PR description

#### Scenario: Instructions tell agent to stop after PR creation
- **GIVEN** the stop hook blocks with `pr_push_required`
- **WHEN** the `reason` prompt is generated
- **THEN** it SHALL instruct the agent to try stopping again after creating or updating the PR

### Requirement: Stop Hook Stdout Purity

When the stop-hook command invokes `executeRun()`, all gauntlet log output MUST go to stderr (not stdout) to ensure stdout contains ONLY the JSON hook response. Any log output to stdout corrupts the hook protocol and prevents Claude Code from parsing the block decision.

#### Scenario: Log output uses stderr not stdout
- **GIVEN** the stop-hook command calls `executeRun()`
- **WHEN** the gauntlet runs gates and produces log output
- **THEN** all log messages SHALL be written to stderr via `console.error()`
- **AND** no log messages SHALL be written to stdout via `console.log()`
- **AND** log output SHALL still be captured to console.N.log file (console-log.ts captures both stdout and stderr)

#### Scenario: JSON-only stdout for hook response
- **GIVEN** the gauntlet completes (pass or fail)
- **WHEN** the stop-hook outputs its response
- **THEN** stdout SHALL contain ONLY valid JSON
- **AND** the JSON SHALL be parseable by Claude Code without pre-processing
- **AND** the first character of stdout SHALL be `{` (the start of JSON)

#### Scenario: Block decision is honored by Claude Code
- **GIVEN** stdout contains valid JSON with `decision: "block"`
- **WHEN** Claude Code reads the hook response
- **THEN** Claude Code SHALL block the stop and feed `reason` back as the next prompt
- **AND** the user SHALL see the hook is running/blocking

### Requirement: Diff Stats Scoped to Working Tree Reference

The `computeDiffStats()` function MUST respect the `fixBase` option to compute diff statistics scoped to changes since a specific git reference (stash or commit), rather than all uncommitted changes.

#### Scenario: fixBase option used for diff stats
- **GIVEN** the `fixBase` option is provided to `computeDiffStats()`
- **WHEN** diff statistics are computed
- **THEN** the system SHALL compute `git diff --numstat <fixBase>` for line counts
- **AND** the system SHALL compute `git diff --name-status <fixBase>` for file categorization
- **AND** the baseRef in the result SHALL be set to the fixBase value

#### Scenario: Untracked files scoped to fixBase snapshot
- **GIVEN** the `fixBase` option is provided
- **AND** there are untracked files in the working tree
- **WHEN** diff statistics are computed
- **THEN** the system SHALL compare current untracked files against files in the fixBase snapshot
- **AND** only files that are NEW since the fixBase SHALL be counted as new files

#### Scenario: Subsequent iteration shows incremental changes
- **GIVEN** iteration N completed and saved a working_tree_ref
- **AND** agent made fixes (let's say 20 lines changed)
- **WHEN** iteration N+1 starts with fixBase set to that working_tree_ref
- **THEN** the `lines_added` in RUN_START SHALL reflect only the 20 new lines
- **AND** the diff SHALL NOT include the original changes that existed at the end of iteration N

### Requirement: Child Process Debug Logging Suppression

Stop hook invocations from child Claude processes (indicated by GAUNTLET_STOP_HOOK_ACTIVE environment variable) MUST NOT write STOP_HOOK entries to the debug log.

#### Scenario: Child process skips debug logging
- **GIVEN** the GAUNTLET_STOP_HOOK_ACTIVE environment variable is set
- **WHEN** the stop-hook command executes
- **THEN** no STOP_HOOK entry SHALL be written to the debug log
- **AND** the command SHALL return "stop_hook_active" status immediately
- **AND** the rationale is that child process stop-hooks are redundant noise in the debug log

### Requirement: Simplified Stop Hook Flow

The stop-hook command SHALL be a thin adapter that transforms between Claude Code hook protocol and the run-executor. It performs minimal pre-checks before delegating to the executor.

#### Scenario: Execution order
- **GIVEN** the stop-hook receives a stop event
- **WHEN** it processes the event
- **THEN** it SHALL execute checks in this order:
  1. Check `GAUNTLET_STOP_HOOK_ACTIVE_ENV` environment variable
  2. Parse stdin JSON
  3. Check `stop_hook_active` flag from input
  4. Check for `.gauntlet/config.yml` presence
  5. Call `executeRun({ cwd, checkInterval: true })`
- **AND** all other checks (lock, interval) SHALL be delegated to the executor

#### Scenario: No duplicate utility functions
- **GIVEN** the stop-hook implementation
- **WHEN** it needs the console log path for error messages
- **THEN** it SHALL use the value from `RunResult.consoleLogPath` returned by the executor
- **AND** it SHALL NOT define its own `findLatestConsoleLog()` implementation

#### Scenario: No global config loading
- **GIVEN** the stop-hook needs interval checking
- **WHEN** it calls the executor
- **THEN** it SHALL pass `checkInterval: true`
- **AND** it SHALL NOT load global config itself
- **AND** the executor SHALL be responsible for loading global config when needed

### Requirement: Multi-Protocol Support

The stop-hook command MUST support multiple IDE protocols through an adapter-based architecture, detecting the protocol from stdin input and delegating to the appropriate adapter.

#### Scenario: Cursor protocol detection
- **GIVEN** the stop-hook receives stdin JSON containing `cursor_version` field
- **WHEN** the command processes the input
- **THEN** it SHALL use the Cursor protocol adapter
- **AND** it SHALL parse Cursor-specific fields (`status`, `loop_count`, `workspace_roots`)

#### Scenario: Claude Code protocol detection
- **GIVEN** the stop-hook receives stdin JSON without `cursor_version` field
- **WHEN** the command processes the input
- **THEN** it SHALL use the Claude Code protocol adapter
- **AND** it SHALL parse Claude-specific fields (`stop_hook_active`, `cwd`, `session_id`)

#### Scenario: Empty or invalid input defaults to Claude
- **GIVEN** the stop-hook receives empty stdin or invalid JSON
- **WHEN** the command attempts to detect protocol
- **THEN** it SHALL default to Claude Code protocol adapter
- **AND** it SHALL handle the input per existing Claude behavior

### Requirement: Cursor Protocol Output Format

When using the Cursor protocol, the stop-hook MUST output responses in Cursor's expected format using `followup_message` for continuation.

#### Scenario: Blocking response for Cursor (failed status)
- **GIVEN** gates have failed and the protocol is Cursor
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL include a `followup_message` field with fix instructions
- **AND** the format SHALL be `{ "followup_message": "<instructions>" }`

#### Scenario: Blocking response for Cursor (pr_push_required status)
- **GIVEN** gates have passed but PR needs to be created/updated and the protocol is Cursor
- **AND** the status is `pr_push_required`
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL include a `followup_message` field with push-PR instructions
- **AND** the format SHALL be `{ "followup_message": "<push-pr-instructions>" }`

#### Scenario: Allowing response for Cursor
- **GIVEN** gates have passed (or other non-blocking status) and the protocol is Cursor
- **AND** the status is NOT `pr_push_required`
- **WHEN** the stop-hook outputs the decision
- **THEN** the JSON SHALL be an empty object `{}`
- **AND** no `followup_message` field SHALL be present

### Requirement: Cursor Loop Count Handling

The stop-hook MUST handle Cursor's `loop_count` field to prevent excessive retry loops.

#### Scenario: Loop count below threshold
- **GIVEN** the Cursor input has `loop_count` less than the configured threshold
- **WHEN** the stop-hook evaluates whether to skip execution
- **THEN** it SHALL proceed with gauntlet execution normally

#### Scenario: Loop count at or above threshold
- **GIVEN** the Cursor input has `loop_count` at or above the configured threshold (default 10)
- **WHEN** the stop-hook evaluates whether to skip execution
- **THEN** it SHALL return an empty response to allow stop
- **AND** it SHALL NOT invoke the gauntlet
- **AND** this SHALL behave similarly to `retry_limit_exceeded` status

### Requirement: Adapter Interface

The system MUST define a `StopHookAdapter` interface that protocol-specific implementations conform to.

#### Scenario: Adapter detection method
- **GIVEN** a `StopHookAdapter` implementation
- **WHEN** `detect(raw)` is called with parsed stdin JSON
- **THEN** it SHALL return `true` if the input matches this adapter's protocol
- **AND** it SHALL return `false` otherwise

#### Scenario: Adapter input parsing
- **GIVEN** a `StopHookAdapter` implementation
- **WHEN** `parseInput(raw)` is called with parsed stdin JSON
- **THEN** it SHALL return a `StopHookContext` with protocol-agnostic fields
- **AND** the context SHALL include `cwd`, `isNestedHook`, and optional `loopCount`

#### Scenario: Adapter output formatting
- **GIVEN** a `StopHookAdapter` implementation and a `StopHookResult`
- **WHEN** `formatOutput(result)` is called
- **THEN** it SHALL return a JSON string in the protocol's expected format
- **AND** for blocking status `failed`, it SHALL use `result.instructions`
- **AND** for blocking status `pr_push_required`, it SHALL use `result.pushPRReason`

#### Scenario: Adapter early exit check
- **GIVEN** a `StopHookAdapter` implementation and a `StopHookContext`
- **WHEN** `shouldSkipExecution(ctx)` is called
- **THEN** it SHALL return a `StopHookResult` if execution should be skipped
- **AND** it SHALL return `null` if execution should proceed

### Requirement: PR Push Required Status Handling

Both Claude Code and Cursor adapters MUST handle the `pr_push_required` status returned by the handler when `auto_push_pr` is enabled and gates pass but no PR exists or PR is not up-to-date.

#### Scenario: Claude Code adapter handles pr_push_required
- **GIVEN** the handler returns status `pr_push_required` with `pushPRReason`
- **AND** the protocol is Claude Code
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL have `decision: "block"`
- **AND** `reason` SHALL contain the `pushPRReason` instructions
- **AND** `stopReason` SHALL contain the `pushPRReason` instructions

#### Scenario: Cursor adapter handles pr_push_required
- **GIVEN** the handler returns status `pr_push_required` with `pushPRReason`
- **AND** the protocol is Cursor
- **WHEN** `formatOutput(result)` is called
- **THEN** the response SHALL be `{ "followup_message": "<pushPRReason>" }`


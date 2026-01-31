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

The command MUST prevent infinite loops when the stop hook repeatedly blocks.

#### Scenario: stop_hook_active is true
- **GIVEN** the hook input has `stop_hook_active: true`
- **WHEN** the command runs
- **THEN** it SHALL immediately exit 0 (allowing stop) without running the gauntlet

#### Scenario: stop_hook_active is false
- **GIVEN** the hook input has `stop_hook_active: false`
- **WHEN** the command runs
- **THEN** it SHALL proceed to check for gauntlet config and run gates

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

The command SHALL invoke the gauntlet run logic directly as a function call instead of spawning a subprocess.

#### Scenario: Direct function invocation
- **GIVEN** the stop-hook determines gauntlet should run
- **WHEN** it executes the gauntlet
- **THEN** it SHALL call `executeRun()` directly as a function
- **AND** it SHALL NOT spawn a subprocess
- **AND** it SHALL receive a structured `RunResult` object

#### Scenario: Silent mode execution
- **GIVEN** the stop-hook invokes executeRun
- **WHEN** the gauntlet runs
- **THEN** it SHALL pass `silent: true` to suppress console output
- **AND** the gauntlet SHALL still write to log files normally

#### Scenario: Gauntlet execution error
- **GIVEN** the gauntlet function returns an error status
- **WHEN** the error occurs
- **THEN** it SHALL allow stop (exit 0) to avoid blocking indefinitely on infrastructure issues
- **AND** the rationale is that blocking on transient failures would frustrate developers without providing value

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
- **AND** only `"failed"` status SHALL result in a block decision

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

### Requirement: Stop Hook Lock Pre-Check
The stop-hook command MUST check if the gauntlet lock file exists before invoking the run executor. If the lock file exists, the stop-hook SHALL allow the agent to stop immediately without running the gauntlet, since another gauntlet is already in progress.

#### Scenario: Lock file exists - allow stop
- **GIVEN** the lock file `.gauntlet-run.lock` exists in the log directory
- **WHEN** the stop-hook command starts
- **THEN** the system SHALL NOT invoke executeRun()
- **AND** the system SHALL allow stop (no blocking response)
- **AND** the system SHALL log a message indicating gauntlet already running

#### Scenario: Lock file does not exist - run gauntlet
- **GIVEN** the lock file `.gauntlet-run.lock` does not exist
- **WHEN** the stop-hook command starts
- **THEN** the system SHALL proceed to invoke executeRun()

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
- **AND** it MAY include the configured interval duration

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


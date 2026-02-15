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
- **THEN** the system SHALL default `enabled` to `false`
- **AND** the system SHALL use 15 minutes as the run interval

#### Scenario: Global config missing
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` does not exist
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use defaults: `enabled: false`, `run_interval_minutes: 5`

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

### Requirement: Stop Hook Status Messages

The stop-hook command MUST always include a human-friendly status message in the `stopReason` field of the response, regardless of whether the decision is to block or approve. This ensures users have visibility into gauntlet behavior for non-blocking statuses.

**Note:** This requirement covers non-blocking statuses (approve decisions). For blocking statuses (block decisions with detailed fix instructions), see the existing "Enhanced Stop Reason Instructions" requirement which remains unchanged.

#### Scenario: Message included for blocking status
- **GIVEN** the gauntlet fails with status `validation_required`
- **WHEN** the stop-hook outputs the response
- **THEN** the response SHALL include `stopReason` with a skill invocation instruction per "Enhanced Stop Reason Instructions"
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

### Requirement: Child Process Debug Logging Suppression

Stop hook invocations from child Claude processes (indicated by GAUNTLET_STOP_HOOK_ACTIVE environment variable) MUST NOT write STOP_HOOK entries to the debug log.

#### Scenario: Child process skips debug logging
- **GIVEN** the GAUNTLET_STOP_HOOK_ACTIVE environment variable is set
- **WHEN** the stop-hook command executes
- **THEN** no STOP_HOOK entry SHALL be written to the debug log
- **AND** the command SHALL return "stop_hook_active" status immediately
- **AND** the rationale is that child process stop-hooks are redundant noise in the debug log

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
- **AND** for blocking statuses, it SHALL use `result.reason`

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

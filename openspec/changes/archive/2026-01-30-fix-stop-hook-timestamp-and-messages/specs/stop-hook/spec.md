# stop-hook Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

## ADDED Requirements

### Requirement: Configurable Log Rotation Depth

The system MUST support configurable N-deep log rotation via the `max_previous_logs` field in `.gauntlet/config.yml` (default: 3). Archived sessions are stored in logrotate-style directories: `previous/` (most recent), `previous.1/`, `previous.2/`, etc. The oldest directory beyond the configured count is evicted on each clean operation.

#### Scenario: Default rotation depth

- **GIVEN** `max_previous_logs` is not specified in the config
- **WHEN** the system reads the configuration
- **THEN** the default value SHALL be 3

#### Scenario: Rotation with default depth (3)

- **GIVEN** `max_previous_logs` is 3
- **AND** `previous/`, `previous.1/`, and `previous.2/` all exist
- **WHEN** the log clean process runs
- **THEN** `previous.2/` SHALL be deleted (evicted as the oldest)
- **AND** `previous.1/` SHALL be renamed to `previous.2/`
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** current logs SHALL be moved into the new `previous/`

#### Scenario: Rotation with depth 1 (pre-existing behavior)

- **GIVEN** `max_previous_logs` is 1
- **AND** `previous/` exists with files
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
- **WHEN** the log clean process runs
- **THEN** the rename of `previous.1/` to `previous.2/` SHALL be skipped (no error)
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** current logs SHALL be moved into the new `previous/`

## MODIFIED Requirements

### Requirement: Log Clean Process

The system MUST support a log clean operation that archives current logs using configurable N-deep rotation into `previous/` subdirectories. The clean operation SHALL preserve persistent state files (`.execution_state`, `.debug.log`, `.debug.log.1`) and SHALL be a no-op if the log directory does not exist or contains no current logs to archive. The rotation depth is controlled by the `max_previous_logs` configuration field (default: 3).

#### Scenario: Clean with existing previous logs

- **GIVEN** `previous/` and `previous.1/` subdirectories exist and contain files
- **AND** the log directory root contains `.log` or `.json` files
- **AND** `max_previous_logs` is 3
- **WHEN** the log clean process runs
- **THEN** `previous.2/` SHALL be deleted if it exists (evict oldest)
- **AND** `previous.1/` SHALL be renamed to `previous.2/`
- **AND** `previous/` SHALL be renamed to `previous.1/`
- **AND** a new `previous/` SHALL be created
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into the new `previous/`
- **AND** `.execution_state` SHALL remain in place (NOT moved)
- **AND** `.debug.log` and `.debug.log.1` SHALL remain in place

#### Scenario: Clean with no previous directory

- **GIVEN** no `previous/` subdirectory exists
- **AND** the log directory root contains `.log` or `.json` files
- **WHEN** the log clean process runs
- **THEN** the `previous/` directory SHALL be created
- **AND** all `.log` and `.json` files in the log directory root SHALL be moved into `previous/`
- **AND** `.execution_state` SHALL remain in place (NOT moved)

#### Scenario: Clean with empty log directory

- **GIVEN** no `.log` or `.json` files exist in the log directory root
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

### Requirement: Auto-Clean on Success

When all gates pass (exit code 0), the system MUST automatically perform the log clean process before exiting. The clean operation SHALL use the project-configured `max_previous_logs` for rotation depth.

#### Scenario: All gates pass

- **GIVEN** a run has completed with all gates passing
- **WHEN** the runner reports success
- **THEN** the log clean process SHALL execute automatically with the configured rotation depth
- **AND** the process SHALL exit with code 0

#### Scenario: Some gates fail

- **GIVEN** a run has completed with one or more gate failures
- **WHEN** the runner reports failure
- **THEN** the log clean process SHALL NOT execute
- **AND** log files SHALL remain in the log directory root for the next rerun

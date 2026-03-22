## MODIFIED Requirements

### Requirement: Persistent Debug Log

The system MUST support an optional persistent debug log that captures operational events across all runs. The debug log SHALL be a single file that is never moved or deleted during clean operations. The debug log uses size-based rotation to prevent unbounded growth.

#### Scenario: Debug log file location
- **GIVEN** debug logging is enabled
- **WHEN** the system writes debug log entries
- **THEN** entries SHALL be written to `<log_dir>/.debug.log`
- **AND** the file SHALL use a dot-prefix to distinguish it from per-run logs

#### Scenario: Debug log format
- **WHEN** the system writes a debug log entry
- **THEN** the entry SHALL be plain text on a single line
- **AND** the entry SHALL begin with an ISO 8601 timestamp in brackets
- **AND** the entry SHALL include an event type (e.g., `COMMAND`, `RUN_START`, `GATE_RESULT`, `RUN_END`, `CLEAN`)
- **AND** the entry SHALL include event-specific fields

#### Scenario: Command logging
- **WHEN** any CLI command starts (run, check, review, clean, etc.)
- **THEN** the system SHALL write a `COMMAND` entry
- **AND** the entry SHALL include the command name and arguments

#### Scenario: Run start logging
- **WHEN** a run/check/review command begins executing gates
- **THEN** the system SHALL write a `RUN_START` entry
- **AND** the entry SHALL include: mode (full/verification), change count, gate count

#### Scenario: Gate result logging
- **WHEN** a gate completes execution
- **THEN** the system SHALL write a `GATE_RESULT` entry
- **AND** the entry SHALL include: gate id, status, duration
- **AND** for review gates, the entry SHALL include violation count

#### Scenario: Run end logging
- **WHEN** a run/check/review command completes
- **THEN** the system SHALL write a `RUN_END` entry
- **AND** the entry SHALL include: status, fixed count, skipped count, failed count, iteration count

#### Scenario: Clean logging
- **WHEN** a clean operation executes (auto or manual)
- **THEN** the system SHALL write a `CLEAN` entry
- **AND** the entry SHALL include: type (auto/manual), reason

#### Scenario: Debug log disabled by default
- **GIVEN** no debug log configuration is specified
- **WHEN** the system starts
- **THEN** no debug log entries SHALL be written

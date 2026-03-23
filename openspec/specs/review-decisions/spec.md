# review-decisions Specification

## Purpose
Defines the expected behavior for `agent-validate update-review` commands (`list`, `fix`, `skip`), including deterministic violation IDs and status transition rules.

## Requirements

### Requirement: Update-review list enumerates pending violations
`agent-validate update-review list` SHALL scan all review JSON files in the log directory, collect violations with status `"new"`, and print each with its numeric ID, priority, gate label, file:line, issue, and fix suggestion. The enumeration logic MUST be shared with the `--report` flag so IDs are consistent.

#### Scenario: Violations exist
- **WHEN** `agent-validate update-review list` is run and JSON files contain violations with status `"new"`
- **THEN** each violation SHALL be printed with its numeric ID, priority, gate label, location, issue, and fix

#### Scenario: No violations
- **WHEN** `agent-validate update-review list` is run and no violations with status `"new"` exist
- **THEN** the command SHALL print a message indicating no pending violations and exit 0

#### Scenario: No log directory
- **WHEN** `agent-validate update-review list` is run and the log directory does not exist
- **THEN** the command SHALL print an error message and exit 1

### Requirement: Update-review fix marks a violation as fixed
`agent-validate update-review fix <id> <reason>` SHALL locate the violation matching the numeric ID, set its `status` to `"fixed"` and its `result` to the provided reason string, and write the updated JSON back to disk.

#### Scenario: Valid fix
- **WHEN** `agent-validate update-review fix 1 "Added error handling"` is run and violation `#1` exists with status `"new"`
- **THEN** the violation's `status` SHALL be set to `"fixed"`
- **AND** the violation's `result` SHALL be set to `"Added error handling"`
- **AND** the updated JSON SHALL be written to the same file path
- **AND** a confirmation message SHALL be printed
- **AND** the command SHALL exit 0

#### Scenario: Invalid ID
- **WHEN** `agent-validate update-review fix 99 "reason"` is run and no violation `#99` exists
- **THEN** the command SHALL print an error indicating the ID is invalid
- **AND** the command SHALL exit 1

#### Scenario: Missing reason
- **WHEN** `agent-validate update-review fix 1` is run without a reason argument
- **THEN** the command SHALL print a usage error and exit 1

### Requirement: Update-review skip marks a violation as skipped
`agent-validate update-review skip <id> <reason>` SHALL behave identically to `update-review fix` except that it sets `status` to `"skipped"` instead of `"fixed"`.

#### Scenario: Valid skip
- **WHEN** `agent-validate update-review skip 2 "Stylistic preference"` is run and violation `#2` exists with status `"new"`
- **THEN** the violation's `status` SHALL be set to `"skipped"`
- **AND** the violation's `result` SHALL be set to `"Stylistic preference"`
- **AND** the updated JSON SHALL be written to the same file path
- **AND** a confirmation message SHALL be printed

### Requirement: Only new violations can be updated
The `fix` and `skip` subcommands SHALL only operate on violations with status `"new"`. Attempting to update a violation that has already been marked `"fixed"` or `"skipped"` SHALL produce an error.

#### Scenario: Already fixed violation
- **WHEN** `agent-validate update-review skip 1 "reason"` is run and violation `#1` has status `"fixed"`
- **THEN** the command SHALL print an error indicating the violation is already resolved
- **AND** the command SHALL exit 1

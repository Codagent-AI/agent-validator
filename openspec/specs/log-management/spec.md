# log-management Specification

## Purpose
TBD - created by archiving change remove-rerun-unify-logs. Update Purpose after archive.
## Requirements
### Requirement: Run-Numbered Log Filenames
The Logger MUST write log files with a dot-separated run-number suffix. The run number for a given execution SHALL be one greater than the highest run-number suffix found across ALL log files in the log directory (regardless of job ID, adapter, or gate type). This ensures all gates in a single invocation share the same run number. For review gates with multiple reviews, the review index is the 1-based position in the round-robin dispatch order and SHALL be included in the filename using `@` as the delimiter between adapter name and index, to avoid ambiguity with adapter names that contain hyphens (e.g., `github-copilot`).

#### Scenario: First run with no existing logs
- **GIVEN** the log directory exists and contains no `.log` files
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.1.log`

#### Scenario: Subsequent run with existing logs
- **GIVEN** the log directory contains `check_src_test.1.log`
- **WHEN** the Logger writes a log for job "check_src_test"
- **THEN** the log file SHALL be named `check_src_test.2.log`

#### Scenario: Single review (review index)
- **GIVEN** a review gate with `num_reviews: 1` using adapter "claude"
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_claude@1.1.log`
- **AND** the JSON file SHALL be named `review_src_claude@1.1.json`

#### Scenario: Multiple reviews from different adapters
- **GIVEN** a review gate with `num_reviews: 2` using adapters "claude" and "gemini"
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log` and `review_src_gemini@2.1.log`
- **AND** the JSON files SHALL follow the same pattern

#### Scenario: Multiple reviews from same adapter (round-robin)
- **GIVEN** a review gate with `num_reviews: 3` and only "claude" is healthy
- **WHEN** the Logger writes logs for job "review_src"
- **THEN** the log files SHALL be named `review_src_claude@1.1.log`, `review_src_claude@2.1.log`, and `review_src_claude@3.1.log`

#### Scenario: Adapter name with hyphens
- **GIVEN** a review gate using adapter "github-copilot" with review index 1
- **WHEN** the Logger writes a log for job "review_src"
- **THEN** the log file SHALL be named `review_src_github-copilot@1.1.log`
- **AND** the review index is unambiguously the digits after `@`

#### Scenario: Run number shared across all gates
- **GIVEN** the log directory contains `check_src_test.1.log`, `review_src_claude@1.1.log`, and `review_src_gemini@2.1.log`
- **WHEN** the Logger writes logs for a new execution
- **THEN** the run number SHALL be 2 for ALL gates (checks and reviews alike)

#### Scenario: Run number stable across adapter changes
- **GIVEN** the log directory contains `review_src_codex@1.1.log` from a previous run where codex was healthy
- **AND** codex is now unavailable and claude is assigned to slot 1
- **WHEN** the Logger writes logs for the new run
- **THEN** the run number SHALL be 2 (based on the global max of 1)
- **AND** the filename SHALL be `review_src_claude@1.2.log`

#### Scenario: Filename pattern structure
- **GIVEN** a job with sanitized ID "my_job", adapter "gemini", and review index 2
- **WHEN** the Logger constructs the log path
- **THEN** the filename SHALL follow the pattern `<sanitized-job-id>_<adapter>@<review-index>.<run-number>.log` for review gates
- **AND** `<sanitized-job-id>.<run-number>.log` for check gates (unchanged)
- **AND** the run number is always the last dot-separated segment before the extension
- **AND** the run number is derived from the highest run-number suffix across all log files in the directory
- **AND** the review index is parsed as the digits immediately following `@` in the filename

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

### Requirement: Clean CLI Command
The system MUST provide an `agent-gauntlet clean` CLI command that performs the log clean process on demand.

#### Scenario: User runs clean command
- **GIVEN** a `.gauntlet/config.yml` exists with a configured `log_dir`
- **WHEN** the user executes `agent-gauntlet clean`
- **THEN** the log clean process SHALL execute using the configured `log_dir`

#### Scenario: Clean command with no config
- **GIVEN** no `.gauntlet/config.yml` exists in the working directory
- **WHEN** the user runs `agent-gauntlet clean`
- **THEN** the command SHALL use the default log directory (`gauntlet_logs`)

### Requirement: Run Lock File
The `run`, `check`, and `review` commands MUST use a dot file in the log directory to prevent concurrent execution. The lock file SHALL be created at the start of a run and removed when the run completes (regardless of success or failure).

#### Scenario: No lock file exists
- **GIVEN** the lock file does not exist in the log directory
- **WHEN** a command (`run`, `check`, or `review`) starts
- **THEN** the command SHALL create the lock file
- **AND** proceed with execution normally

#### Scenario: Lock file already exists
- **GIVEN** the lock file exists in the log directory
- **WHEN** a command (`run`, `check`, or `review`) starts
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** print an error message that includes the absolute path of the lock file
- **AND** the error message SHALL indicate that the file can be manually removed if no run is in progress

#### Scenario: Lock file removed on success
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run completes successfully (all gates pass)
- **THEN** the lock file SHALL be removed before the log clean process executes

#### Scenario: Lock file removed on failure
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run completes with failures
- **THEN** the lock file SHALL be removed

#### Scenario: Lock file removed on unexpected error
- **GIVEN** a run is in progress and the lock file exists
- **WHEN** the run exits due to an unexpected error (exception)
- **THEN** the lock file SHALL be removed

### Requirement: JSON Review Result Files
The review gate MUST write a structured JSON file for each adapter's review result alongside the markdown log file.

#### Scenario: JSON file generation
- **WHEN** a review adapter completes execution
- **THEN** the system SHALL write a `.json` file with the same base name as the log file (e.g., `review_src_claude.1.json` alongside `review_src_claude.1.log`)
- **AND** the JSON file SHALL contain the adapter name, timestamp, status, raw LLM output, and violations array

#### Scenario: JSON schema for violations
- **WHEN** a violation is recorded in the JSON file
- **THEN** the violation object SHALL include a `status` field with initial value `"new"`
- **AND** the violation object SHALL include `file`, `line`, `issue`, `priority`, and optional `fix` fields
- **AND** the violation object MAY include a `result` field (initially null) for fix descriptions

#### Scenario: Invalid JSON output
- **WHEN** the reviewer LLM produces output that cannot be parsed as valid JSON
- **THEN** the system SHALL log an error indicating JSON parsing failed
- **AND** the system SHALL NOT write an incomplete JSON file
- **AND** the gate SHALL report an error status

#### Scenario: Missing required fields
- **WHEN** the reviewer LLM produces valid JSON but violations are missing required fields (`file`, `issue`, or `priority`)
- **THEN** the system SHALL log a warning indicating which fields are missing
- **AND** the malformed violation SHALL be excluded from the results

### Requirement: JSON-Based Previous Failure Parsing
When loading previous failures for rerun mode, the system SHALL parse JSON files as the primary source.

#### Scenario: JSON file exists
- **WHEN** loading previous failures and a `.json` file exists for a review gate
- **THEN** the system SHALL parse the JSON file for violation data
- **AND** the system SHALL NOT fall back to markdown log parsing for that gate

#### Scenario: Legacy log fallback
- **WHEN** loading previous failures and no `.json` file exists but a `.log` file does
- **THEN** the system SHALL fall back to parsing the markdown log file
- **AND** the system MAY log a deprecation warning

#### Scenario: Status filtering for rerun
- **WHEN** loading violations from a JSON file for rerun verification
- **THEN** violations with `status: "fixed"` SHALL be included for verification
- **AND** violations with `status: "skipped"` SHALL be excluded from the verification list
- **AND** violations with any other status (including `"new"`) SHALL be excluded from the verification list

#### Scenario: Unaddressed violations remain as failures
- **WHEN** a violation has `status: "new"` (agent did not update it)
- **THEN** the violation SHALL be retained as an active failure in the run results
- **AND** the run SHALL NOT pass if unaddressed violations exist
- **AND** the system SHALL log a warning indicating unaddressed violations were found

#### Scenario: Unexpected status warning
- **WHEN** a violation has a status value other than `"new"`, `"fixed"`, or `"skipped"`
- **THEN** the system SHALL log a warning to the console indicating the unexpected status value
- **AND** the violation SHALL be treated as `"new"` (retained as active failure)

### Requirement: Results Summary with Status
Upon run completion, the system SHALL display a summary showing fix and skip counts.

#### Scenario: Passed with skipped items
- **WHEN** a run completes with no failures but one or more review violations were marked as skipped
- **THEN** the overall status SHALL display as "Passed with warnings"
- **AND** the summary SHALL list the skipped items

#### Scenario: Multi-iteration summary
- **WHEN** a run completes after multiple iterations
- **THEN** the summary SHALL include all items fixed across all iterations
- **AND** the summary SHALL include all items skipped across all iterations
- **AND** each iteration's contributions SHALL be identifiable in the summary

#### Scenario: Iteration tracking
- **WHEN** items are fixed or skipped in different iterations
- **THEN** the summary SHALL show which iteration each fix or skip occurred in
- **AND** the summary SHALL include totals for fixed, skipped, and currently active failures (e.g., "Total: 5 fixed, 2 skipped, 1 failed after 2 iterations")

#### Scenario: Failure count calculation
- **WHEN** calculating the "failed" count for the summary
- **THEN** the system SHALL count each failed or errored check gate as 1 failure
- **AND** the system SHALL count each unique violation with status "new" (or missing status) in review results as 1 failure
- **AND** the total SHALL represent active failures in the most recent iteration only

### Requirement: Console Output Paths
The console output from gate failures SHALL include the appropriate file path for the agent to read.

#### Scenario: Check gate failure
- **WHEN** a check gate fails
- **THEN** the console output SHALL include the markdown log file path

#### Scenario: Review gate failure
- **WHEN** a review gate fails
- **THEN** the console output SHALL include the JSON file path (not the markdown log path)
- **AND** the output SHALL follow the format: `Review: <path-to-json-file>`

### Requirement: Round-Robin Review Dispatch
The review gate MUST assign reviews to adapters using round-robin over the list of healthy adapters from the configured preference order. The review index is the 1-based position in the dispatch order (1 through `num_reviews`). The system SHALL NOT error when `num_reviews` exceeds the number of available adapters. Adapter health is determined by binary availability and cooldown status (as defined in the Adapter Cooldown and Recovery requirement in the run-lifecycle spec).

#### Scenario: All adapters healthy
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** all three adapters are healthy (binary available, not cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, codex), (3, gemini)]` with review indices 1-3

#### Scenario: Some adapters unavailable
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** codex is unavailable (binary missing or cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, gemini), (3, claude)]` (round-robin over healthy adapters)

#### Scenario: Single adapter available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 3`
- **AND** only claude is healthy
- **WHEN** the review gate dispatches reviews
- **THEN** assignments SHALL be `[(1, claude), (2, claude), (3, claude)]`

#### Scenario: No adapters available
- **GIVEN** `cli_preference: [claude, codex, gemini]` and `num_reviews: 2`
- **AND** no adapters are healthy (all missing or cooling down)
- **WHEN** the review gate dispatches reviews
- **THEN** the gate SHALL return an error status
- **AND** the error message SHALL include the text "no healthy adapters"

### Requirement: Previous-Failure Lookup by Review Index
When loading previous failures for rerun mode, the system SHALL resolve previous review logs by matching the review index (the digits after `@` in the filename) and job ID, ignoring differences in the adapter name. This ensures history continuity when the adapter assigned to a review slot changes between runs.

#### Scenario: Same adapter across runs
- **GIVEN** run 1 produced `review_src_claude@1.1.json` with violations
- **AND** run 2 assigns claude to slot 1 again
- **WHEN** the system loads previous failures for slot 1
- **THEN** it SHALL parse `review_src_claude@1.1.json`

#### Scenario: Adapter changes between runs
- **GIVEN** run 1 produced `review_src_codex@1.1.json` with violations
- **AND** run 2 assigns claude to slot 1 (codex is now unavailable)
- **WHEN** the system loads previous failures for slot 1
- **THEN** it SHALL parse `review_src_codex@1.1.json` (matching by index 1, not adapter name)

#### Scenario: Multiple runs with adapter changes
- **GIVEN** run 1 produced `review_src_codex@1.1.json`
- **AND** run 2 produced `review_src_claude@1.2.json`
- **WHEN** the system loads previous failures for slot 1 on run 3
- **THEN** it SHALL parse only the highest-numbered file for index 1: `review_src_claude@1.2.json`

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

#### Scenario: Debug log enabled via project config
- **GIVEN** `.gauntlet/config.yml` contains `debug_log.enabled: true`
- **WHEN** the system starts
- **THEN** debug log entries SHALL be written

#### Scenario: Debug log enabled via global config
- **GIVEN** `~/.config/agent-gauntlet/config.yml` contains `debug_log.enabled: true`
- **AND** no project-level debug_log config exists
- **WHEN** the system starts
- **THEN** debug log entries SHALL be written

#### Scenario: Project config overrides global config
- **GIVEN** global config has `debug_log.enabled: true`
- **AND** project config has `debug_log.enabled: false`
- **WHEN** the system starts
- **THEN** debug log entries SHALL NOT be written

### Requirement: Debug Log Size-Based Rotation

The debug log MUST rotate based on file size to prevent unbounded growth. Rotation creates a single backup file.

#### Scenario: Rotation trigger
- **GIVEN** debug logging is enabled
- **AND** `debug_log.max_size_mb` is set to 10 (or default)
- **WHEN** the debug log file size exceeds 10 MB before a write
- **THEN** the system SHALL rotate the log file

#### Scenario: Rotation process
- **WHEN** the debug log rotates
- **THEN** the system SHALL delete `.debug.log.1` if it exists
- **AND** the system SHALL rename `.debug.log` to `.debug.log.1`
- **AND** the system SHALL create a new empty `.debug.log`
- **AND** the pending entry SHALL be written to the new file

#### Scenario: Default max size
- **GIVEN** `debug_log.max_size_mb` is not specified
- **WHEN** the system evaluates the rotation threshold
- **THEN** the default threshold SHALL be 10 MB

#### Scenario: Single backup retention
- **GIVEN** the debug log has rotated multiple times
- **WHEN** a new rotation occurs
- **THEN** only one backup file (`.debug.log.1`) SHALL exist
- **AND** the total debug log storage SHALL be at most 2x `max_size_mb`


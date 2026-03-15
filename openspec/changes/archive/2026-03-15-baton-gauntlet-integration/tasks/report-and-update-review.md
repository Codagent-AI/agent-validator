## Goal

Add the `--report` flag to `agent-gauntlet run` and the `agent-gauntlet update-review` command so that baton can orchestrate gauntlet verification via shell step capture and headless agent fix loops.

## Background

All gauntlet console output currently goes to stderr (to keep stdout clean for the stop-hook JSON protocol). Baton shell steps only capture stdout, so the output is empty. The `--report` flag writes a plain-text failure report to stdout.

The report is generated inside `executeRun` (in `buildRunResult`) before log cleanup, since cleanup archives logs on pass/retry_limit_exceeded. The report string is returned in `RunResult.reportText` so `run.ts` can write it to stdout.

Check failures include metadata only (gate label, command, working directory, fix instructions, log path) — not parsed error output. The agent reads the full log file directly. To make command and working directory available without re-reading logs, add these fields to `GateResult` and populate them during check execution.

Review violations are enumerated by a shared function that scans JSON files in sorted filename order and assigns sequential IDs to violations with `status: "new"`. This function is used by both the report generator and the `update-review` command.

Key files to read:
- `src/commands/run.ts` — run command registration, where `--report` option is added
- `src/core/run-executor.ts` — `ExecuteRunOptions` and `executeRun` flow
- `src/core/run-executor-helpers.ts` — `buildRunResult` where report generation happens before cleanup
- `src/types/gauntlet-status.ts` — `RunResult` type gets `reportText` field
- `src/gates/result.ts` — `GateResult` type gets `command` and `workingDirectory` fields
- `src/gates/check.ts` — populates command/workingDirectory during execution
- `src/output/console.ts` — existing reporter (unchanged, but reference for output conventions)
- `src/commands/index.ts` — command registration barrel file

## Spec

### Requirement: Report flag writes self-contained failure report to stdout
When `agent-gauntlet run` is invoked with `--report`, the command SHALL write a structured, agent-actionable failure report to stdout. Stderr output SHALL remain unchanged. When no failures exist, stdout SHALL contain only the status line. The report MUST be self-contained — an agent reading only the report MUST have enough information to understand what failed and begin fixing it. The report MUST also be written to a file as a fallback for environments where stdout may be lost.

#### Scenario: All gates pass
- **WHEN** `agent-gauntlet run --report` completes and all gates pass
- **THEN** stdout SHALL contain a single line: `Status: Passed`

#### Scenario: All gates pass with skipped violations
- **WHEN** `agent-gauntlet run --report` completes and all gates pass but some violations were skipped
- **THEN** stdout SHALL contain `Status: Passed with warnings`

#### Scenario: Check gate fails
- **WHEN** a check gate fails during a `--report` run
- **THEN** stdout SHALL include a CHECK FAILURES section containing:
  - The gate label (e.g., `check:src:lint`)
  - The command that was executed
  - The working directory the command ran in
  - Fix instructions if configured for the gate
  - Fix skill name if configured for the gate
  - The path to the full log file
- **AND** the report SHALL NOT include parsed error output from the check log — the agent reads the log file directly when it needs error details

#### Scenario: Review gate has new violations
- **WHEN** a review gate fails with violations whose status is `"new"`
- **THEN** stdout SHALL include a REVIEW VIOLATIONS section containing each violation with:
  - A stable numeric ID (e.g., `#1`, `#2`)
  - Priority level in brackets (e.g., `[high]`)
  - The gate label and adapter suffix (e.g., `review:src:code-quality (claude@1)`)
  - `file:line - issue description`
  - Fix suggestion
  - Path to the JSON file containing the violation

#### Scenario: Review violations with non-new status are excluded
- **WHEN** a review gate has violations with status `"fixed"` or `"skipped"`
- **THEN** those violations SHALL NOT appear in the report and SHALL NOT be assigned numeric IDs

#### Scenario: Report flag absent
- **WHEN** `agent-gauntlet run` is invoked without `--report`
- **THEN** stdout behavior SHALL be unchanged from current behavior

### Requirement: Report output is plain text
The stdout report MUST NOT contain ANSI escape codes or color formatting. Stdout is reserved for machine-readable output (consistent with the stop-hook JSON protocol convention). Human-readable colored output remains on stderr.

#### Scenario: No ANSI codes in stdout
- **WHEN** `agent-gauntlet run --report` writes to stdout
- **THEN** the output SHALL contain no ANSI escape sequences

### Requirement: Report file fallback
The report MUST be written to a file in the log directory in addition to stdout. This provides a fallback for environments where Bun may drop stdout (known issue with LLM review subprocesses).

#### Scenario: Report file written
- **WHEN** `agent-gauntlet run --report` completes
- **THEN** the report content SHALL also be written to `<log_dir>/report.txt`
- **AND** the file content SHALL be identical to what was written to stdout

#### Scenario: Report file overwritten on re-run
- **WHEN** `agent-gauntlet run --report` is invoked and a previous `report.txt` exists
- **THEN** the file SHALL be overwritten with the new report

### Requirement: Numeric IDs are stable within a log session
Numeric IDs assigned to review violations MUST be deterministic and stable between the `--report` output and subsequent `update-review` invocations, as long as the log files have not been modified by a gauntlet re-run. IDs SHALL be assigned by scanning JSON files in sorted filename order, then by violation array index within each file, numbering sequentially from 1, considering only violations with status `"new"`.

#### Scenario: IDs match between report and update-review commands
- **WHEN** `agent-gauntlet run --report` assigns `#3` to a violation at `src/foo.ts:10`
- **AND** `agent-gauntlet update-review list` is run without any intervening gauntlet re-run
- **THEN** `#3` SHALL refer to the same violation at `src/foo.ts:10`

#### Scenario: IDs are sequential with no gaps
- **WHEN** there are 5 violations with status `"new"` across all JSON files
- **THEN** they SHALL be numbered `#1` through `#5` with no gaps

### Requirement: Report flag on run command
The `run` command gains a `--report` flag to enable structured stdout output for external orchestrators. Exit code semantics are unchanged: exit 0 for success statuses (`passed`, `passed_with_warnings`, `no_applicable_gates`, `no_changes`), exit 1 for all others.

#### Scenario: Run with --report flag
- **WHEN** `agent-gauntlet run --report` is invoked
- **THEN** the run SHALL execute normally (all existing behavior preserved)
- **AND** a structured failure report SHALL be written to stdout per the report-flag specification
- **AND** stderr output SHALL remain unchanged
- **AND** exit codes SHALL remain unchanged

#### Scenario: Run with --report and --enable-review
- **WHEN** `agent-gauntlet run --report --enable-review task-compliance` is invoked
- **THEN** both flags SHALL be honored: the enabled review runs AND the report is written to stdout

### Requirement: Update-review list enumerates pending violations
`agent-gauntlet update-review list` SHALL scan all review JSON files in the log directory, collect violations with status `"new"`, and print each with its numeric ID, priority, gate label, file:line, issue, and fix suggestion. The enumeration logic MUST be shared with the `--report` flag so IDs are consistent.

#### Scenario: Violations exist
- **WHEN** `agent-gauntlet update-review list` is run and JSON files contain violations with status `"new"`
- **THEN** each violation SHALL be printed with its numeric ID, priority, gate label, location, issue, and fix

#### Scenario: No violations
- **WHEN** `agent-gauntlet update-review list` is run and no violations with status `"new"` exist
- **THEN** the command SHALL print a message indicating no pending violations and exit 0

#### Scenario: No log directory
- **WHEN** `agent-gauntlet update-review list` is run and the log directory does not exist
- **THEN** the command SHALL print an error message and exit 1

### Requirement: Update-review fix marks a violation as fixed
`agent-gauntlet update-review fix <id> <reason>` SHALL locate the violation matching the numeric ID, set its `status` to `"fixed"` and its `result` to the provided reason string, and write the updated JSON back to disk.

#### Scenario: Valid fix
- **WHEN** `agent-gauntlet update-review fix 1 "Added error handling"` is run and violation `#1` exists with status `"new"`
- **THEN** the violation's `status` SHALL be set to `"fixed"`
- **AND** the violation's `result` SHALL be set to `"Added error handling"`
- **AND** the updated JSON SHALL be written to the same file path
- **AND** a confirmation message SHALL be printed
- **AND** the command SHALL exit 0

#### Scenario: Invalid ID
- **WHEN** `agent-gauntlet update-review fix 99 "reason"` is run and no violation `#99` exists
- **THEN** the command SHALL print an error indicating the ID is invalid
- **AND** the command SHALL exit 1

#### Scenario: Missing reason
- **WHEN** `agent-gauntlet update-review fix 1` is run without a reason argument
- **THEN** the command SHALL print a usage error and exit 1

### Requirement: Update-review skip marks a violation as skipped
`agent-gauntlet update-review skip <id> <reason>` SHALL behave identically to `update-review fix` except that it sets `status` to `"skipped"` instead of `"fixed"`.

#### Scenario: Valid skip
- **WHEN** `agent-gauntlet update-review skip 2 "Stylistic preference"` is run and violation `#2` exists with status `"new"`
- **THEN** the violation's `status` SHALL be set to `"skipped"`
- **AND** the violation's `result` SHALL be set to `"Stylistic preference"`
- **AND** the updated JSON SHALL be written to the same file path
- **AND** a confirmation message SHALL be printed

### Requirement: Only new violations can be updated
The `fix` and `skip` subcommands SHALL only operate on violations with status `"new"`. Attempting to update a violation that has already been marked `"fixed"` or `"skipped"` SHALL produce an error.

#### Scenario: Already fixed violation
- **WHEN** `agent-gauntlet update-review skip 1 "reason"` is run and violation `#1` has status `"fixed"`
- **THEN** the command SHALL print an error indicating the violation is already resolved
- **AND** the command SHALL exit 1

## Done When

- `agent-gauntlet run --report` writes a plain-text failure report to stdout and to `<log_dir>/report.txt`
- The report contains check metadata (gate label, command, directory, fix instructions, log path) but no parsed error output
- The report contains review violations with stable numeric IDs
- `agent-gauntlet update-review list` enumerates pending violations with the same IDs as the report
- `agent-gauntlet update-review fix <id> "reason"` and `skip <id> "reason"` correctly mutate review JSON files
- All spec scenarios pass
- Existing behavior is unchanged when `--report` is not set

# report-flag Specification

## ADDED Requirements

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

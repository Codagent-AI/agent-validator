## MODIFIED Requirements

### Requirement: Report flag writes self-contained failure report to stdout
When `agent-validate run` is invoked with `--report`, the command SHALL write a structured, agent-actionable failure report to stdout. Stderr output SHALL remain unchanged. When no failures exist and no reviewer override is active, stdout SHALL contain only the status line. When a reviewer override is active, stdout SHALL also include the configured review identity named by the reviewer-override capability (source `runner-reviewer-role`, mapped adapter, and `xhigh` collapse when it occurred). When the command fails with an error status, stdout SHALL also carry the failure reason so the report identifies what went wrong. The report MUST be self-contained — an agent reading only the report MUST have enough information to understand what failed and begin fixing it. The report MUST also be written to a file as a fallback for environments where stdout may be lost.

#### Scenario: All gates pass
- **WHEN** `agent-validate run --report` completes and all gates pass
- **AND** no reviewer override is active
- **THEN** stdout SHALL contain a single line: `Status: Passed`

#### Scenario: All gates pass with skipped violations
- **WHEN** `agent-validate run --report` completes and all gates pass but some violations were skipped
- **AND** no reviewer override is active
- **THEN** stdout SHALL contain `Status: Passed with warnings`

#### Scenario: All gates pass with reviewer override
- **WHEN** `agent-validate run --report` completes and all gates pass
- **AND** reviewer override mode is active
- **THEN** stdout SHALL contain the status line
- **AND** stdout SHALL name the configured review identity (`runner-reviewer-role` and the mapped adapter)

#### Scenario: Trusted short-circuit with reviewer override
- **WHEN** `agent-validate run --report` returns trusted without dispatching gates
- **AND** reviewer override mode is active
- **THEN** stdout SHALL still name the configured review identity
- **AND** trust matching SHALL be unchanged from today

#### Scenario: Rejected reviewer override names the variable
- **WHEN** `agent-validate run --report` fails because the reviewer override environment is malformed
- **THEN** stdout SHALL contain the error status line
- **AND** stdout SHALL name the environment variable that was rejected

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
- **WHEN** `agent-validate run` is invoked without `--report`
- **THEN** stdout behavior SHALL be unchanged from current behavior
- **AND** stderr RESULTS SUMMARY SHALL still name the configured review identity when reviewer override is active, per reviewer-override

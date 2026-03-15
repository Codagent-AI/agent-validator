# run-lifecycle Specification (Delta)

## ADDED Requirements

### Requirement: Report flag on run command
The `run` command SHALL accept a `--report` flag to enable structured stdout output for external orchestrators. Exit code semantics MUST remain unchanged: exit 0 for success statuses (`passed`, `passed_with_warnings`, `no_applicable_gates`, `no_changes`), exit 1 for all others.

#### Scenario: Run with --report flag
- **WHEN** `agent-gauntlet run --report` is invoked
- **THEN** the run SHALL execute normally (all existing behavior preserved)
- **AND** a structured failure report SHALL be written to stdout per the report-flag specification
- **AND** stderr output SHALL remain unchanged
- **AND** exit codes SHALL remain unchanged

#### Scenario: Run with --report and --enable-review
- **WHEN** `agent-gauntlet run --report --enable-review task-compliance` is invoked
- **THEN** both flags SHALL be honored: the enabled review runs AND the report is written to stdout

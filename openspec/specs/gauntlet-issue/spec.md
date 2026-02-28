# gauntlet-issue Specification

## Purpose
Specifies the `gauntlet-issue` skill, which collects diagnostic evidence and files structured GitHub bug reports for agent-gauntlet.

## Requirements

### Requirement: Diagnostic Evidence Collection

The `gauntlet-issue` skill SHALL collect runtime evidence from the gauntlet log directory before drafting a bug report.

#### Scenario: Evidence collected from log directory

- **WHEN** the skill is invoked
- **THEN** it SHALL read `.gauntlet/config.yml` to resolve the `log_dir`
- **AND** SHALL collect the last 50 lines of `<log_dir>/.debug.log`
- **AND** SHALL collect the full contents of `<log_dir>/.execution_state`
- **AND** SHALL collect `.gauntlet/config.yml`

#### Scenario: Evidence files missing

- **WHEN** one or more evidence files do not exist
- **THEN** the skill SHALL note which files are absent
- **AND** SHALL proceed with drafting the issue using available evidence

---

### Requirement: Bug Description Input

The `gauntlet-issue` skill SHALL use ARGUMENTS as the bug description if provided, and SHALL ask the user for one if not.

#### Scenario: Description provided in ARGUMENTS

- **WHEN** ARGUMENTS contains a non-empty description of the bug
- **THEN** the skill SHALL use it as the basis for the issue without asking for additional input

#### Scenario: No description in ARGUMENTS

- **WHEN** ARGUMENTS is empty
- **THEN** the skill SHALL ask the user to describe the bug before proceeding

---

### Requirement: Issue Preview and Confirmation

The `gauntlet-issue` skill SHALL show the user a full preview of the issue before filing and SHALL require explicit confirmation.

#### Scenario: User reviews and confirms

- **WHEN** the skill presents the drafted issue (title and body)
- **AND** the user confirms
- **THEN** the skill SHALL file the issue via `gh issue create --repo pacaplan/agent-gauntlet`
- **AND** SHALL report the created issue URL

#### Scenario: User declines

- **WHEN** the skill presents the drafted issue
- **AND** the user declines to file
- **THEN** the skill SHALL exit without creating an issue

---

### Requirement: Issue Structure

Filed issues SHALL follow a consistent structure derived from the collected evidence and bug description.

#### Scenario: Issue body sections

- **WHEN** the skill drafts a GitHub issue
- **THEN** the issue body SHALL contain: Problem, Steps to Reproduce, Expected vs Actual, and Evidence sections
- **AND** the Evidence section SHALL include relevant excerpts from the debug log and execution state

# gauntlet-commit Specification

## Purpose
Specifies the `gauntlet-commit` skill, which orchestrates change detection, validation, and committing in a single agent workflow.

## Requirements

### Requirement: Inline Validation Intent Parsing

The `gauntlet-commit` skill SHALL parse its ARGUMENTS string for a validation intent before prompting the user. If a clear intent is found, it SHALL use it directly without prompting.

#### Scenario: ARGUMENTS contains full-run intent

- **WHEN** ARGUMENTS contains words indicating full gate validation (e.g. "run", "full", "all gates")
- **THEN** the skill SHALL invoke `gauntlet-run` without prompting the user for a choice

#### Scenario: ARGUMENTS contains checks-only intent

- **WHEN** ARGUMENTS contains words indicating checks-only validation (e.g. "check", "checks", "checks only")
- **THEN** the skill SHALL invoke `gauntlet-check` without prompting the user for a choice

#### Scenario: ARGUMENTS contains skip intent

- **WHEN** ARGUMENTS contains words indicating skip (e.g. "skip")
- **THEN** the skill SHALL invoke `agent-gauntlet skip` without prompting the user for a choice

#### Scenario: ARGUMENTS contains no clear intent

- **WHEN** ARGUMENTS is empty or does not contain a recognizable validation intent
- **THEN** the skill SHALL present the user with three choices: run all gates, run checks only, or skip gauntlet

---

### Requirement: Change Detection Gate

The `gauntlet-commit` skill SHALL run `agent-gauntlet detect` before any validation or commit step to determine whether changes exist.

#### Scenario: No changes detected

- **WHEN** `agent-gauntlet detect` reports no changed files
- **THEN** the skill SHALL skip all validation steps
- **AND** SHALL proceed directly to the commit step without prompting

#### Scenario: Changes detected

- **WHEN** `agent-gauntlet detect` reports one or more changed files
- **THEN** the skill SHALL proceed to the validation selection step (inline parse or user prompt)

---

### Requirement: Validation Failure Handling

When the chosen validation skill fails, the `gauntlet-commit` skill SHALL attempt to fix failures before asking the user whether to proceed with the commit.

#### Scenario: Validation fails

- **WHEN** the invoked validation skill (gauntlet-run or gauntlet-check) reports a failed status
- **THEN** the skill SHALL attempt to fix the reported failures per that skill's protocol
- **AND** after fixing, SHALL ask the user "Ready to commit?" before proceeding
- **AND** SHALL NOT automatically commit without user confirmation after a failure cycle

#### Scenario: Validation passes

- **WHEN** the invoked validation skill reports a passed status
- **THEN** the skill SHALL proceed directly to the commit step without additional prompting

---

### Requirement: Commit Step

After validation completes (or is skipped), the `gauntlet-commit` skill SHALL perform the commit using an available commit skill if one exists, and otherwise handle staging and message drafting itself.

#### Scenario: Commit skill available

- **WHEN** a commit skill is found in the `skills/` directory
- **THEN** the skill SHALL invoke that commit skill to perform the commit

#### Scenario: No commit skill available

- **WHEN** no commit skill is found in the `skills/` directory
- **THEN** the skill SHALL stage relevant changes and draft a commit message at the agent's discretion
- **AND** SHALL perform the commit itself

# dynamic-review-control Specification

## Purpose
TBD - created by syncing change dynamic-review-control. Update Purpose after archive.

## Requirements
### Requirement: Review enabled filtering at job generation
The system SHALL skip reviews with `enabled: false` during job generation unless the review name appears in the `enableReviews` set provided via CLI options. Reviews with `enabled: true` (or no `enabled` field, since the default is `true`) SHALL always be included (subject to existing `run_in_ci`/`run_locally` filters).

#### Scenario: Disabled review skipped when no override provided
- **GIVEN** a review is configured in the project with `enabled: false`
- **WHEN** a review has `enabled: false` in its config
- **AND** no `--enable-review` flag names that review
- **THEN** the review SHALL NOT generate any jobs

#### Scenario: Disabled review activated via CLI override
- **GIVEN** a review is configured in the project with `enabled: false`
- **WHEN** a review has `enabled: false` in its config
- **AND** `--enable-review <name>` is passed on the CLI matching that review
- **THEN** the review SHALL generate jobs as if it were enabled

#### Scenario: Enabled reviews unaffected by override flag
- **GIVEN** a review is configured in the project with `enabled: true` (or no `enabled` field)
- **WHEN** a review has `enabled: true` (or no `enabled` field)
- **AND** `--enable-review` is passed for a different review
- **THEN** the review SHALL still generate jobs normally

#### Scenario: Multiple reviews activated via repeated flag
- **GIVEN** `task-compliance` and `security` reviews are configured with `enabled: false`
- **WHEN** `--enable-review task-compliance --enable-review security` is passed
- **THEN** both `task-compliance` and `security` reviews SHALL be activated even if their configs have `enabled: false`

### Requirement: Gauntlet-run skill conditionally enables task-compliance
Both copies of the gauntlet-run skill SHALL pass `--enable-review task-compliance` when a task context file exists at `.gauntlet/current-task-context.md`.

#### Scenario: Task context present activates task-compliance
- **GIVEN** the gauntlet-run skill is installed in the project
- **WHEN** the gauntlet-run skill is invoked
- **AND** `.gauntlet/current-task-context.md` exists
- **THEN** the run command SHALL include `--enable-review task-compliance`

#### Scenario: No task context omits the flag
- **GIVEN** the gauntlet-run skill is installed in the project
- **WHEN** the gauntlet-run skill is invoked
- **AND** `.gauntlet/current-task-context.md` does not exist
- **THEN** the run command SHALL NOT include `--enable-review task-compliance`

### Requirement: Task-compliance review defaults to disabled
The `task-compliance` review SHALL be configured as opt-in in this project, so it does not execute unless explicitly activated.

#### Scenario: Task-compliance does not run without explicit activation
- **GIVEN** the `task-compliance` review is configured with `enabled: false` in this project
- **WHEN** gauntlet is run in this project without `--enable-review task-compliance`
- **THEN** the task-compliance review SHALL NOT execute

## ADDED Requirements

### Requirement: Enable-review CLI option on run and review commands
The `run` and `review` commands SHALL accept a repeatable `--enable-review <name>` option (short: `-e`) that activates disabled reviews for that invocation. The option SHALL collect multiple review names into an array and pass them to the run executor as `enableReviews`.

#### Scenario: Single review enabled via CLI
- **WHEN** `agent-gauntlet run --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that run even if its config has `enabled: false`

#### Scenario: Multiple reviews enabled via repeated flag
- **WHEN** `agent-gauntlet run --enable-review task-compliance --enable-review security` is invoked
- **THEN** both `task-compliance` and `security` reviews SHALL be activated for that run

#### Scenario: Enable-review on review command
- **WHEN** `agent-gauntlet review --enable-review task-compliance` is invoked
- **THEN** the `task-compliance` review SHALL be activated for that review-only run

#### Scenario: Enable-review with unknown name is silently ignored
- **WHEN** `agent-gauntlet run --enable-review nonexistent` is invoked
- **AND** no review named `nonexistent` is configured
- **THEN** the run SHALL proceed normally without error

## MODIFIED Requirements

### Requirement: Gauntlet-Run Skill Auto-Invocation
The gauntlet-run skill SHALL have auto-invocation enabled so that Claude's skill invocation logic can trigger it automatically when the agent completes a coding task. The skill content is stored as static files under `skills/gauntlet-run/` and installed to `.claude/skills/gauntlet-run/` during init.

The gauntlet-run skill SHALL conditionally pass `--enable-review task-compliance` when `.gauntlet/current-task-context.md` exists, activating the task-compliance review for task-driven runs.

#### Scenario: Gauntlet-run skill auto-invocation enabled
- **GIVEN** the gauntlet-run skill is installed at `.claude/skills/gauntlet-run/SKILL.md`
- **WHEN** a user views the skill frontmatter
- **THEN** the skill frontmatter SHALL set `disable-model-invocation: false`
- **AND** the `description` field SHALL contain the phrase "final step after completing a coding task"
- **AND** the `description` field SHALL contain the phrase "before committing, pushing, or creating PRs"

#### Scenario: Gauntlet-run skill activates task-compliance when task context exists
- **WHEN** the gauntlet-run skill is executed
- **AND** `.gauntlet/current-task-context.md` exists
- **THEN** the run command SHALL include `--enable-review task-compliance`

#### Scenario: Gauntlet-run skill omits flag when no task context
- **WHEN** the gauntlet-run skill is executed
- **AND** `.gauntlet/current-task-context.md` does not exist
- **THEN** the run command SHALL NOT include `--enable-review task-compliance`

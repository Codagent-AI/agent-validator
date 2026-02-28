# Task: Update gauntlet-run skills and task-compliance config

## Goal

Update both copies of the gauntlet-run skill to conditionally pass `--enable-review task-compliance`, and set `enabled: false` on the task-compliance review config in this project.

## Background

There are two copies of the gauntlet-run skill:
- `.claude/skills/gauntlet-run/SKILL.md` — dev copy, uses `bun src/index.ts run`
- `skills/gauntlet-run/SKILL.md` — standalone copy, uses `agent-gauntlet run`

Both have Step 2 (Run Gauntlet) and Step 8 (Re-run Verification) where the run command is invoked. Before running, the skill should check if `.gauntlet/current-task-context.md` exists and conditionally append `--enable-review task-compliance`.

The task-compliance review config is at `.gauntlet/reviews/task-compliance.md`. Its frontmatter currently has `num_reviews: 1`. Adding `enabled: false` makes it opt-in.

## Spec

### Requirement: Gauntlet-run skill conditionally enables task-compliance
Both copies of the gauntlet-run skill SHALL pass `--enable-review task-compliance` when a task context file exists at `.gauntlet/current-task-context.md`.

#### Scenario: Task context present activates task-compliance
- **WHEN** the gauntlet-run skill is invoked
- **AND** `.gauntlet/current-task-context.md` exists
- **THEN** the run command SHALL include `--enable-review task-compliance`

#### Scenario: No task context omits the flag
- **WHEN** the gauntlet-run skill is invoked
- **AND** `.gauntlet/current-task-context.md` does not exist
- **THEN** the run command SHALL NOT include `--enable-review task-compliance`

### Requirement: Task-compliance review defaults to disabled
The `task-compliance` review config in this project SHALL set `enabled: false` in its frontmatter.

#### Scenario: Task-compliance disabled in agent-gauntlet project
- **WHEN** the `.gauntlet/reviews/task-compliance.md` config is loaded
- **THEN** `enabled` SHALL be `false`

## Done When

Both gauntlet-run skill files include conditional `--enable-review task-compliance` logic. The task-compliance review config has `enabled: false` in its frontmatter.

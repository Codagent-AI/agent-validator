## ADDED Requirements

### Requirement: Gauntlet-Run Skill Auto-Invocation
The gauntlet-run skill SHALL have auto-invocation enabled so that Claude's skill invocation logic can trigger it automatically when the agent completes a coding task.

#### Scenario: Gauntlet-run skill auto-invocation enabled
- **GIVEN** the gauntlet-run skill template is defined in `buildGauntletSkillContent()`
- **WHEN** `agent-gauntlet init` generates the gauntlet-run skill content
- **THEN** the skill frontmatter SHALL set `disable-model-invocation: false`
- **AND** the `description` field SHALL contain the phrase "final step after completing a coding task"
- **AND** the `description` field SHALL contain the phrase "before committing, pushing, or creating PRs"

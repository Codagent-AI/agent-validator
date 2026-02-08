## ADDED Requirements

### Requirement: Init installs gauntlet-help for Claude
The init command SHALL install the `gauntlet-help` skill for Claude as part of the gauntlet skill set.

#### Scenario: Claude installation includes gauntlet-help bundle
- **GIVEN** a user runs `agent-gauntlet init`
- **AND** Claude is selected for skill installation
- **WHEN** skills are installed
- **THEN** `.claude/skills/gauntlet-help/SKILL.md` SHALL be installed
- **AND** the `gauntlet-help` reference files under `.claude/skills/gauntlet-help/references/` SHALL be installed with it
- **AND** existing non-Claude installation behavior SHALL remain command-based

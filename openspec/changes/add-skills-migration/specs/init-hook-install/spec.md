## MODIFIED Requirements

### Requirement: Push PR Command Installation

The init command SHALL install the `/gauntlet:push-pr` skill alongside other gauntlet skills.

#### Scenario: Skill file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/skills/gauntlet/push-pr/SKILL.md` SHALL be created from the push-pr template

#### Scenario: Skill installed for Claude agent
- **GIVEN** the user selects Claude during init skill installation
- **WHEN** the skills are installed
- **THEN** the push-pr skill SHALL be installed as a symlinked skill directory under `.claude/skills/gauntlet/push-pr/`

#### Scenario: Command installed for non-Claude agents
- **GIVEN** the user selects a non-Claude agent (Gemini, Codex) during init
- **WHEN** the commands are installed
- **THEN** push-pr SHALL be installed as a flat command file in the agent's command directory

#### Scenario: Existing file not overwritten
- **GIVEN** `.gauntlet/skills/gauntlet/push-pr/SKILL.md` already exists
- **WHEN** `agent-gauntlet init` runs
- **THEN** the existing file SHALL NOT be overwritten
- **AND** the system SHALL log a message indicating the file already exists and was preserved

### Requirement: Fix PR Command Installation

The init command SHALL install the `/gauntlet:fix-pr` skill alongside other gauntlet skills.

#### Scenario: Skill file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/skills/gauntlet/fix-pr/SKILL.md` SHALL be created from the fix-pr template

#### Scenario: Skill installed for Claude agent
- **GIVEN** the user selects Claude during init skill installation
- **WHEN** the skills are installed
- **THEN** the fix-pr skill SHALL be installed as a symlinked skill directory under `.claude/skills/gauntlet/fix-pr/`

#### Scenario: Command installed for non-Claude agents
- **GIVEN** the user selects a non-Claude agent (Gemini, Codex) during init
- **WHEN** the commands are installed
- **THEN** fix-pr SHALL be installed as a flat command file in the agent's command directory

#### Scenario: Existing file not overwritten
- **GIVEN** `.gauntlet/skills/gauntlet/fix-pr/SKILL.md` already exists
- **WHEN** `agent-gauntlet init` runs
- **THEN** the existing file SHALL NOT be overwritten
- **AND** the system SHALL log a message indicating the file already exists and was preserved

# init-hook-install Spec Delta

## ADDED Requirements

### Requirement: Fix PR Command Installation

The init command SHALL install the fix-pr template command alongside the gauntlet and push-pr commands.

#### Scenario: Template file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/fix_pr.md` SHALL be created from the fix-pr template

#### Scenario: Command installed for selected agents
- **GIVEN** the user selects agents during init command installation
- **WHEN** the commands are installed
- **THEN** fix-pr command SHALL be installed alongside the gauntlet and push-pr commands for each selected agent
- **AND** for agents that support symlinks, the command SHALL be symlinked to `.gauntlet/fix_pr.md`

#### Scenario: Existing file not overwritten
- **GIVEN** `.gauntlet/fix_pr.md` already exists
- **WHEN** `agent-gauntlet init` runs
- **THEN** the existing file SHALL NOT be overwritten
- **AND** the system SHALL log a message indicating the file already exists and was preserved

# init-hook-install Spec Delta

## ADDED Requirements

### Requirement: Push PR Command Installation

The init command SHALL install the push-pr template command alongside the gauntlet command.

#### Scenario: Template file created during init
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/push_pr.md` SHALL be created from the push-pr template

#### Scenario: Command installed for selected agents
- **GIVEN** the user selects agents during init command installation
- **WHEN** the commands are installed
- **THEN** push-pr command SHALL be installed alongside the gauntlet command for each selected agent
- **AND** for agents that support symlinks, the command SHALL be symlinked to `.gauntlet/push_pr.md`

#### Scenario: Existing file not overwritten
- **GIVEN** `.gauntlet/push_pr.md` already exists
- **WHEN** `agent-gauntlet init` runs
- **THEN** the existing file SHALL NOT be overwritten
- **AND** the system SHALL log a message indicating the file already exists and was preserved

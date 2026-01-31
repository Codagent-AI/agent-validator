# init-hook-install Specification

## Purpose
TBD - created by archiving change add-stop-hook. Update Purpose after archive.
## Requirements
### Requirement: Stop Hook Installation Prompt

The init command SHALL prompt the user to install the Claude Code stop hook.

#### Scenario: User accepts hook installation
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** the gauntlet config has been created
- **WHEN** prompted "Install Claude Code stop hook? (y/n)"
- **AND** the user responds "y" or "yes"
- **THEN** `.claude/settings.local.json` SHALL be created with the stop hook configuration

#### Scenario: User declines hook installation
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** the gauntlet config has been created
- **WHEN** prompted "Install Claude Code stop hook? (y/n)"
- **AND** the user responds "n" or "no"
- **THEN** no `.claude/settings.local.json` SHALL be created

#### Scenario: Non-interactive mode
- **GIVEN** the user runs `agent-gauntlet init` in a non-interactive environment (no TTY)
- **WHEN** the init command runs
- **THEN** the hook installation prompt SHALL be skipped
- **AND** no `.claude/settings.local.json` SHALL be created

### Requirement: Settings File Creation

The hook configuration SHALL be written to `.claude/settings.local.json`.

#### Scenario: .claude directory does not exist
- **GIVEN** the project has no `.claude/` directory
- **WHEN** the user accepts hook installation
- **THEN** the `.claude/` directory SHALL be created
- **AND** `.claude/settings.local.json` SHALL be created with the hook configuration

#### Scenario: .claude directory exists without settings
- **GIVEN** the project has a `.claude/` directory
- **AND** no `settings.local.json` exists
- **WHEN** the user accepts hook installation
- **THEN** `.claude/settings.local.json` SHALL be created with the hook configuration

#### Scenario: settings.local.json already exists
- **GIVEN** the project has `.claude/settings.local.json`
- **WHEN** the user accepts hook installation
- **THEN** the existing hooks configuration SHALL be merged (not overwritten)
- **AND** existing Stop hooks SHALL be preserved alongside the new hook

### Requirement: Hook Configuration Content

The generated hook configuration MUST follow the Claude Code hook format.

#### Scenario: Hook configuration structure
- **GIVEN** the user accepts hook installation
- **WHEN** `.claude/settings.local.json` is created
- **THEN** it SHALL contain a `hooks.Stop` array with a command hook
- **AND** the command SHALL be `agent-gauntlet stop-hook`
- **AND** the timeout SHALL be 300 seconds

#### Scenario: Configuration JSON format
- **GIVEN** the user accepts hook installation
- **WHEN** the configuration is written
- **THEN** the JSON SHALL be properly formatted (indented for readability)

### Requirement: Installation Feedback

The user SHALL receive confirmation of hook installation.

#### Scenario: Successful installation
- **GIVEN** the user accepts hook installation
- **WHEN** the settings file is created
- **THEN** the output SHALL show "Stop hook installed - gauntlet will run automatically when agent stops"

#### Scenario: Installation skipped
- **GIVEN** the user declines hook installation
- **WHEN** the init command completes
- **THEN** no message about hook installation SHALL be shown

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


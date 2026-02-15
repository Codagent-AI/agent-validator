## REMOVED Requirements
### Requirement: Stop Hook Installation Prompt
**Reason**: The stop hook is now auto-installed when Claude Code or Cursor is detected. No user prompt needed.
**Migration**: Stop hook installation is automatic during `init`. Users who don't want the stop hook can disable it via `stop_hook.enabled: false` in config or `GAUNTLET_STOP_HOOK_ENABLED=0` env var.

## MODIFIED Requirements
### Requirement: Settings File Creation

The hook configuration SHALL be written to the appropriate settings file for each detected CLI that supports stop hooks. For Claude Code, the target is `.claude/settings.local.json`. For Cursor, the target is `.cursor/hooks.json`.

#### Scenario: Claude Code detected during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude Code is among the selected CLIs
- **WHEN** the init command completes
- **THEN** `.claude/settings.local.json` SHALL be created or updated with the stop hook configuration
- **AND** no user prompt SHALL be shown for hook installation

#### Scenario: Cursor detected during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is among the selected CLIs
- **WHEN** the init command completes
- **THEN** `.cursor/hooks.json` SHALL be created or updated with the stop hook configuration
- **AND** no user prompt SHALL be shown for hook installation

#### Scenario: Auto-install with --yes flag
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** Claude Code and Cursor are both available
- **WHEN** the init command completes
- **THEN** stop hooks SHALL be installed for both CLIs without any prompts

#### Scenario: Neither Claude Code nor Cursor selected
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** neither Claude Code nor Cursor is among the selected CLIs
- **WHEN** the init command completes
- **THEN** no stop hook settings files SHALL be created

#### Scenario: .claude directory does not exist
- **GIVEN** the project has no `.claude/` directory
- **AND** Claude Code is among the selected CLIs
- **WHEN** the init command runs
- **THEN** the `.claude/` directory SHALL be created
- **AND** `.claude/settings.local.json` SHALL be created with the hook configuration

#### Scenario: settings.local.json already exists with hook
- **GIVEN** the project has `.claude/settings.local.json` with the gauntlet stop hook already configured
- **WHEN** the init command runs
- **THEN** the existing hook SHALL be preserved (no duplicate added)

#### Scenario: settings.local.json already exists without hook
- **GIVEN** the project has `.claude/settings.local.json` without the gauntlet stop hook
- **WHEN** the init command runs
- **THEN** the gauntlet stop hook SHALL be added to the existing Stop hooks array
- **AND** existing hooks SHALL be preserved

#### Scenario: .cursor directory does not exist
- **GIVEN** the project has no `.cursor/` directory
- **AND** Cursor is among the selected CLIs
- **WHEN** the init command runs
- **THEN** the `.cursor/` directory SHALL be created
- **AND** `.cursor/hooks.json` SHALL be created with the hook configuration

#### Scenario: hooks.json already exists with hook
- **GIVEN** the project has `.cursor/hooks.json` with the gauntlet stop hook already configured
- **WHEN** the init command runs
- **THEN** the existing hook SHALL be preserved (no duplicate added)

#### Scenario: hooks.json already exists without hook
- **GIVEN** the project has `.cursor/hooks.json` without the gauntlet stop hook
- **WHEN** the init command runs
- **THEN** the gauntlet stop hook SHALL be added to the existing stop hooks array
- **AND** existing hooks SHALL be preserved

### Requirement: Hook Configuration Content

The generated hook configuration MUST follow the Claude Code hook format.

#### Scenario: Hook configuration structure
- **GIVEN** Claude Code is among the selected CLIs
- **WHEN** `.claude/settings.local.json` is created
- **THEN** it SHALL contain a `hooks.Stop` array with a command hook
- **AND** the command SHALL be `agent-gauntlet stop-hook`
- **AND** the timeout SHALL be 300 seconds

#### Scenario: Configuration JSON format
- **GIVEN** Claude Code is among the selected CLIs
- **WHEN** the configuration is written
- **THEN** the JSON SHALL be properly formatted (indented for readability)

### Requirement: Installation Feedback

The user SHALL receive confirmation of hook installation.

#### Scenario: Successful auto-installation
- **GIVEN** Claude Code or Cursor is among the selected CLIs
- **WHEN** the stop hook is auto-installed
- **THEN** the output SHALL indicate the hook was installed for each CLI

#### Scenario: Hook already installed
- **GIVEN** the stop hook is already installed for a CLI
- **WHEN** the init command runs
- **THEN** the output SHALL indicate the hook already exists (dimmed/skipped message)

## ADDED Requirements
### Requirement: Cursor Hook Configuration Content

The generated Cursor hook configuration MUST follow the Cursor hooks.json format.

#### Scenario: Cursor hook configuration structure
- **GIVEN** Cursor is among the selected CLIs
- **WHEN** `.cursor/hooks.json` is created
- **THEN** it SHALL contain a `hooks.stop` array with a command entry
- **AND** the command SHALL be `agent-gauntlet stop-hook`
- **AND** the loop_limit SHALL be 10

#### Scenario: Cursor hooks.json format
- **GIVEN** Cursor is among the selected CLIs
- **WHEN** the hooks.json is created
- **THEN** the JSON SHALL include `version: 1` at the top level
- **AND** the JSON SHALL be properly formatted (indented for readability)

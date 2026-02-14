## ADDED Requirements

### Requirement: Start Hook Installation

The init command SHALL install a start hook for each detected CLI alongside the stop hook, priming the agent with gauntlet instructions at session start.

#### Scenario: Claude Code start hook installed during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude Code is detected as an available CLI
- **WHEN** the init command installs hooks
- **THEN** `.claude/settings.local.json` SHALL contain a `hooks.SessionStart` array with a command hook
- **AND** the command SHALL be `agent-gauntlet start-hook`
- **AND** the hook SHALL be non-async (synchronous)
- **AND** the hook matcher SHALL cover session start events (startup, resume, clear, compact)

#### Scenario: Cursor start hook installed during init
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is detected as an available CLI
- **WHEN** the init command installs hooks
- **THEN** `.cursor/hooks.json` SHALL contain a `hooks.beforeSubmitPrompt` array with a command entry
- **AND** the command SHALL be `agent-gauntlet start-hook --adapter cursor`

#### Scenario: Start hook merged with existing Claude Code settings
- **GIVEN** `.claude/settings.local.json` already exists with other hooks
- **WHEN** the start hook is installed
- **THEN** the existing hooks configuration SHALL be merged (not overwritten)
- **AND** existing SessionStart hooks SHALL be preserved alongside the new hook

#### Scenario: Cursor start hook merged with existing hooks
- **GIVEN** `.cursor/hooks.json` already exists with other hooks
- **WHEN** the start hook is installed
- **THEN** the existing hooks configuration SHALL be merged (not overwritten)
- **AND** existing beforeSubmitPrompt hooks SHALL be preserved alongside the new hook

#### Scenario: Duplicate start hook prevention
- **GIVEN** `.claude/settings.local.json` already contains an `agent-gauntlet start-hook` entry in `hooks.SessionStart`
- **WHEN** `agent-gauntlet init` runs again
- **THEN** no duplicate start hook entry SHALL be added

#### Scenario: Cursor duplicate start hook prevention
- **GIVEN** `.cursor/hooks.json` already contains an `agent-gauntlet start-hook --adapter cursor` entry in `hooks.beforeSubmitPrompt`
- **WHEN** `agent-gauntlet init` runs again
- **THEN** no duplicate start hook entry SHALL be added

### Requirement: Start Hook Installation Feedback

The user SHALL receive confirmation of start hook installation via a console log message.

#### Scenario: Successful start hook installation
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** a CLI is detected
- **WHEN** the start hook is installed
- **THEN** it SHALL log a message to stdout indicating the start hook was installed (mirroring the existing stop hook confirmation message pattern)

## MODIFIED Requirements

### Requirement: Hook Configuration Content

This modifies the existing "Hook Configuration Content" requirement in the base `init-hook-install` spec to include start hook entries alongside stop hook entries.

The generated hook configuration MUST follow the Claude Code hook format. The configuration SHALL include both stop hook and start hook entries.

#### Scenario: Hook configuration structure
- **GIVEN** the user accepts hook installation
- **WHEN** `.claude/settings.local.json` is created
- **THEN** it SHALL contain a `hooks.Stop` array with a command hook for `agent-gauntlet stop-hook`
- **AND** it SHALL contain a `hooks.SessionStart` array with a command hook for `agent-gauntlet start-hook`
- **AND** the stop hook timeout SHALL be 300 seconds

#### Scenario: Configuration JSON format
- **GIVEN** the user accepts hook installation
- **WHEN** the configuration is written
- **THEN** the JSON SHALL be properly formatted (indented for readability)

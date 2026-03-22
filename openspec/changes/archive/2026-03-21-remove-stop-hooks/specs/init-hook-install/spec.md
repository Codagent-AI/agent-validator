## MODIFIED Requirements

### Requirement: Hook delivery via plugin

Claude Code and Cursor hooks SHALL be delivered as part of the agent-gauntlet plugin via `hooks/hooks.json` in the plugin directory, instead of being written to settings files during init.

#### Scenario: Claude hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries to `.claude/settings.local.json`

#### Scenario: Claude plugin hooks.json contains no stop or start hooks
- **GIVEN** the agent-gauntlet Claude plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's `hooks/hooks.json` SHALL NOT contain a stop hook
- **AND** the plugin's `hooks/hooks.json` SHALL NOT contain a start hook

#### Scenario: Cursor plugin hooks file contains no stop or start hooks
- **GIVEN** the agent-gauntlet Cursor plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's hooks file SHALL NOT contain a stop hook
- **AND** the plugin's hooks file SHALL NOT contain a start hook

#### Scenario: Cursor hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Cursor is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries directly to `.cursor/hooks.json`

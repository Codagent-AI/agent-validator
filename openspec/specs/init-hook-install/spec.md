# init-hook-install Specification

## Purpose
Hook installation during `agent-validator init`. Covers plugin-based hook delivery for Claude and checksum computation for skills.
## Requirements
### Requirement: Hook delivery via plugin

Claude Code and Cursor hooks SHALL be delivered as part of the agent-validator plugin via `hooks/hooks.json` in the plugin directory, instead of being written to settings files during init.

#### Scenario: Claude hooks delivered through plugin
- **GIVEN** the user runs `agent-validator init`
- **AND** Claude is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries to `.claude/settings.local.json`

#### Scenario: Claude plugin hooks.json contains no stop or start hooks
- **GIVEN** the agent-validator Claude plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's `hooks/hooks.json` SHALL NOT contain a stop hook
- **AND** the plugin's `hooks/hooks.json` SHALL NOT contain a start hook

#### Scenario: Cursor plugin hooks file contains no stop or start hooks
- **GIVEN** the agent-validator Cursor plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's hooks file SHALL NOT contain a stop hook
- **AND** the plugin's hooks file SHALL NOT contain a start hook

#### Scenario: Cursor hooks delivered through plugin
- **GIVEN** the user runs `agent-validator init`
- **AND** Cursor is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries directly to `.cursor/hooks.json`

### Requirement: Checksum computation for skills

Skill checksums SHALL be computed over the combined content of all files in the skill directory (SKILL.md + references/*), providing a single checksum per skill.

#### Scenario: Single-file skill checksum
- **GIVEN** a skill directory contains only `SKILL.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of `SKILL.md` content

#### Scenario: Multi-file skill checksum
- **GIVEN** a skill directory contains `SKILL.md` and `references/config.md`
- **WHEN** the checksum is computed
- **THEN** it SHALL be the hash of the concatenated content of all files (sorted by path for determinism)


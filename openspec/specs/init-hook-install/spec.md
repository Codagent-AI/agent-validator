# init-hook-install Specification

## Purpose
Hook installation during `agent-gauntlet init`. Covers plugin-based hook delivery for Claude and checksum computation for skills.
## Requirements
### Requirement: Hook delivery via plugin

Claude Code and Cursor hooks SHALL be delivered as part of the agent-gauntlet plugin via `hooks/hooks.json` in the plugin directory, instead of being written to settings files during init.

#### Scenario: Claude hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** Claude is among the selected development CLIs
- **WHEN** the plugin is installed
- **THEN** hooks SHALL be served from the plugin's `hooks/hooks.json`
- **AND** init SHALL NOT write hook entries to `.claude/settings.local.json`

#### Scenario: Claude plugin hooks.json contains start and stop hooks
- **GIVEN** the agent-gauntlet Claude plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's `hooks/hooks.json` SHALL contain a stop hook for `agent-gauntlet stop-hook`
- **AND** SHALL contain a start hook for `agent-gauntlet start-hook`
- **AND** the stop hook timeout SHALL be 300 seconds

#### Scenario: Cursor plugin hooks file contains start and stop hooks
- **GIVEN** the agent-gauntlet Cursor plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's hooks file SHALL contain a stop hook for `agent-gauntlet stop-hook` with a `loop_limit`
- **AND** SHALL contain a start hook for `agent-gauntlet start-hook --adapter cursor`

#### Scenario: Cursor hooks delivered through plugin
- **GIVEN** the user runs `agent-gauntlet init`
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


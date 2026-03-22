# plugin-update Specification

## Purpose
Plugin update logic for `agent-validate update`. Covers Claude plugin location detection, plugin update execution, and Codex skill update.
## Requirements
### Requirement: Plugin location detection

The `update` command SHALL detect where the agent-validator plugin is installed by running `claude plugin list --json` and parsing the output. It SHALL also check for Cursor plugin installations via adapter detection.

#### Scenario: Plugin installed locally only
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the plugin is installed at project scope for the current project
- **THEN** update SHALL target the project-scope installation

#### Scenario: Plugin installed globally only
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the plugin is installed at user scope but not at project scope
- **THEN** update SHALL target the user-scope installation

#### Scenario: Plugin installed at both scopes
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the plugin is installed at both project and user scope
- **THEN** update SHALL target the project-scope installation only (closest scope wins)

#### Scenario: No plugins installed anywhere
- **GIVEN** the user runs `agent-validate update`
- **WHEN** no Claude plugin, no Cursor plugin, and no Codex skills are found
- **THEN** update SHALL exit with an error message telling the user to run `agent-validate init` first

### Requirement: Plugin update execution

The `update` command SHALL update plugins for all supported adapters that have installed plugins, not just Claude. It SHALL run Claude plugin marketplace update, then iterate over adapters with `updatePlugin` methods to refresh their installations.

#### Scenario: Update succeeds
- **GIVEN** the user runs `agent-validate update`
- **WHEN** Claude marketplace update and plugin update commands succeed
- **AND** all adapter plugin updates succeed
- **THEN** update SHALL report success
- **AND** SHALL tell the user to restart any open agent sessions

#### Scenario: Claude update fails but Cursor update succeeds
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the Claude plugin update command fails
- **BUT** the Cursor plugin update succeeds
- **THEN** update SHALL report the Claude error and print manual update instructions
- **AND** SHALL still report the Cursor update as successful

#### Scenario: No Claude plugin but Cursor plugin exists
- **GIVEN** the user runs `agent-validate update`
- **WHEN** no Claude plugin is installed
- **BUT** a Cursor plugin is installed
- **THEN** update SHALL skip Claude plugin update
- **AND** SHALL update the Cursor plugin
- **AND** SHALL NOT error about missing Claude plugin

### Requirement: Codex skill update

The `update` command SHALL update Codex skills if they are installed, using the same file-copy and checksum logic as init.

#### Scenario: Codex skills installed locally
- **GIVEN** the user runs `agent-validate update`
- **WHEN** `.agents/skills/` exists in the current project with gauntlet skills
- **THEN** update SHALL refresh those skills using checksum comparison
- **AND** changed skills SHALL be overwritten (update implies consent)

#### Scenario: Codex skills installed globally
- **GIVEN** the user runs `agent-validate update`
- **WHEN** `$HOME/.agents/skills/` contains gauntlet skills
- **AND** no local Codex skills exist
- **THEN** update SHALL refresh the global Codex skills

#### Scenario: No Codex skills installed
- **GIVEN** the user runs `agent-validate update`
- **WHEN** no gauntlet skills are found in either Codex skill location
- **THEN** update SHALL skip Codex skill update silently


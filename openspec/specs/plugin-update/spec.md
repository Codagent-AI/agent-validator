# plugin-update Specification

## Purpose
Plugin update logic for `agent-gauntlet update`. Covers Claude plugin location detection, plugin update execution, and Codex skill update.
## Requirements
### Requirement: Plugin location detection

The `update` command SHALL detect where the agent-gauntlet plugin is installed by running `claude plugin list --json` and parsing the output.

#### Scenario: Plugin installed locally only
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** the plugin is installed at project scope for the current project
- **THEN** update SHALL target the project-scope installation

#### Scenario: Plugin installed globally only
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** the plugin is installed at user scope but not at project scope
- **THEN** update SHALL target the user-scope installation

#### Scenario: Plugin installed at both scopes
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** the plugin is installed at both project and user scope
- **THEN** update SHALL target the project-scope installation only (closest scope wins)

#### Scenario: Plugin not installed anywhere
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** the plugin is not found in the plugin list
- **THEN** update SHALL exit with an error message telling the user to run `agent-gauntlet init` first

### Requirement: Plugin update execution

The `update` command SHALL update the plugin by running `claude plugin marketplace update agent-gauntlet` followed by `claude plugin update agent-gauntlet@pcaplan/agent-gauntlet`.

#### Scenario: Update succeeds
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** both marketplace update and plugin update commands succeed
- **THEN** update SHALL report success
- **AND** SHALL tell the user to restart any open agent sessions

#### Scenario: Update fails
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** either update command fails
- **THEN** update SHALL report the error and print manual update instructions

### Requirement: Codex skill update

The `update` command SHALL update Codex skills if they are installed, using the same file-copy and checksum logic as init.

#### Scenario: Codex skills installed locally
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** `.agents/skills/` exists in the current project with gauntlet skills
- **THEN** update SHALL refresh those skills using checksum comparison
- **AND** changed skills SHALL be overwritten (update implies consent)

#### Scenario: Codex skills installed globally
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** `$HOME/.agents/skills/` contains gauntlet skills
- **AND** no local Codex skills exist
- **THEN** update SHALL refresh the global Codex skills

#### Scenario: No Codex skills installed
- **GIVEN** the user runs `agent-gauntlet update`
- **WHEN** no gauntlet skills are found in either Codex skill location
- **THEN** update SHALL skip Codex skill update silently

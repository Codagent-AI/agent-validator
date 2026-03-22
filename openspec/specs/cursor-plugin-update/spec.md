# cursor-plugin-update Specification

## Purpose
TBD - created by archiving change cursor-plugin-update. Update Purpose after archive.
## Requirements
### Requirement: Cursor plugin detection for update

The `update` command SHALL detect installed Cursor plugins by calling `CursorAdapter.detectPlugin()` to determine the installed scope (user or project).

#### Scenario: Cursor plugin installed at user scope
- **WHEN** the user runs `agent-validator update`
- **AND** the Cursor plugin exists at `~/.cursor/plugins/agent-validator/`
- **THEN** update SHALL target the user-scope Cursor installation for refresh

#### Scenario: Cursor plugin installed at project scope
- **WHEN** the user runs `agent-validator update`
- **AND** the Cursor plugin exists at `.cursor/plugins/agent-validator/`
- **THEN** update SHALL target the project-scope Cursor installation for refresh

#### Scenario: Cursor plugin not installed
- **WHEN** the user runs `agent-validator update`
- **AND** no Cursor plugin is found at either scope
- **THEN** update SHALL skip the Cursor plugin update silently

### Requirement: Cursor plugin asset refresh

The `update` command SHALL refresh Cursor plugin files by re-copying assets from the npm package to the installed location, overwriting existing files.

#### Scenario: Assets refreshed on update
- **WHEN** the Cursor plugin is detected at a scope
- **THEN** update SHALL copy `.cursor-plugin/`, `skills/`, and `hooks/cursor-hooks.json` from the package to the target directory
- **AND** existing files SHALL be overwritten

#### Scenario: Update reports success
- **WHEN** the Cursor plugin asset refresh completes without error
- **THEN** update SHALL log a success message indicating the Cursor plugin was updated
- **AND** SHALL tell the user to restart any open Cursor sessions

#### Scenario: Update reports failure
- **WHEN** copying Cursor plugin assets fails
- **THEN** update SHALL log a warning with the error message
- **AND** SHALL continue with remaining update steps (Claude plugin, Codex skills)
- **AND** SHALL NOT cause the overall update command to fail

### Requirement: CLIAdapter updatePlugin interface

The `CLIAdapter` interface SHALL include an optional `updatePlugin` method so that update logic is adapter-driven.

#### Scenario: Adapter with updatePlugin
- **WHEN** an adapter implements `updatePlugin`
- **THEN** the update command SHALL call it when that adapter's plugin is detected

#### Scenario: Adapter without updatePlugin
- **WHEN** an adapter does not implement `updatePlugin`
- **THEN** the update command SHALL skip that adapter during update


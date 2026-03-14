# Task: Create Cursor plugin assets

## Goal

Create the static files needed for Cursor plugin distribution: the plugin manifest, the Cursor-format hooks file, and the package.json update to include them in the npm package.

## Background

The Claude plugin uses `.claude-plugin/plugin.json` (with fields `name`, `version`, `description`, `license`) and `hooks/hooks.json` in Claude's hook format. Cursor needs parallel files in its own formats.

Cursor auto-discovers bundled assets by convention — the manifest does not declare them. Cursor's hook format uses lowercase keys (`stop`, `sessionStart`), flat entries (no nested `hooks` array), and `loop_limit` instead of `timeout`. No `marketplace.json` is needed for Cursor — publishing is web-based.

The existing `package.json` `files` array includes `.claude-plugin` and `hooks` (which already covers any new file in `hooks/`). Only `.cursor-plugin` needs to be added.

Read these files before starting:
- `openspec/changes/cursor-coding-agent-support/proposal.md`
- `openspec/changes/cursor-coding-agent-support/design.md`
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `.cursor/hooks.json`
- `package.json`

## Spec

### Requirement: Cursor plugin manifest exists

The npm package SHALL include a `.cursor-plugin/plugin.json` manifest so the package can be discovered as a Cursor plugin.

#### Scenario: Manifest contents
- **WHEN** the package is built
- **THEN** `.cursor-plugin/plugin.json` SHALL contain at minimum `name`, `version`, `description`, and `license` fields

### Requirement: Version sync with package.json

The `version` field in `.cursor-plugin/plugin.json` SHALL match the version in `package.json`.

#### Scenario: Version matches
- **WHEN** the package is published
- **THEN** the `version` in `.cursor-plugin/plugin.json` SHALL equal the `version` in `package.json`

### Requirement: No separate marketplace metadata

The `.cursor-plugin/` directory SHALL NOT include a separate `marketplace.json` file.

#### Scenario: No marketplace.json needed
- **WHEN** the package is built
- **THEN** `.cursor-plugin/` SHALL contain only `plugin.json`
- **AND** no separate marketplace metadata file SHALL be required

### Requirement: Bundled asset discovery by convention

The plugin manifest SHALL NOT explicitly declare bundled assets.

#### Scenario: Plugin directory follows convention structure
- **WHEN** the plugin is installed
- **THEN** the plugin directory SHALL contain a `skills/` subdirectory with skill files
- **AND** SHALL contain a `hooks/` subdirectory with the hooks configuration file

### Requirement: Cursor plugin hooks file contains start and stop hooks

#### Scenario: Cursor plugin hooks file contains start and stop hooks
- **GIVEN** the agent-gauntlet Cursor plugin is installed
- **WHEN** hook configuration is evaluated
- **THEN** the plugin's hooks file SHALL contain a stop hook for `agent-gauntlet stop-hook` with a `loop_limit`
- **AND** SHALL contain a start hook for `agent-gauntlet start-hook --adapter cursor`

## Done When

`.cursor-plugin/plugin.json` exists with correct fields, `hooks/cursor-hooks.json` exists in Cursor's format with stop and start hooks, `.cursor-plugin` is in the `package.json` `files` array, and tests covering the above scenarios pass.

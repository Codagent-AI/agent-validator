# cursor-plugin-manifest Specification

## Purpose
Cursor plugin manifest (`.cursor-plugin/plugin.json`) and marketplace metadata for distributing agent-gauntlet as a Cursor plugin.

## ADDED Requirements

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

The `.cursor-plugin/` directory SHALL NOT include a separate `marketplace.json` file. Cursor marketplace publishing is web-based — the plugin manifest (`plugin.json`) is sufficient for local and marketplace distribution.

#### Scenario: No marketplace.json needed
- **WHEN** the package is built
- **THEN** `.cursor-plugin/` SHALL contain only `plugin.json`
- **AND** no separate marketplace metadata file SHALL be required

### Requirement: Bundled asset discovery by convention

The plugin manifest SHALL NOT explicitly declare bundled assets. Cursor auto-discovers skills and hooks by convention from the plugin directory structure.

#### Scenario: Plugin directory follows convention structure
- **WHEN** the plugin is installed
- **THEN** the plugin directory SHALL contain a `skills/` subdirectory with skill files
- **AND** SHALL contain a `hooks/` subdirectory with the hooks configuration file

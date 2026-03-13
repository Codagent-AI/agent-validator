# plugin-install Specification

## Purpose
Plugin installation during `agent-gauntlet init`. Covers Claude plugin marketplace registration, plugin installation with scope, and plugin manifest requirements.
## Requirements
### Requirement: Plugin marketplace registration

The `init` command SHALL run `claude plugin marketplace add pcaplan/agent-gauntlet` before attempting plugin installation. The command SHALL be run unconditionally (no pre-check).

#### Scenario: Marketplace add succeeds
- **GIVEN** the user runs `agent-gauntlet init` with Claude selected
- **WHEN** `init` runs the marketplace add command
- **AND** the command succeeds
- **THEN** init SHALL proceed to plugin installation

#### Scenario: Marketplace add fails
- **GIVEN** the user runs `agent-gauntlet init` with Claude selected
- **WHEN** `init` runs the marketplace add command
- **AND** the command fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions (the marketplace add and plugin install commands)
- **AND** SHALL continue with remaining init steps (Codex skills, other CLIs)

### Requirement: Plugin installation with scope

The `init` command SHALL support plugin installation for any adapter that provides a plugin install mechanism. Each adapter SHALL define its own installation strategy (e.g., CLI commands, local file copy). The init flow SHALL prompt for scope (user/project), delegate to the adapter's install mechanism, and handle success/failure uniformly.

#### Scenario: Adapter-specific installation dispatched
- **WHEN** the user selects a development CLI that supports plugin installation
- **THEN** init SHALL delegate to that adapter's installation strategy with the selected scope

#### Scenario: Already-installed detection
- **WHEN** the plugin is already installed for the selected adapter at any scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

#### Scenario: Installation failure
- **WHEN** the adapter's installation strategy fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print adapter-specific manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Plugin manifest

The npm package SHALL include a `.claude-plugin/plugin.json` manifest so the package can be discovered as a Claude Code plugin.

#### Scenario: Plugin manifest contents
- **GIVEN** the agent-gauntlet npm package is built
- **WHEN** the package is published
- **THEN** `.claude-plugin/plugin.json` SHALL contain `name`, `version`, `description`, and `license` fields
- **AND** the `version` field SHALL match the version in `package.json`


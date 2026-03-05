# plugin-install Specification

## Purpose
Plugin installation during `agent-gauntlet init`. Covers Claude plugin marketplace registration, plugin installation with scope, and plugin manifest requirements.
## Requirements
### Requirement: Plugin marketplace registration

The `init` command SHALL run `claude plugin marketplace add pcaplan/agent-gauntlet` before attempting plugin installation. The command SHALL be run unconditionally (no pre-check).

#### Scenario: Marketplace add succeeds
- **WHEN** `init` runs the marketplace add command
- **AND** the command succeeds
- **THEN** init SHALL proceed to plugin installation

#### Scenario: Marketplace add fails
- **WHEN** `init` runs the marketplace add command
- **AND** the command fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions (the marketplace add and plugin install commands)
- **AND** SHALL continue with remaining init steps (Codex skills, other CLIs)

### Requirement: Plugin installation with scope

The `init` command SHALL install the agent-gauntlet Claude plugin using `claude plugin install agent-gauntlet --scope <scope>`, where scope is `user` (global) or `project` (local) based on the user's selection.

#### Scenario: User selects local scope
- **WHEN** the user selects local/project installation
- **THEN** init SHALL run `claude plugin install agent-gauntlet --scope project`

#### Scenario: User selects global scope
- **WHEN** the user selects global installation
- **THEN** init SHALL run `claude plugin install agent-gauntlet --scope user`

#### Scenario: Plugin already installed at different scope
- **WHEN** the plugin is already installed at a different scope
- **THEN** init SHALL install at the requested scope regardless (both installations coexist)

#### Scenario: Plugin install command fails
- **WHEN** `claude plugin install` fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Plugin manifest

The npm package SHALL include a `.claude-plugin/plugin.json` manifest so the package can be discovered as a Claude Code plugin.

#### Scenario: Plugin manifest contents
- **WHEN** the package is published
- **THEN** `.claude-plugin/plugin.json` SHALL contain `name`, `version`, `description`, and `license` fields
- **AND** the `version` field SHALL match the version in `package.json`

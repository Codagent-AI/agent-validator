# plugin-install Specification

## Purpose
Plugin installation during `agent-validate init`. Covers Claude plugin marketplace registration, plugin installation with scope, and plugin manifest requirements.
## Requirements
### Requirement: Plugin marketplace registration

The `init` command SHALL run `claude plugin marketplace add Codagent-AI/agent-validator` before attempting plugin installation. The command SHALL be run unconditionally (no pre-check).

#### Scenario: Marketplace add succeeds
- **GIVEN** the user runs `agent-validate init` with Claude selected
- **WHEN** `init` runs the marketplace add command
- **AND** the command succeeds
- **THEN** init SHALL proceed to plugin installation

#### Scenario: Marketplace add fails
- **GIVEN** the user runs `agent-validate init` with Claude selected
- **WHEN** `init` runs the marketplace add command
- **AND** the command fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print manual installation instructions (the marketplace add and plugin install commands)
- **AND** SHALL continue with remaining init steps (Codex skills, other CLIs)

### Requirement: Plugin installation with scope

The `init` command SHALL support plugin installation for any adapter that provides a plugin install mechanism. Each adapter SHALL define its own installation strategy (e.g., CLI commands, local file copy). The init flow SHALL prompt for scope (user/project), delegate to the adapter's install mechanism, and handle success/failure uniformly.

#### Scenario: Adapter-specific installation dispatched
- **GIVEN** the user runs `agent-validate init` with a plugin-capable CLI selected
- **WHEN** the user selects a development CLI that supports plugin installation
- **THEN** init SHALL delegate to that adapter's installation strategy with the selected scope

#### Scenario: Already-installed detection
- **GIVEN** the user runs `agent-validate init` with a plugin-capable CLI selected
- **WHEN** the plugin is already installed for the selected adapter at any scope
- **THEN** init SHALL inform the user it is already installed and at which scope
- **AND** SHALL skip the scope prompt
- **AND** SHALL skip the install step

#### Scenario: Installation failure
- **GIVEN** the user runs `agent-validate init` with a plugin-capable CLI selected
- **WHEN** the adapter's installation strategy fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print adapter-specific manual installation instructions
- **AND** SHALL continue with remaining init steps

#### Scenario: Copilot adapter dispatched for plugin install
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** init delegates to the Copilot adapter's `installPlugin()`
- **THEN** the adapter SHALL run the Copilot CLI plugin install command targeting `Codagent-AI/agent-validator`
- **AND** the Copilot CLI SHALL discover the plugin via the existing `.claude-plugin/plugin.json` manifest

#### Scenario: Copilot adapter manual install instructions
- **GIVEN** the Copilot adapter's `installPlugin()` has failed
- **WHEN** init prints manual installation instructions
- **THEN** the instructions SHALL include the `copilot plugin install Codagent-AI/agent-validator` command

### Requirement: Plugin manifest

The npm package SHALL include a `.claude-plugin/plugin.json` manifest so the package can be discovered as both a Claude Code plugin and a Copilot CLI plugin. No separate `.github/plugin/plugin.json` is needed since Copilot CLI checks the `.claude-plugin/` directory.

#### Scenario: Plugin manifest contents
- **GIVEN** the agent-validator npm package is built
- **WHEN** the package is published
- **THEN** `.claude-plugin/plugin.json` SHALL contain `name`, `version`, `description`, and `license` fields
- **AND** the `version` field SHALL match the version in `package.json`

#### Scenario: Copilot CLI discovers plugin via .claude-plugin/
- **GIVEN** a user runs `copilot plugin install Codagent-AI/agent-validator`
- **WHEN** the Copilot CLI fetches the repository
- **THEN** it SHALL discover `plugin.json` at `.claude-plugin/plugin.json`
- **AND** it SHALL use the default `skills/` directory for skill discovery


# copilot-plugin-install Specification

## Purpose
Add plugin detection and installation for the Copilot CLI to the init flow, following the established adapter plugin pattern.

## ADDED Requirements

### Requirement: Init installs Copilot plugin via CLI command

When `github-copilot` is selected as a development CLI during init, the init flow SHALL install the agent-validator plugin using the Copilot CLI's native plugin install mechanism, mirroring the Claude adapter's marketplace-based approach.

#### Scenario: Copilot selected triggers plugin installation
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **AND** the plugin is not already installed
- **THEN** init SHALL delegate to the adapter's `installPlugin()` method
- **AND** the adapter SHALL run the Copilot CLI plugin install command targeting `Codagent-AI/agent-validator`

#### Scenario: Plugin already installed skips install
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **AND** the adapter's `detectPlugin()` returns a scope
- **THEN** init SHALL inform the user the plugin is already installed and at which scope
- **AND** SHALL skip the install step

#### Scenario: Plugin installation failure
- **WHEN** the adapter's `installPlugin()` fails
- **THEN** init SHALL warn the user that plugin installation failed
- **AND** SHALL print the adapter's manual installation instructions
- **AND** SHALL continue with remaining init steps

### Requirement: Copilot plugin detection during init

The init flow SHALL detect `gh copilot` availability alongside other CLI adapters and use the adapter's plugin detection to determine existing installations.

#### Scenario: gh copilot detected as available
- **WHEN** init runs CLI detection
- **AND** `gh copilot -- --help` succeeds
- **THEN** `github-copilot` SHALL appear in the list of available adapters

#### Scenario: gh copilot not available
- **WHEN** init runs CLI detection
- **AND** `gh copilot -- --help` fails or `gh` is not installed
- **THEN** `github-copilot` SHALL NOT appear in the list of available adapters

#### Scenario: Scope prompt included when Copilot needs install
- **WHEN** at least one adapter (including `github-copilot`) needs plugin installation
- **THEN** the user SHALL be prompted for installation scope (user/project)
- **AND** the selected scope SHALL be passed to the Copilot adapter's `installPlugin()`

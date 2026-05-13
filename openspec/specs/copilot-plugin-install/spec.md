# copilot-plugin-install Specification

## Purpose
Add GitHub Copilot availability and plugin installation support to the init flow through the centralized agent-plugin installer.

## Requirements

### Requirement: Init delegates Copilot plugin installation to agent-plugin

When `github-copilot` is selected as a development CLI during init, the init flow SHALL include Copilot in the centralized `agent-plugin add Codagent-AI/agent-validator` invocation. The init command SHALL NOT call the Copilot adapter's `installPlugin()` method directly.

#### Scenario: Copilot selected triggers agent-plugin installation
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator`
- **AND** SHALL pass `--agent copilot`

#### Scenario: Plugin already installed is still delegated
- **WHEN** the user selects `github-copilot` as a development CLI during init
- **AND** adapter-specific detection would find an existing Copilot plugin
- **THEN** init SHALL still include `--agent copilot` in the agent-plugin invocation
- **AND** duplicate/upgrade handling SHALL be left to agent-plugin

#### Scenario: Copilot install failure
- **WHEN** the agent-plugin install command fails for a selection including Copilot
- **THEN** init SHALL surface the agent-plugin failure
- **AND** SHALL NOT run Copilot-specific manual install logic

### Requirement: Copilot CLI detection during init

The init flow SHALL detect `copilot` CLI availability alongside other CLI adapters so it can be offered as a development and review CLI.

#### Scenario: copilot detected as available
- **WHEN** init runs CLI detection
- **AND** `copilot --help` succeeds
- **THEN** `github-copilot` SHALL appear in the list of available adapters

#### Scenario: copilot not available
- **WHEN** init runs CLI detection
- **AND** `copilot --help` fails or `copilot` is not installed
- **THEN** `github-copilot` SHALL NOT appear in the list of available adapters

#### Scenario: Scope passed through agent-plugin flags
- **WHEN** at least one selected development agent includes `github-copilot`
- **AND** the user selects project scope
- **THEN** init SHALL pass `--project` to agent-plugin
- **AND** SHALL NOT pass scope directly to the Copilot adapter's `installPlugin()`

# cursor-plugin-install Specification

## Purpose
Cursor plugin installation during `agent-validate init`. Covers centralized agent-plugin delegation with user/project scope and removal of init-time Cursor-specific file-copy logic.
## Requirements
### Requirement: Cursor installation uses agent-plugin

The `init` command SHALL install the agent-validator Cursor integration by delegating to `agent-plugin add Codagent-AI/agent-validator` with `--agent cursor`. Init SHALL NOT copy Cursor plugin files directly or call the Cursor adapter's `installPlugin()` method directly.

#### Scenario: User selects user scope
- **GIVEN** the user runs `agent-validate init` with Cursor selected
- **WHEN** the user selects global installation
- **THEN** init SHALL invoke agent-plugin with `--agent cursor`
- **AND** SHALL NOT pass `--project`

#### Scenario: User selects project scope
- **GIVEN** the user runs `agent-validate init` with Cursor selected
- **WHEN** the user selects local/project installation
- **THEN** init SHALL invoke agent-plugin with `--agent cursor`
- **AND** SHALL pass `--project`

### Requirement: Already-installed handling belongs to agent-plugin

Init SHALL pass selected Cursor installations to agent-plugin even if adapter-specific detection would find an existing Cursor plugin. Duplicate detection, upgrade behavior, and no-op decisions SHALL be owned by agent-plugin.

#### Scenario: Plugin already installed
- **GIVEN** the user runs `agent-validate init` with Cursor selected
- **WHEN** adapter-specific detection would find the plugin at either scope
- **THEN** init SHALL still include `--agent cursor` in the agent-plugin invocation
- **AND** SHALL NOT skip Cursor before invoking agent-plugin

### Requirement: Installation failure handling

When agent-plugin installation fails for a selection including Cursor, init SHALL surface the centralized agent-plugin failure rather than printing Cursor-specific manual file-copy instructions.

#### Scenario: Plugin install fails
- **GIVEN** the user runs `agent-validate init` with Cursor selected
- **WHEN** agent-plugin installation fails
- **THEN** init SHALL report that plugin installation failed
- **AND** SHALL NOT print Cursor adapter manual install instructions from init

### Requirement: Marketplace instructions stay outside init

Cursor marketplace or direct file-copy guidance MAY remain in adapter documentation and update fallback paths, but init-time installation SHALL rely on agent-plugin output.

#### Scenario: agent-plugin owns install guidance
- **GIVEN** the user runs `agent-validate init` with Cursor selected
- **WHEN** agent-plugin reports an install plan or failure
- **THEN** init SHALL display the agent-plugin result
- **AND** SHALL NOT add Cursor marketplace instructions itself

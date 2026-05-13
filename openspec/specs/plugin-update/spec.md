# plugin-update Specification

## Purpose
Plugin update logic for `agent-validate update`. Covers installed-location detection, direct refresh for legacy Claude/Cursor installations, and centralized agent-plugin update delegation for installed agents.
## Requirements
### Requirement: Plugin location detection

The `update` command SHALL detect installed agent-validator integrations before updating. It SHALL detect Claude installation scope with `claude plugin list --json`, detect Cursor installations through the Cursor adapter, and detect Codex by looking for installed validator skill markers.

#### Scenario: Claude plugin installed locally only
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the Claude plugin is installed at project scope for the current project
- **THEN** update SHALL target the project-scope Claude installation

#### Scenario: Claude plugin installed globally only
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the Claude plugin is installed at user scope but not at project scope
- **THEN** update SHALL target the user-scope Claude installation

#### Scenario: Claude plugin installed at both scopes
- **GIVEN** the user runs `agent-validate update`
- **WHEN** the Claude plugin is installed at both project and user scope
- **THEN** update SHALL target the project-scope Claude installation only (closest scope wins)

#### Scenario: No integrations installed anywhere
- **GIVEN** the user runs `agent-validate update`
- **WHEN** no Claude plugin, no Cursor plugin, and no Codex validator skills are found
- **THEN** update SHALL exit with an error message telling the user to run `agent-validate init` first

### Requirement: Direct plugin update execution

The `update` command SHALL keep supporting direct updates for existing Claude and Cursor installations. Claude SHALL be updated with the Claude plugin commands. Cursor SHALL be updated with the Cursor adapter's `updatePlugin()` method.

#### Scenario: Claude update succeeds
- **GIVEN** the user runs `agent-validate update`
- **AND** a Claude plugin installation is detected
- **WHEN** Claude marketplace and plugin update commands succeed
- **THEN** update SHALL report success for the Claude plugin

#### Scenario: Claude update fails
- **GIVEN** the user runs `agent-validate update`
- **AND** a Claude plugin installation is detected
- **WHEN** the Claude marketplace or plugin update command fails
- **THEN** update SHALL fail with the Claude error and manual update instructions
- **AND** SHALL NOT report later update steps as successful

#### Scenario: No Claude plugin but Cursor plugin exists
- **GIVEN** the user runs `agent-validate update`
- **WHEN** no Claude plugin is installed
- **BUT** a Cursor plugin is installed
- **THEN** update SHALL skip Claude plugin update
- **AND** SHALL update the Cursor plugin
- **AND** SHALL NOT error about missing Claude plugin

#### Scenario: Cursor update fails
- **GIVEN** the user runs `agent-validate update`
- **AND** a Cursor plugin installation is detected
- **WHEN** the Cursor adapter update fails
- **THEN** update SHALL warn with Cursor manual update instructions
- **AND** SHALL continue with remaining update steps

### Requirement: Agent-plugin update delegation

After detecting installed integrations, `update` SHALL call `agent-plugin update Codagent-AI/agent-validator` for the agents represented by those integrations. It SHALL pass `--yes`, one `--agent` option for each detected target, and `--project` only when the selected update scope is project/local.

#### Scenario: Detected agents are delegated to agent-plugin
- **GIVEN** Claude, Cursor, and Codex integrations are detected
- **WHEN** update reaches the centralized update step
- **THEN** update SHALL invoke `agent-plugin update Codagent-AI/agent-validator`
- **AND** SHALL pass `--agent claude`, `--agent cursor`, and `--agent codex`
- **AND** SHALL pass `--yes`

#### Scenario: Codex validator skills trigger codex update target
- **GIVEN** `$HOME/.agents/skills/validator-run/SKILL.md` or `.agents/skills/validator-run/SKILL.md` exists
- **WHEN** the user runs `agent-validate update`
- **THEN** update SHALL include `--agent codex` in the agent-plugin update invocation
- **AND** SHALL NOT copy Codex skill files directly

#### Scenario: No Codex validator skills installed
- **GIVEN** neither local nor global Codex validator skill markers exist
- **WHEN** the user runs `agent-validate update`
- **THEN** update SHALL NOT include `--agent codex` solely because Codex is available

#### Scenario: Project scope update
- **GIVEN** a project-scope integration is selected as the update scope
- **WHEN** update invokes agent-plugin
- **THEN** update SHALL pass `--project`

#### Scenario: User scope update
- **GIVEN** only user-scope integrations are selected as the update scope
- **WHEN** update invokes agent-plugin
- **THEN** update SHALL NOT pass `--project`

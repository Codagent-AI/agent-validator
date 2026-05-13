# plugin-install Specification

## Purpose
Plugin and skill installation during `agent-validate init`. Covers centralized installation through the bundled `agent-plugin` dependency, dry-run confirmation, install scope handling, and plugin manifest requirements.

## Requirements

### Requirement: Centralized agent-plugin installation

The `init` command SHALL install selected development-agent plugins and skills by invoking the bundled `agent-plugin` CLI rather than running adapter-specific install or skill-copy logic directly. The command SHALL pass the canonical source `Codagent-AI/agent-validator`, one `--agent` option per selected development CLI, and `--project` only when the selected scope is project/local.

#### Scenario: Selected agents are passed through
- **GIVEN** the user runs `agent-validate init`
- **AND** selects `claude`, `codex`, and `cursor` as development CLIs
- **WHEN** Phase 5 runs
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator`
- **AND** SHALL include `--agent claude`, `--agent codex`, and `--agent cursor`

#### Scenario: Selected agents are passed from --agents
- **GIVEN** the user runs `agent-validate init --agents claude,codex`
- **AND** `claude` and `codex` are detected as available
- **WHEN** Phase 5 runs
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator`
- **AND** SHALL include `--agent claude` and `--agent codex`
- **AND** SHALL NOT include unselected detected agents

#### Scenario: GitHub Copilot name mapping
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** init invokes `agent-plugin`
- **THEN** init SHALL pass `--agent copilot` to match the agent-plugin agent name

#### Scenario: Project scope flag
- **GIVEN** the user selects local/project installation scope
- **WHEN** init invokes `agent-plugin`
- **THEN** init SHALL include `--project`

#### Scenario: User scope omits project flag
- **GIVEN** the user selects global/user installation scope
- **WHEN** init invokes `agent-plugin`
- **THEN** init SHALL NOT include `--project`

### Requirement: Dry-run before install

The `init` command SHALL preview the `agent-plugin` plan before applying it. It SHALL run `agent-plugin add ... --dry-run`, then ask the user to confirm, then run the same add command without `--dry-run` only when confirmed. With `--yes`, confirmation SHALL be accepted automatically and the real install SHALL include `--yes`.

#### Scenario: Dry-run precedes install
- **GIVEN** the user runs `agent-validate init`
- **WHEN** Phase 5 runs
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator ... --dry-run`
- **AND** SHALL prompt the user to proceed with plugin installation

#### Scenario: Confirmation accepted
- **GIVEN** the dry-run has completed
- **WHEN** the user confirms installation
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator ...` without `--dry-run`

#### Scenario: Confirmation declined
- **GIVEN** the dry-run has completed
- **WHEN** the user declines installation
- **THEN** init SHALL NOT invoke the real install
- **AND** if local AI reviews are enabled, init SHALL return to reviewer CLI selection
- **AND** `.validator/config.yml` SHALL only be written after a later plugin installation confirmation succeeds

#### Scenario: --yes auto-confirms
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 5 runs
- **THEN** init SHALL run the dry-run command
- **AND** SHALL run the real install command with `--yes`
- **AND** SHALL NOT prompt for confirmation

### Requirement: Agent-plugin dependency resolution

The package SHALL depend on `agent-plugin` as the npm alias `npm:@codagent-ai/agent-plugin`. The wrapper SHALL execute that package's `dist/index.js` with the current Node executable. For local development and tests, `AGENT_PLUGIN_BIN` MAY override the resolved binary path.

#### Scenario: Bundled dependency is used by default
- **GIVEN** `AGENT_PLUGIN_BIN` is not set
- **WHEN** init invokes `agent-plugin`
- **THEN** the wrapper SHALL resolve `agent-plugin/package.json`
- **AND** SHALL execute `<agent-plugin package root>/dist/index.js`

#### Scenario: Local override is used
- **GIVEN** `AGENT_PLUGIN_BIN` is set to a local script path
- **WHEN** init invokes `agent-plugin`
- **THEN** the wrapper SHALL execute the override path

### Requirement: Plugin manifest

The npm package SHALL include a `.claude-plugin/plugin.json` manifest so the package can be discovered as both a Claude Code plugin and a Copilot CLI plugin. No separate `.github/plugin/plugin.json` is needed since Copilot CLI checks the `.claude-plugin/` directory.

#### Scenario: Plugin manifest contents
- **GIVEN** the agent-validator npm package is built
- **WHEN** the package is published
- **THEN** `.claude-plugin/plugin.json` SHALL contain `name`, `version`, `description`, and `license` fields
- **AND** the `version` field SHALL match the version in `package.json`

#### Scenario: Copilot CLI discovers plugin via .claude-plugin/
- **GIVEN** agent-plugin installs agent-validator for GitHub Copilot
- **WHEN** the Copilot CLI fetches the repository
- **THEN** it SHALL discover `plugin.json` at `.claude-plugin/plugin.json`
- **AND** it SHALL use the default `skills/` directory for skill discovery

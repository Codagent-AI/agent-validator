## MODIFIED Requirements

### Requirement: Per-Adapter Configuration
The system MUST support optional per-adapter configuration under the `cli.adapters` section of the effective CLI config. The effective CLI config is the project `cli` block in `.validator/config.yml` when the project config has a `cli` key; otherwise it is the global `cli` block in `~/.config/agent-validator/config.yml`. The project `cli` block is optional. Settings are never merged between the two files. Each adapter entry is keyed by adapter name and the system MUST accept optional `allow_tool_use` (boolean, defaults to `true`), `thinking_budget` (one of `off`, `low`, `medium`, `high`), and `model` (string) when provided. When `thinking_budget` is not specified, the adapter MUST use its built-in default behavior (no thinking budget override is applied). When `model` is not specified, the adapter MUST NOT pass a `--model` flag to the CLI (preserving current default behavior). Unknown adapter names in the config are silently ignored at the schema level. When specified, these settings MUST be passed to the adapter's `execute()` method and applied to the CLI invocation.

#### Scenario: Adapter with tool use disabled
- **GIVEN** a `.validator/config.yml` with `cli.adapters.gemini.allow_tool_use: false`
- **WHEN** a review is executed using the Gemini adapter
- **THEN** the Gemini CLI MUST be invoked without the `--allowed-tools` argument

#### Scenario: Adapter with tool use enabled (default)
- **GIVEN** a `.validator/config.yml` with no `allow_tool_use` setting for Claude
- **WHEN** a review is executed using the Claude adapter
- **THEN** the Claude CLI MUST be invoked with the `--allowedTools` argument containing the default tool set

#### Scenario: Adapter with thinking budget configured
- **GIVEN** a `.validator/config.yml` with `cli.adapters.codex.thinking_budget: high`
- **WHEN** a review is executed using the Codex adapter
- **THEN** the Codex CLI MUST be invoked with `-c model_reasoning_effort="high"`

#### Scenario: Invalid thinking budget level rejected
- **GIVEN** a `.validator/config.yml` with `cli.adapters.claude.thinking_budget: extreme`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: Adapter with partial configuration
- **GIVEN** a `.validator/config.yml` with `cli.adapters.gemini.allow_tool_use: false` and no `thinking_budget` setting
- **WHEN** a review is executed using the Gemini adapter
- **THEN** tools MUST be disabled AND the thinking budget MUST use the adapter's built-in default

#### Scenario: No adapter config section
- **GIVEN** a `.validator/config.yml` with no `cli.adapters` section
- **WHEN** reviews are executed
- **THEN** all adapters MUST use their default hardcoded settings (tool use enabled, no thinking budget override, no model override)

#### Scenario: Adapter with model configured
- **GIVEN** a `.validator/config.yml` with `cli.adapters.cursor.model: codex`
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor adapter MUST resolve the model name and pass `--model <resolved-id>` to the CLI

#### Scenario: Adapter with model absent
- **GIVEN** a `.validator/config.yml` with no `model` setting for the Cursor adapter
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor CLI MUST be invoked without a `--model` flag

#### Scenario: Adapter settings inherited from global cli block
- **GIVEN** a `.validator/config.yml` with no `cli` key
- **AND** a `~/.config/agent-validator/config.yml` with `cli.default_preference: [codex]` and `cli.adapters.codex.thinking_budget: high`
- **WHEN** a review is executed using the Codex adapter
- **THEN** the Codex CLI MUST be invoked with `-c model_reasoning_effort="high"`

#### Scenario: Project adapter settings ignore global adapter settings
- **GIVEN** a `.validator/config.yml` with a `cli` block whose `adapters` section has no `gemini` entry
- **AND** a global `cli` block with `cli.adapters.gemini.allow_tool_use: false`
- **WHEN** a review is executed using the Gemini adapter
- **THEN** the Gemini adapter MUST use its default hardcoded settings (tool use enabled)

## ADDED Requirements

### Requirement: Validate command reports the effective CLI config source
`agent-validate validate` SHALL validate the effective CLI config, whether it came from the project or the global config. On success, its output SHALL name the file that supplied the effective CLI config and say whether that file is the project or the global config. When validation fails because of the CLI config, the error SHALL name the file that supplied the block. If no `cli` block exists anywhere, the error SHALL name both config paths. `validate` SHALL continue to ignore the reviewer override environment.

#### Scenario: Validate reports inherited global cli
- **GIVEN** a project config with no `cli` key
- **AND** a global config with a valid `cli` block
- **WHEN** `agent-validate validate` is invoked
- **THEN** it SHALL exit with status zero
- **AND** its output SHALL name `~/.config/agent-validator/config.yml` (as an absolute path) as the source of the CLI config and identify it as the global config

#### Scenario: Validate reports project cli
- **GIVEN** a project config with a valid `cli` block
- **AND** a global config with a different valid `cli` block
- **WHEN** `agent-validate validate` is invoked
- **THEN** its output SHALL name the project config path as the source of the CLI config

#### Scenario: Invalid tool in inherited global cli attributed to global file
- **GIVEN** a project config with no `cli` key
- **AND** a global `cli` block with `default_preference: [not-a-tool]`
- **WHEN** `agent-validate validate` is invoked
- **THEN** it SHALL exit with a nonzero status
- **AND** the error SHALL identify the global config path and the invalid tool name

#### Scenario: Validate with no cli anywhere
- **GIVEN** a project config with no `cli` key and no global `cli` block
- **WHEN** `agent-validate validate` is invoked
- **THEN** it SHALL exit with a nonzero status naming both the project and global config paths

### Requirement: Health reports configuration errors with a failing exit status
`agent-validate health` SHALL validate configuration against the effective CLI config. When the global config file exists, health SHALL list it among the files checked. It SHALL attribute each CLI config issue to the file that supplied the effective `cli` block. It SHALL check each review's `cli_preference` against the effective `default_preference`.

When no project config exists, `health` SHALL keep its current behavior: report that no config was found, check all supported agents, and exit with status zero. The exception is a global config that exists but is invalid; then `health` SHALL exit nonzero.

In every other case, `health` SHALL print the error and exit with a nonzero status if configuration loading fails or configuration validation reports an error-severity issue. It SHALL NOT fall back to checking all supported agents in these cases. This covers a malformed global config, no effective `cli` block, an invalid project config, and an invalid review config. Adapter availability results for configured agents MAY still be printed when configuration loads successfully, but the exit status SHALL reflect any configuration error.

#### Scenario: Health fails on malformed global config
- **GIVEN** a valid project config
- **AND** a global config file that contains invalid YAML
- **WHEN** `agent-validate health` is invoked
- **THEN** the output SHALL report the global config path and the parse error
- **AND** the command SHALL exit with a nonzero status
- **AND** it SHALL NOT report the all-agents fallback check as its result

#### Scenario: Health fails when no effective cli exists
- **GIVEN** a project config with no `cli` key
- **AND** no global `cli` block
- **WHEN** `agent-validate health` is invoked
- **THEN** the output SHALL name both config paths
- **AND** the command SHALL exit with a nonzero status

#### Scenario: Health checks agents from inherited global cli
- **GIVEN** a project config with no `cli` key and reviews without `cli_preference`
- **AND** a global `cli` block with `default_preference: [codex]`
- **WHEN** `agent-validate health` is invoked
- **THEN** it SHALL list the global config among the files checked
- **AND** it SHALL report Codex availability
- **AND** it SHALL exit with status zero when there are no configuration errors

#### Scenario: Health without a project config keeps the fallback
- **GIVEN** no project config exists
- **AND** no global config file exists
- **WHEN** `agent-validate health` is invoked
- **THEN** it SHALL report that no config was found, check all supported agents, and exit with status zero

#### Scenario: Health fails on invalid project config
- **GIVEN** a project config that is not valid YAML
- **WHEN** `agent-validate health` is invoked
- **THEN** the command SHALL report the project config error
- **AND** it SHALL exit with a nonzero status

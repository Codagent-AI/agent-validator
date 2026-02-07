## ADDED Requirements

### Requirement: Per-Adapter Configuration
The system MUST support optional per-adapter configuration under the `cli.adapters` section of `.gauntlet/config.yml`. Each adapter entry is keyed by adapter name and MAY include `allow_tool_use` (boolean, defaults to `true`) and `thinking_budget` (one of `off`, `low`, `medium`, `high`). When `thinking_budget` is not specified, the adapter MUST use its built-in default behavior (no thinking budget override is applied). Unknown adapter names in the config are silently ignored at the schema level. When specified, these settings MUST be passed to the adapter's `execute()` method and applied to the CLI invocation.

#### Scenario: Adapter with tool use disabled
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.gemini.allow_tool_use: false`
- **WHEN** a review is executed using the Gemini adapter
- **THEN** the Gemini CLI MUST be invoked without the `--allowed-tools` argument

#### Scenario: Adapter with tool use enabled (default)
- **GIVEN** a `.gauntlet/config.yml` with no `allow_tool_use` setting for Claude
- **WHEN** a review is executed using the Claude adapter
- **THEN** the Claude CLI MUST be invoked with the `--allowedTools` argument containing the default tool set

#### Scenario: Adapter with thinking budget configured
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.codex.thinking_budget: high`
- **WHEN** a review is executed using the Codex adapter
- **THEN** the Codex CLI MUST be invoked with `-c model_reasoning_effort="high"`

#### Scenario: Invalid thinking budget level rejected
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.claude.thinking_budget: extreme`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: Adapter with partial configuration
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.gemini.allow_tool_use: false` and no `thinking_budget` setting
- **WHEN** a review is executed using the Gemini adapter
- **THEN** tools MUST be disabled AND the thinking budget MUST use the adapter's built-in default

#### Scenario: No adapter config section
- **GIVEN** a `.gauntlet/config.yml` with no `cli.adapters` section
- **WHEN** reviews are executed
- **THEN** all adapters MUST use their default hardcoded settings (tool use enabled, no thinking budget override)

### Requirement: Adapter Thinking Budget Level Mapping
The system MUST map the unified `thinking_budget` level string to adapter-specific values. The mapping MUST be:

- **Claude**: `off`=0, `low`=8000, `medium`=16000, `high`=31999 (set via `MAX_THINKING_TOKENS` environment variable)
- **Codex**: `off`=`"minimal"`, `low`=`"low"`, `medium`=`"medium"`, `high`=`"high"` (set via `-c model_reasoning_effort` CLI flag)
- **Gemini**: `off`=0, `low`=4096, `medium`=8192, `high`=24576 (set via `thinkingConfig.thinkingBudget` in `.gemini/settings.json`)

#### Scenario: Claude thinking budget applied via environment variable
- **GIVEN** a review configured with `thinking_budget: medium` for Claude
- **WHEN** the Claude CLI is invoked
- **THEN** the environment variable `MAX_THINKING_TOKENS` MUST be set to `16000`

#### Scenario: Codex thinking budget applied via CLI flag
- **GIVEN** a review configured with `thinking_budget: high` for Codex
- **WHEN** the Codex CLI is invoked
- **THEN** the CLI args MUST include `-c model_reasoning_effort="high"`

#### Scenario: Gemini thinking budget applied via settings file
- **GIVEN** a review configured with `thinking_budget: low` for Gemini
- **WHEN** the Gemini CLI is invoked
- **THEN** a `.gemini/settings.json` file MUST be written with `thinkingConfig.thinkingBudget` set to `4096`
- **AND** if the `.gemini/` directory does not exist, it MUST be created
- **AND** the original settings file (if any) MUST be restored after execution completes
- **AND** if no `.gemini/settings.json` existed before execution, the file MUST be removed after execution completes

#### Scenario: Gemini settings file cleanup on error
- **GIVEN** a review configured with `thinking_budget: low` for Gemini
- **WHEN** the Gemini CLI invocation fails or times out
- **THEN** the original `.gemini/settings.json` MUST still be restored

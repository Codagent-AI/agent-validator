## MODIFIED Requirements

### Requirement: Per-Adapter Configuration
The system MUST support optional per-adapter configuration under the `cli.adapters` section of `.gauntlet/config.yml`. Each adapter entry is keyed by adapter name and the system MUST accept optional `allow_tool_use` (boolean, defaults to `true`), `thinking_budget` (one of `off`, `low`, `medium`, `high`), and `model` (string) when provided. When `thinking_budget` is not specified, the adapter MUST use its built-in default behavior (no thinking budget override is applied). When `model` is not specified, the adapter MUST NOT pass a `--model` flag to the CLI (preserving current default behavior). Unknown adapter names in the config are silently ignored at the schema level. When specified, these settings MUST be passed to the adapter's `execute()` method and applied to the CLI invocation.

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
- **THEN** all adapters MUST use their default hardcoded settings (tool use enabled, no thinking budget override, no model override)

#### Scenario: Adapter with model configured
- **GIVEN** a `.gauntlet/config.yml` with `cli.adapters.cursor.model: codex`
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor adapter MUST resolve the model name and pass `--model <resolved-id>` to the CLI

#### Scenario: Adapter with model absent
- **GIVEN** a `.gauntlet/config.yml` with no `model` setting for the Cursor adapter
- **WHEN** a review is executed using the Cursor adapter
- **THEN** the Cursor CLI MUST be invoked without a `--model` flag

## ADDED Requirements

### Requirement: Adapter Model Resolution
When an adapter has a `model` configured, the adapter MUST resolve the base model name to a specific model ID at runtime by querying the CLI for available models, filtering to matches, and selecting the highest-versioned result. The resolution logic MUST:

1. Query the CLI for available models (Cursor: `agent --list-models`; GitHub Copilot: parse `copilot --help` output for `--model` choices).
2. Filter to models whose ID contains the configured base name as a complete hyphen-delimited segment (e.g. `codex` matches `gpt-5.3-codex` and `gpt-5.3-codex-low` because `codex` is a complete segment, but does NOT match `gpt-5.3-codecx` because `codecx` is a different segment). The base name MUST appear as a whole token between hyphens (or at the start/end of the ID), not as an arbitrary substring.
3. Exclude quality-tier variants (model IDs ending in `-low`, `-high`, `-xhigh`, or `-fast`).
4. If `thinking_budget` is set and not `off`, prefer models with a `-thinking` suffix when available (Cursor only; GitHub Copilot has no thinking variants). When thinking is preferred but no `-thinking` variant exists for the matched models, the adapter MUST fall back to the non-thinking variant.
5. Sort remaining candidates by version descending and select the highest. The version SHALL be extracted as the first occurrence of a `MAJOR.MINOR` pattern (regex `(\d+)\.(\d+)`) in the model ID. If no `MAJOR.MINOR` pattern is found, the model is sorted after all versioned models. Versions SHALL be compared numerically (major first, then minor). When two candidates have the same version, the first one encountered in the input list is selected.
6. On failure (CLI query fails, no matches found), log a warning and proceed without a `--model` flag.

#### Scenario: Cursor resolves highest-versioned codex model
- **GIVEN** `cli.adapters.cursor.model: codex` and `cli.adapters.cursor.thinking_budget: low`
- **AND** `agent --list-models` returns models including `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codex-high`, `gpt-5.2-codex`
- **WHEN** the Cursor adapter resolves the model
- **THEN** tier variants (`gpt-5.3-codex-low`, `gpt-5.3-codex-high`) MUST be excluded
- **AND** `gpt-5.3-codex` MUST be selected as the highest version
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Cursor resolves thinking variant when thinking_budget is active
- **GIVEN** `cli.adapters.cursor.model: opus` and `cli.adapters.cursor.thinking_budget: high`
- **AND** `agent --list-models` returns `opus-4.6`, `opus-4.6-thinking`, `opus-4.5`, `opus-4.5-thinking`
- **WHEN** the Cursor adapter resolves the model
- **THEN** thinking variants MUST be preferred because `thinking_budget` is not `off`
- **AND** `opus-4.6-thinking` MUST be selected as the highest-versioned thinking variant
- **AND** the CLI MUST be invoked with `--model opus-4.6-thinking`

#### Scenario: Cursor falls back to non-thinking when thinking variant unavailable
- **GIVEN** `cli.adapters.cursor.model: codex` and `cli.adapters.cursor.thinking_budget: high`
- **AND** `agent --list-models` returns `gpt-5.3-codex` (no `-thinking` variant available)
- **WHEN** the Cursor adapter resolves the model
- **THEN** `gpt-5.3-codex` MUST be selected as the best available match
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Thinking variants excluded when thinking_budget is off
- **GIVEN** `cli.adapters.cursor.model: opus` and `cli.adapters.cursor.thinking_budget: off`
- **AND** `agent --list-models` returns `opus-4.6`, `opus-4.6-thinking`
- **WHEN** the Cursor adapter resolves the model
- **THEN** `opus-4.6` MUST be selected (non-thinking variant)
- **AND** `opus-4.6-thinking` MUST NOT be selected

#### Scenario: GitHub Copilot resolves model without thinking variants
- **GIVEN** `cli.adapters.github-copilot.model: codex`
- **AND** `copilot --help` lists `--model` choices including `gpt-5.3-codex` and `gpt-5.2-codex`
- **WHEN** the GitHub Copilot adapter resolves the model
- **THEN** `gpt-5.3-codex` MUST be selected as the highest version
- **AND** the CLI MUST be invoked with `--model gpt-5.3-codex`

#### Scenario: Base name matching uses segment boundaries
- **GIVEN** `cli.adapters.cursor.model: codex`
- **AND** `agent --list-models` returns `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codecx`
- **WHEN** the Cursor adapter filters by base name
- **THEN** `gpt-5.3-codex` MUST match (`codex` is a complete hyphen-delimited segment)
- **AND** `gpt-5.3-codex-low` MUST match (`codex` is a complete segment; tier exclusion handles it separately in step 3)
- **AND** `gpt-5.3-codecx` MUST NOT match (`codecx` is not the same segment as `codex`)

#### Scenario: Model resolution failure falls back gracefully
- **GIVEN** `cli.adapters.cursor.model: nonexistent`
- **AND** `agent --list-models` returns no models matching `nonexistent`
- **WHEN** the Cursor adapter resolves the model
- **THEN** a warning MUST be logged indicating no matching model was found
- **AND** the CLI MUST be invoked without a `--model` flag

#### Scenario: CLI query failure falls back gracefully
- **GIVEN** `cli.adapters.cursor.model: codex`
- **AND** `agent --list-models` fails (non-zero exit code or timeout)
- **WHEN** the Cursor adapter attempts to resolve the model
- **THEN** a warning MUST be logged indicating the model query failed
- **AND** the CLI MUST be invoked without a `--model` flag

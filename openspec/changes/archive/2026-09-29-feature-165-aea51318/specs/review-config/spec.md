## MODIFIED Requirements

### Requirement: Adapter Thinking Budget Level Mapping
The system MUST map the unified `thinking_budget` level string to adapter-specific values. The mapping MUST be:

- **Claude**: two settings are applied together.
  - The token budget is `off`=0, `low`=8000, `medium`=16000, `high`=31999, set through the `MAX_THINKING_TOKENS` environment variable.
  - The Claude Code effort level is `low`=`low`, `medium`=`medium`, `high`=`high`, set through the `CLAUDE_CODE_EFFORT_LEVEL` environment variable. `off` MUST NOT set an effort level.
- **Codex**: `off`=`"minimal"`, `low`=`"low"`, `medium`=`"medium"`, `high`=`"high"` (set via `-c model_reasoning_effort` CLI flag)
- **Gemini**: `off`=0, `low`=4096, `medium`=8192, `high`=24576 (set via `thinkingConfig.thinkingBudget` in `.gemini/settings.json`)

When `thinking_budget` is configured for Claude, the Claude effort level set by the adapter MUST take precedence over any `CLAUDE_CODE_EFFORT_LEVEL` inherited from the parent environment. When `thinking_budget` is not configured for Claude, the adapter MUST NOT set or change either the token budget or the effort level. Inherited values then pass through unchanged.

For Claude, `thinking_budget: off` only requests that thinking be disabled. Models that cannot disable thinking (for example, Sonnet 5.5 and Opus 5.5) still think. The system MUST NOT substitute a different effort level for `off`, and it MUST NOT claim to users that thinking was disabled. Effort levels are calibrated per model and per provider, so the same `thinking_budget` level on different adapters is a matching configuration, not an equal amount of reasoning.

#### Scenario: Claude thinking budget applied via environment variable
- **GIVEN** a review configured with `thinking_budget: medium` for Claude
- **WHEN** the Claude CLI is invoked
- **THEN** the environment variable `MAX_THINKING_TOKENS` MUST be set to `16000`

#### Scenario: Claude effort level applied for low, medium, and high
- **GIVEN** a review configured with `thinking_budget: low` for Claude
- **WHEN** the Claude CLI is invoked
- **THEN** the environment variable `CLAUDE_CODE_EFFORT_LEVEL` MUST be set to `low`
- **AND** the CLI args MUST NOT include an `--effort` flag
- **AND** the environment variable `MAX_THINKING_TOKENS` MUST be set to `8000`
- **AND** the same one-to-one effort mapping MUST apply for `medium` and `high`

#### Scenario: Claude off sets no effort level
- **GIVEN** a review configured with `thinking_budget: off` for Claude
- **WHEN** the Claude CLI is invoked
- **THEN** the environment variable `MAX_THINKING_TOKENS` MUST be set to `0`
- **AND** the adapter MUST NOT set a Claude Code effort level

#### Scenario: Claude with no thinking budget applies no override
- **GIVEN** a Claude adapter configuration with no `thinking_budget`
- **WHEN** the Claude CLI is invoked
- **THEN** the adapter MUST NOT set `MAX_THINKING_TOKENS` or a Claude Code effort level
- **AND** any `CLAUDE_CODE_EFFORT_LEVEL` or `MAX_THINKING_TOKENS` inherited from the parent environment MUST reach the Claude CLI unchanged

#### Scenario: Configured Claude effort overrides inherited effort
- **GIVEN** a review configured with `thinking_budget: low` for Claude
- **AND** the parent environment sets `CLAUDE_CODE_EFFORT_LEVEL=high`
- **WHEN** the Claude CLI is invoked
- **THEN** the effective Claude Code effort level for the invocation MUST be `low`

#### Scenario: Reviewer override effort reaches Claude
- **GIVEN** reviewer override mode is active with `AGENT_VALIDATOR_REVIEWER_CLI=claude` and `AGENT_VALIDATOR_REVIEWER_EFFORT=medium`
- **WHEN** a Claude review runs
- **THEN** the Claude Code effort level MUST be set to `medium`

#### Scenario: Claude CLI without effort support still runs
- **GIVEN** a review configured with `thinking_budget: low` for Claude
- **AND** the installed Claude Code version does not recognize an effort setting
- **WHEN** the Claude CLI is invoked
- **THEN** the review MUST still run and produce its normal result
- **AND** `MAX_THINKING_TOKENS` MUST still be set to `8000`

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

## ADDED Requirements

### Requirement: Claude Launch-Resolved Effort Identity
For Claude reviews, the recorded requested identity MUST keep the configured `thinking_budget` value as its effort. It is `null` when none is configured. The recorded resolved identity, with `launch_resolution` provenance, MUST report as its effort the Claude Code effort level that the Claude CLI was launched with. That value is the mapped level when the adapter sets one. Otherwise it is the `CLAUDE_CODE_EFFORT_LEVEL` inherited from the parent environment, but only when the raw value, compared case-insensitively and without trimming, is exactly one of `low`, `medium`, `high`, `xhigh`, or `max`. It is then reported in canonical lowercase form. In every other case it MUST be `null`. That includes an absent or empty variable, `auto`, `unset`, a value with surrounding whitespace, an alias, a numeric value, and any other string. The inherited value MUST reach the Claude CLI unchanged. The recorded resolved effort and the child's environment MUST come from the same snapshot of the parent environment. The system MUST NOT report the Claude token budget or the `off` level as a resolved effort. It MUST NOT record any Claude effort as telemetry-observed identity unless Claude Code itself reports the applied effort. This holds because model support and managed effort caps (such as `maxEffortLevel`) can make the applied effort differ from the launched effort.

#### Scenario: Mapped effort recorded as launch-resolved
- **WHEN** a Claude review runs with `thinking_budget: high`
- **THEN** the requested identity effort MUST be `high`
- **AND** the resolved identity effort MUST be `high` with `launch_resolution` provenance
- **AND** no observed identity MUST carry an effort value derived from the configuration

#### Scenario: Off records no resolved effort
- **WHEN** a Claude review runs with `thinking_budget: off` and no inherited `CLAUDE_CODE_EFFORT_LEVEL`
- **THEN** the requested identity effort MUST be `off`
- **AND** the resolved identity effort MUST be `null`

#### Scenario: Inherited effort recorded when no budget is configured
- **WHEN** a Claude review runs with no `thinking_budget` configured and the parent environment sets `CLAUDE_CODE_EFFORT_LEVEL=medium`
- **THEN** the requested identity effort MUST be `null`
- **AND** the resolved identity effort MUST be `medium` with `launch_resolution` provenance

#### Scenario: Unrecognized inherited effort is not reported
- **WHEN** a Claude review runs with no `thinking_budget` configured and the parent environment sets `CLAUDE_CODE_EFFORT_LEVEL=auto`
- **THEN** the resolved identity effort MUST be `null`

#### Scenario: Noncanonical inherited effort is not reported
- **WHEN** a Claude review runs with no `thinking_budget` configured and the parent environment sets `CLAUDE_CODE_EFFORT_LEVEL` to ` medium ` (with surrounding spaces) or `med`
- **THEN** the resolved identity effort MUST be `null`
- **AND** the Claude CLI MUST receive the inherited value unchanged

#### Scenario: Case-insensitive canonical inherited effort
- **WHEN** a Claude review runs with no `thinking_budget` configured and the parent environment sets `CLAUDE_CODE_EFFORT_LEVEL=MEDIUM`
- **THEN** the resolved identity effort MUST be `medium`

#### Scenario: Resolved effort retained when execution fails
- **WHEN** a Claude review configured with `thinking_budget: low` fails or times out before telemetry is collected
- **THEN** the attempt's resolved identity effort MUST still be `low` with `launch_resolution` provenance

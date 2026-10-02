## MODIFIED Requirements

### Requirement: Preference replacement and adapter policy
When overlaying for an overlay command, Validator SHALL apply the overlay to the effective CLI config: the project `cli` block when the project config has a `cli` key, otherwise the global `cli` block from `~/.config/agent-validator/config.yml`. The effective block SHALL be resolved before the overlay. Per-field precedence follows the global-config "CLI settings precedence" requirement. The override's adapter replaces every preference. The override's model and mapped thinking budget are written into the mapped adapter's block, so they take precedence over both the effective adapter block's model and any per-review `model`. The override SHALL NOT remove the requirement for an effective `cli` block: when neither file provides one, overlay commands SHALL fail with the missing-CLI-config error even with override mode active. Validator SHALL replace `cli.default_preference` and every review `cli_preference` with the single mapped adapter before the check that a review CLI must appear in `default_preference`. Gates, checks, review enablement, and `num_reviews` SHALL remain as configured. A list-valued reviewer role is out of scope; `num_reviews` greater than one SHALL produce that many slots of the one mapped adapter.

Per-adapter `allow_tool_use` SHALL NOT be copied from the adapter being replaced. If `cli.adapters.<mapped>` already exists in the effective CLI config, Validator SHALL keep that block's `allow_tool_use` and apply the role's model and mapped thinking budget on top. If that block does not exist, Validator SHALL create it from Validator init defaults for that adapter (`allow_tool_use: false` plus the adapter's documented init `thinking_budget` and `model` where present), then apply the role's model and mapped thinking budget. When the role supplies a model, that overlay adapter model SHALL take precedence over a per-review YAML `model`. After overlay, existing adapter availability and health skipping SHALL apply; the overlay SHALL NOT add a separate fail-if-uninstalled rule.

#### Scenario: Review pinned to another CLI is replaced
- **WHEN** a review is configured with `cli_preference: [codex]` and override mode maps to `claude`
- **THEN** that review SHALL run with `claude`
- **AND** configuration loading SHALL NOT fail because `codex` is outside the replaced default preference list

#### Scenario: num_reviews remains a count of the one agent
- **WHEN** a review is configured with `num_reviews: 2` and override mode maps to a single adapter
- **THEN** Validator SHALL generate two review slots of that mapped adapter
- **AND** it SHALL NOT restore a multi-CLI panel

#### Scenario: Enablement is unchanged
- **WHEN** a review is configured with `enabled: false` and override mode is active
- **AND** the review is not named by `--enable-review`
- **THEN** that review SHALL NOT generate jobs

#### Scenario: Existing mapped adapter keeps allow_tool_use
- **WHEN** `cli.adapters.claude.allow_tool_use` is `false` and override mode maps to `claude`
- **THEN** Claude reviews SHALL keep `allow_tool_use` false
- **AND** they SHALL NOT inherit tool policy from a displaced adapter

#### Scenario: Missing mapped adapter uses init defaults
- **WHEN** override mode maps to `claude` and `cli.adapters.claude` does not exist
- **AND** the project had configured a different adapter with its own `allow_tool_use`
- **THEN** Validator SHALL create the Claude adapter block from init defaults
- **AND** Claude SHALL NOT copy `allow_tool_use` from the displaced adapter

#### Scenario: Override applies on top of inherited global cli
- **GIVEN** a project config with no `cli` key
- **AND** a global `cli` block with `default_preference: [codex]` and `adapters.claude.allow_tool_use: true`
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI=claude`
- **THEN** reviews SHALL run with `claude`
- **AND** Claude reviews SHALL keep `allow_tool_use` true from the global `adapters.claude` block
- **AND** neither the project config nor the global config file SHALL be rewritten

#### Scenario: Global adapter block ignored when project cli present
- **GIVEN** a project `cli` block with `default_preference: [codex]` and no `adapters.claude` entry
- **AND** a global `cli` block with `adapters.claude.allow_tool_use: true`
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI=claude`
- **THEN** Validator SHALL create the Claude adapter block from init defaults (`allow_tool_use: false`)
- **AND** it SHALL NOT use the global `adapters.claude` block

#### Scenario: Override does not satisfy a missing cli block
- **GIVEN** a project config with no `cli` key and no global `cli` block
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI=claude`
- **THEN** the command SHALL fail before any gates with the error naming both config paths

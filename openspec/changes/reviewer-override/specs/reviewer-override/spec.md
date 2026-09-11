## ADDED Requirements

### Requirement: Environment-inherited reviewer override
Validator SHALL read inherited environment variables `AGENT_VALIDATOR_REVIEWER_CLI`, `AGENT_VALIDATOR_REVIEWER_MODEL`, and `AGENT_VALIDATOR_REVIEWER_EFFORT`. Values SHALL be trimmed of surrounding whitespace; a value that is empty after trimming SHALL be treated as absent.

Presence of any of the three variables SHALL activate override mode. Once override mode is active, `AGENT_VALIDATOR_REVIEWER_CLI` MUST be present, non-empty after trim, and a mapped adapter; otherwise the overlay command SHALL fail before any gates run and SHALL NOT fall back to the project's configured reviewers. Absent model or effort SHALL NOT overlay those fields. Unknown CLI or effort SHALL fail the same way as a missing CLI.

Override mode SHALL apply only to overlay commands: `run`, `review`, `health`, `list`, and `detect`. `check`, `validate`, `clean`, `skip`, `update-review`, metrics operations, and CI job listing SHALL ignore these variables and use the tracked project configuration. Validator SHALL NOT write `.validator/config.yml` because of the override.

#### Scenario: No override environment
- **WHEN** none of the three reviewer environment variables is set
- **THEN** overlay commands SHALL use the project's loaded review configuration
- **AND** report output SHALL NOT add a reviewer-override identity line

#### Scenario: CLI-only override
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI` set to a mapped adapter and model and effort absent
- **THEN** the command SHALL activate override mode and overlay that adapter
- **AND** it SHALL NOT overlay model or thinking budget from the role

#### Scenario: Partial environment without CLI
- **WHEN** an overlay command is invoked with `AGENT_VALIDATOR_REVIEWER_MODEL` or `AGENT_VALIDATOR_REVIEWER_EFFORT` set and CLI absent
- **THEN** the command SHALL fail before any gates
- **AND** it SHALL NOT dispatch checks or reviews using the project reviewers

#### Scenario: Unknown CLI
- **WHEN** an overlay command is invoked with `AGENT_VALIDATOR_REVIEWER_CLI` set to a value that is not a mapped adapter
- **THEN** the command SHALL fail before any gates

#### Scenario: Unknown effort
- **WHEN** an overlay command is invoked with a valid mapped CLI and `AGENT_VALIDATOR_REVIEWER_EFFORT` set to a value other than `low`, `medium`, `high`, or `xhigh`
- **THEN** the command SHALL fail before any gates

#### Scenario: Check ignores override environment
- **WHEN** `check` is invoked with reviewer environment variables set, including a malformed override
- **THEN** the command SHALL ignore those variables
- **AND** it SHALL run checks from the tracked project configuration

#### Scenario: Validate ignores override environment
- **WHEN** `validate` is invoked with a malformed reviewer override environment
- **THEN** the command SHALL ignore those variables
- **AND** it SHALL validate the tracked configuration file rather than fail because of the environment

#### Scenario: Overlay commands fail closed on malformed env
- **WHEN** `health`, `list`, or `detect` is invoked with override mode activated and CLI missing or unmapped
- **THEN** the command SHALL fail immediately
- **AND** it SHALL NOT report project reviewers as the effective overlay

#### Scenario: Tracked config is not rewritten
- **WHEN** `run` completes successfully under an active reviewer override
- **THEN** the project's tracked `.validator/config.yml` SHALL be unchanged

### Requirement: Reviewer triple translation
When override mode is active, Validator SHALL translate the Runner triple into Validator adapter vocabulary. Mapped CLI values SHALL be `claude`, `codex`, `cursor`, and `opencode` (same adapter key) and `copilot` (adapter key `github-copilot`). Any other CLI SHALL be unmapped. Model SHALL be applied unchanged when present. Effort `low`, `medium`, and `high` SHALL map to the same `thinking_budget` string. Effort `xhigh` SHALL map to `thinking_budget` `high` and the collapse SHALL be reported on overlay-command output. Effort SHALL NOT express `thinking_budget: off`. CLI comparison SHALL be exact after trim; `Copilot` is not `copilot`.

#### Scenario: Copilot maps to github-copilot
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_CLI=copilot`
- **THEN** the mapped adapter SHALL be `github-copilot`

#### Scenario: xhigh collapses to high
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_EFFORT=xhigh`
- **THEN** the overlaid thinking budget SHALL be `high`
- **AND** overlay-command output SHALL name that collapse

#### Scenario: Medium effort passes through
- **WHEN** override mode is active with `AGENT_VALIDATOR_REVIEWER_EFFORT=medium`
- **THEN** the overlaid thinking budget SHALL be `medium`

### Requirement: Preference replacement and adapter policy
When overlaying for an overlay command, Validator SHALL replace `cli.default_preference` and every review `cli_preference` with the single mapped adapter before the check that a review CLI must appear in `default_preference`. Gates, checks, review enablement, and `num_reviews` SHALL remain as configured. A list-valued reviewer role is out of scope; `num_reviews` greater than one SHALL produce that many slots of the one mapped adapter.

Per-adapter `allow_tool_use` SHALL NOT be copied from the adapter being replaced. If `cli.adapters.<mapped>` already exists, Validator SHALL keep that block's `allow_tool_use` and apply the role's model and mapped thinking budget on top. If that block does not exist, Validator SHALL create it from Validator init defaults for that adapter (`allow_tool_use: false` plus the adapter's documented init `thinking_budget` and `model` where present), then apply the role's model and mapped thinking budget. When the role supplies a model, that overlay adapter model SHALL take precedence over a per-review YAML `model`. After overlay, existing adapter availability and health skipping SHALL apply; the overlay SHALL NOT add a separate fail-if-uninstalled rule.

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

### Requirement: Overlay-command configured identity
When an overlay command runs with override mode active, its stderr RESULTS SUMMARY SHALL name the configured review identity: source `runner-reviewer-role`, the mapped adapter, and the `xhigh` → `high` collapse when that mapping occurred. That identity is the configured overlay, not telemetry-observed effective model identity. When override mode is not active, Validator SHALL NOT add a `project-config` identity line.

#### Scenario: Override run names configured identity
- **WHEN** `run` completes with override mode active mapped to `github-copilot`
- **THEN** stderr RESULTS SUMMARY SHALL name source `runner-reviewer-role` and adapter `github-copilot`

#### Scenario: No override leaves summary unchanged
- **WHEN** `run` completes with no reviewer override environment
- **THEN** stderr RESULTS SUMMARY SHALL NOT add a reviewer identity source line

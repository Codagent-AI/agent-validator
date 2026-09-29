# global-config Specification

## Purpose
TBD - created by archiving change feature-168-15449656. Update Purpose after archive.
## Requirements
### Requirement: Global config file loading
Validator SHALL read an optional user-level config file at `~/.config/agent-validator/config.yml`. Every command that loads project configuration, or that reads global settings such as `debug_log`, SHALL read this file. It SHALL read the file even when the project config supplies every setting the global file could provide.

When the file does not exist, Validator SHALL behave as if no global settings were configured, and SHALL NOT report an error or warning.

When the file exists but cannot be used, the command SHALL fail with a nonzero exit status before any gate runs, lock is taken, or state is written. The error SHALL name the global config path and the reason. It SHALL NOT fall back to default global settings. This applies when the file:
- cannot be read,
- is not valid YAML, or
- does not satisfy the global config schema.

A valid global config that contains only `debug_log` SHALL keep working unchanged.

`clean` SHALL read and validate the global config even when no project config exists and there are no logs to archive. Each command invocation SHALL read the global config file at most once. The CLI settings and the `debug_log` settings used by that invocation SHALL come from that single read, so an invalid file is detected before any lock or state write, and no invocation mixes settings from two versions of the file.

#### Scenario: No global config file
- **GIVEN** `~/.config/agent-validator/config.yml` does not exist
- **AND** the project config has a valid `cli` block
- **WHEN** `run` is invoked
- **THEN** the command SHALL proceed using the project configuration
- **AND** no warning about the global config SHALL be printed

#### Scenario: Malformed YAML in global config is a hard error
- **GIVEN** `~/.config/agent-validator/config.yml` exists and contains invalid YAML
- **WHEN** `run`, `check`, `review`, `skip`, `clean`, or `validate` is invoked
- **THEN** the command SHALL exit with a nonzero status
- **AND** the error output SHALL name `~/.config/agent-validator/config.yml` (as an absolute path) and the parse failure
- **AND** no gate SHALL run

#### Scenario: Clean in an uninitialized directory fails on malformed global config
- **GIVEN** no project config exists and no log directory exists
- **AND** a global config file that contains invalid YAML
- **WHEN** `clean` is invoked
- **THEN** the command SHALL exit with a nonzero status naming the global config path
- **AND** it SHALL NOT report that logs were archived successfully

#### Scenario: One global config snapshot per invocation
- **GIVEN** a valid global config with a `cli` block and `debug_log.enabled: true`
- **WHEN** `run` is invoked and the global file is replaced with invalid YAML after configuration loading has completed
- **THEN** the run SHALL continue using the settings from the initial read
- **AND** it SHALL NOT fail after taking the lock because of the later change

#### Scenario: Schema-invalid global config is a hard error
- **GIVEN** the global config contains `debug_log.enabled: "yes"` (not a boolean)
- **WHEN** `run` is invoked
- **THEN** the command SHALL exit with a nonzero status naming the global config path and the invalid field
- **AND** it SHALL NOT continue with default global settings

#### Scenario: Global config problem is reported even when the project supplies cli
- **GIVEN** the project config has a valid `cli` block
- **AND** the global config exists but is invalid YAML
- **WHEN** `run` is invoked
- **THEN** the command SHALL fail naming the global config path

#### Scenario: Existing debug_log-only global config keeps working
- **GIVEN** the global config contains only a valid `debug_log` block
- **AND** the project config has a valid `cli` block
- **WHEN** `run` is invoked
- **THEN** the command SHALL run normally
- **AND** the global `debug_log` setting SHALL apply exactly as before this change

### Requirement: Global CLI block
The global config SHALL accept an optional `cli` block with the same shape as the project `cli` block: `default_preference` and `adapters`, where each adapter supports `allow_tool_use`, `thinking_budget`, and `model`. The global `cli` block SHALL be subject to the same schema rules as the project `cli` block. The same semantic rules SHALL apply when it is the effective CLI config:
- `default_preference` is inferred from adapter keys when omitted;
- a non-empty preference is required;
- tool names must be valid adapters;
- review `cli_preference` must be within `default_preference`.

#### Scenario: Global cli block accepted
- **GIVEN** a global config containing:
  ```yaml
  cli:
    default_preference: [codex]
    adapters:
      codex:
        model: gpt-6-sol
        allow_tool_use: false
        thinking_budget: low
  ```
- **WHEN** Validator loads configuration for a project with no `cli` block
- **THEN** loading SHALL succeed
- **AND** reviews without their own `cli_preference` SHALL use `codex` with model `gpt-6-sol`, tool use disabled, and thinking budget `low`

#### Scenario: Global default_preference inferred from adapters
- **GIVEN** a global `cli` block with `adapters.claude` configured and no `default_preference`
- **AND** a project config with no `cli` block
- **WHEN** configuration is loaded
- **THEN** the effective `default_preference` SHALL be `[claude]`

#### Scenario: Invalid thinking budget in global cli rejected
- **GIVEN** a global config with `cli.adapters.codex.thinking_budget: extreme`
- **WHEN** any command that reads the global config is invoked
- **THEN** the command SHALL fail naming the global config path

### Requirement: Effective CLI config resolution
Validator SHALL resolve one effective CLI config per command invocation, using whole-block replacement:

- If the project config contains a `cli` key, the project `cli` block SHALL be the effective CLI config. The global `cli` block SHALL be ignored entirely, even if the project block omits `default_preference` or `adapters` that the global block defines.
- If the project config has no `cli` key and the global config has a `cli` block, the global block SHALL be the effective CLI config, used as-is.
- Validator SHALL NOT merge individual `cli` fields or adapter entries between the two files.

All CLI-dependent behavior SHALL use the effective CLI config: default review preference, review `cli_preference` checks, per-adapter settings, reviewer-override overlay, adapter health, and trust-record scope.

#### Scenario: Project without cli inherits global cli
- **GIVEN** a global `cli` block with `default_preference: [codex]`
- **AND** a project config with no `cli` key
- **WHEN** `run` executes a review that has no `cli_preference`
- **THEN** the review SHALL be dispatched to `codex`

#### Scenario: Project cli replaces global cli completely
- **GIVEN** a global `cli` block with `default_preference: [codex]` and `adapters.codex.model: gpt-6-sol`
- **AND** a project `cli` block with `default_preference: [claude]` and no `adapters`
- **WHEN** `run` executes a review that has no `cli_preference`
- **THEN** the review SHALL be dispatched to `claude`
- **AND** no setting from the global `cli` block SHALL apply

#### Scenario: No field-level merge of adapters
- **GIVEN** a global `cli` block with `adapters.codex.model: gpt-6-sol`
- **AND** a project `cli` block with `default_preference: [codex]` and `adapters.codex.thinking_budget: high` (no model)
- **WHEN** a Codex review executes
- **THEN** Codex SHALL be invoked with thinking budget `high`
- **AND** Codex SHALL be invoked without the global model `gpt-6-sol`

#### Scenario: Present but incomplete project cli is not filled from global
- **GIVEN** a global `cli` block with `default_preference: [codex]`
- **AND** a project config containing `cli: {}`
- **WHEN** configuration is loaded
- **THEN** loading SHALL fail with the same error as a project `cli` block that has no `default_preference` and no adapters
- **AND** the global `default_preference` SHALL NOT be used

#### Scenario: Changing the global cli changes the trust scope for inheriting projects
- **GIVEN** a project with no `cli` block inheriting a global `cli` block
- **AND** a trust record written while the global `default_preference` was `[codex]`
- **WHEN** the global `default_preference` changes to `[claude]` and a new trust record is written for the same tree
- **THEN** the new record's configuration scope SHALL differ from the earlier record's, as it would if the project's own `cli` block had changed

### Requirement: Effective CLI config is semantically validated at load
Every command that requires an effective CLI config SHALL fail with a nonzero exit status before any gate runs, lock is taken, or state is written, when the effective CLI config (after `default_preference` inference from adapter keys):
- has no non-empty `default_preference`, or
- names a tool in `default_preference` that is not a supported adapter.

This applies whether or not the project defines any reviews. The error SHALL name the file that supplied the effective `cli` block and the offending field. `validate`, `health`, and runtime loading SHALL apply the same rules, so a configuration is accepted by one exactly when it is accepted by the others. These checks run on the configured block, before any reviewer override is overlaid. CI job listing, which does not require an effective CLI config, SHALL NOT apply them.

#### Scenario: Empty project cli block rejected even without reviews
- **GIVEN** a project config with `cli: {}`, one check, and no reviews
- **AND** a global `cli` block with `default_preference: [codex]`
- **WHEN** `check` or `validate` is invoked
- **THEN** the command SHALL exit with a nonzero status naming the project config path and `cli.default_preference`

#### Scenario: Invalid tool in inherited global default_preference rejected at runtime
- **GIVEN** a project config with no `cli` key and no reviews
- **AND** a global `cli` block with `default_preference: [not-a-tool]`
- **WHEN** `run` is invoked
- **THEN** the command SHALL exit with a nonzero status naming the global config path and `not-a-tool`
- **AND** no gate SHALL run

#### Scenario: CI job listing ignores an invalid cli block
- **GIVEN** a project config with `cli: {}` and a valid `.validator/ci.yml`
- **WHEN** `agent-validate ci list-jobs` is invoked
- **THEN** it SHALL exit with status zero and print the check job matrix

### Requirement: Missing effective CLI config
When neither the project config nor the global config provides a `cli` block, every command that requires an effective CLI config SHALL fail with a nonzero exit status before any gate runs. The error SHALL name both the project config path and the global config path. It SHALL say that a `cli` block is needed in one of them. CI job listing is exempt (see "CI job listing without CLI config").

#### Scenario: No cli anywhere
- **GIVEN** a project config with no `cli` key
- **AND** no global config file exists
- **WHEN** `run` is invoked
- **THEN** the command SHALL exit with a nonzero status
- **AND** the error SHALL name the project config path (for example `.validator/config.yml`) and `~/.config/agent-validator/config.yml` (as an absolute path)

#### Scenario: Global config without cli
- **GIVEN** a project config with no `cli` key
- **AND** a global config containing only `debug_log`
- **WHEN** `validate` is invoked
- **THEN** the command SHALL exit with a nonzero status naming both config paths

#### Scenario: Legacy project config path is named
- **GIVEN** a project using legacy `.gauntlet/config.yml` with no `cli` key
- **AND** no global `cli` block
- **WHEN** `run` is invoked
- **THEN** the error SHALL name `.gauntlet/config.yml` as the project config path

### Requirement: CLI settings precedence
Validator SHALL resolve CLI and model settings per field. Precedence is highest first, and the project and global `cli` blocks are mutually exclusive whole blocks under effective CLI config resolution.

**Which CLI a review runs on:**
1. the reviewer environment override (overlay commands only), which replaces every preference with the mapped adapter;
2. the review's own `cli_preference`, which MUST be within the effective `default_preference`;
3. the effective `default_preference` (from the project `cli` block, else the global `cli` block).

A review whose `cli_preference` is not within the effective `default_preference` SHALL fail loading and validation exactly as it does against a project `cli` block.

**Which model an adapter is invoked with** (existing adapter-first behavior, unchanged by this change):
1. the reviewer environment override's model (overlay commands only; applied to the mapped adapter's block);
2. the effective `cli.adapters.<adapter>.model` (from the project `cli` block, else the global `cli` block);
3. the review's own `model`;
4. no model flag (the adapter's built-in default).

`allow_tool_use` and `thinking_budget` come only from the effective adapter block (after any reviewer overlay), else the adapter's built-in defaults. A project that keeps its `cli` block SHALL see no change in the model, tool-use, or thinking settings its reviews run with.

#### Scenario: Inherited global adapter model takes priority over review-level model
- **GIVEN** a global `cli` block with `default_preference: [codex]` and `adapters.codex.model: gpt-6-sol`
- **AND** a project with no `cli` block and a review with `model: gpt-5.3-codex`
- **WHEN** that review executes on Codex
- **THEN** Codex SHALL be invoked with model `gpt-6-sol`

#### Scenario: Review-level model used when the effective adapter block has no model
- **GIVEN** a global `cli` block with `default_preference: [codex]` and no `adapters.codex.model`
- **AND** a project with no `cli` block and a review with `model: gpt-5.3-codex`
- **WHEN** that review executes on Codex
- **THEN** Codex SHALL be invoked with model `gpt-5.3-codex`

#### Scenario: Reviewer override model beats the inherited adapter model and the review model
- **GIVEN** a global `cli` block with `default_preference: [codex]` and `adapters.codex.model: gpt-6-sol`
- **AND** a project with no `cli` block and a review with `model: gpt-5.3-codex`
- **WHEN** `run` is invoked with `AGENT_VALIDATOR_REVIEWER_CLI=codex` and `AGENT_VALIDATOR_REVIEWER_MODEL=gpt-7`
- **THEN** Codex SHALL be invoked with model `gpt-7`

#### Scenario: Review cli_preference outside inherited default_preference fails
- **GIVEN** a global `cli` block with `default_preference: [codex]`
- **AND** a project with no `cli` block and a review with `cli_preference: [github-copilot]`
- **WHEN** `run` is invoked
- **THEN** configuration loading SHALL fail, saying that `github-copilot` is not in the allowed `default_preference`

#### Scenario: Built-in defaults apply beneath global cli
- **GIVEN** a global `cli` block with `default_preference: [gemini]` and no `adapters`
- **AND** a project with no `cli` block
- **WHEN** a Gemini review executes
- **THEN** Gemini SHALL use its built-in defaults (tool use enabled, no thinking budget override, no model override)

### Requirement: CI job listing without CLI config
`agent-validate ci list-jobs` SHALL NOT require an effective CLI config. It only produces deterministic check jobs. When neither the project nor the global config provides a `cli` block, it SHALL succeed and emit the same job matrix it would emit with a `cli` block present. Every other failure mode SHALL still fail `ci list-jobs` with a nonzero exit status: an invalid project config, a malformed global config that exists, and an invalid entry-point reference.

#### Scenario: Clean CI runner with no cli anywhere
- **GIVEN** a project config with no `cli` key and a valid `.validator/ci.yml`
- **AND** no global config file exists
- **WHEN** `agent-validate ci list-jobs` is invoked
- **THEN** it SHALL exit with status zero
- **AND** it SHALL print the check job matrix for the configured CI checks

#### Scenario: Malformed global config still fails CI job listing
- **GIVEN** a global config file exists and contains invalid YAML
- **WHEN** `agent-validate ci list-jobs` is invoked
- **THEN** it SHALL exit with a nonzero status naming the global config path

#### Scenario: Project cli still honored by CI job listing
- **GIVEN** a project config with a valid `cli` block
- **WHEN** `agent-validate ci list-jobs` is invoked
- **THEN** its output SHALL be unchanged from the behavior before this change

### Requirement: Global config is never written by Validator
Validator SHALL NOT create, modify, or rewrite `~/.config/agent-validator/config.yml` during any command, including under a reviewer override.

#### Scenario: Run leaves global config untouched
- **GIVEN** a global config with a `cli` block
- **WHEN** `run` completes, with or without an active reviewer override
- **THEN** the global config file SHALL be byte-for-byte unchanged


# init-config Specification

## Purpose
Configuration generation during `agent-validate init`. Covers config file creation, review config setup, and post-init guidance.
## Requirements
### Requirement: Init generates YAML review config with built-in reference
When local AI reviews are enabled, the `init` command SHALL write review entries in `config.yml` based on the reviewer recommendation logic rather than individual built-in review selection. Each review entry SHALL include `builtin`, and when applicable, `cli_preference` and `model` fields matching the recommended configurations. The `init` command SHALL NOT create `.validator/reviews/` directory files, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

#### Scenario: Primary config writes two-pass hybrid review entries
- **WHEN** the primary review config is selected (GitHub Copilot available)
- **THEN** `config.yml` SHALL contain a `code-quality` entry with `builtin: code-quality`, `cli_preference: [github-copilot]`, and `model: claude-sonnet-4.6`
- **AND** `config.yml` SHALL contain a `security-and-errors` entry with `builtin: security-and-errors`, `cli_preference: [github-copilot]`, and `model: gpt-5.3-codex`
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Secondary config writes single combined review entry
- **WHEN** the secondary review config is selected (Codex only)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers` and `model: gpt-5.3-codex`
- **AND** no other review entries SHALL be present

#### Scenario: Fallback config writes combined review entry without overrides
- **WHEN** the fallback review config is selected (neither Copilot nor Codex)
- **THEN** `config.yml` SHALL contain an `all-reviewers` entry with `builtin: all-reviewers`
- **AND** no `model` or `cli_preference` SHALL be set on the review entry

#### Scenario: Init with --yes and Copilot detected writes primary config
- **WHEN** a user runs `agent-validate init --yes`
- **AND** `github-copilot` is detected as available
- **THEN** `config.yml` SHALL contain the primary config review entries (code-quality + security-and-errors with per-review overrides)

#### Scenario: Confirmed local AI review opt-out writes no review entries
- **WHEN** the user declines local AI reviews and confirms the opt-out
- **THEN** `config.yml` SHALL contain no `reviews` entry under the generated root entry point
- **AND** `config.yml` SHALL still contain `cli.default_preference` populated from the selected development CLIs so the config remains valid
- **AND** `.validator/reviews/` SHALL NOT be created

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print one agent-neutral instruction for all selected development CLIs. The message SHALL tell the user to run the `validator-setup` skill in their agent and SHALL NOT include Codex-specific file paths or a list of installed skill files.

#### Scenario: Generic setup instruction
- **GIVEN** the user selected any supported development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run the validator-setup skill in your agent. This will guide you through configuring the static checks (unit tests, linters, etc.) that Agent Validator will run."

#### Scenario: Codex-specific skill list is omitted
- **GIVEN** the user selected `codex` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL NOT include `Available Codex skills`
- **AND** the output SHALL NOT list `~/.agents/skills/<skill-name>/SKILL.md` paths

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)

### Requirement: Init config scaffold with root entry point

The `init` command SHALL generate a `config.yml` with a root entry point (`path: "."`) and `cli.default_preference` populated from review CLI selection when local AI reviews are enabled. If local AI reviews are disabled, `cli.default_preference` SHALL be populated from the selected development CLIs. Check configuration SHALL be delegated to the `validator-setup` skill.

#### Scenario: Config generated with root entry point
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/config.yml` exists
- **WHEN** `.validator/config.yml` is created
- **THEN** the config SHALL include an entry point with `path: "."`
- **AND** the config SHALL include `base_branch`, `log_dir`, and `cli` sections
- **AND** the config SHALL NOT include any check references in entry_points

#### Scenario: Init re-run preserves existing config
- **GIVEN** `.validator/config.yml` already exists
- **WHEN** the user runs `agent-validate init` (with or without `--yes`)
- **THEN** the existing `config.yml` SHALL be preserved entirely (not overwritten)

#### Scenario: Config with --yes flag
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** no `.validator/config.yml` exists
- **WHEN** `.validator/config.yml` is created
- **THEN** the config SHALL include an entry point with `path: "."`
- **AND** the `cli.default_preference` SHALL include all detected CLIs

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL present interactive prompts for development CLI selection, local AI review enablement, installation scope (local vs global), review CLI selection when local AI reviews are enabled, and `num_reviews` configuration when more than one reviewer CLI is selected. All other config values SHALL remain non-interactive with auto-detected defaults.

#### Scenario: Development CLI multi-select prompt
- **GIVEN** the user runs `agent-validate init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 2 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your development CLI(s). These are the main tools you work in."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Development CLI names supplied by flag
- **GIVEN** the user runs `agent-validate init --agents claude codex`
- **AND** `claude` and `codex` are detected as available
- **WHEN** Phase 2 begins
- **THEN** init SHALL use `claude` and `codex` as the selected development CLIs
- **AND** init SHALL NOT show the development CLI multi-select prompt
- **AND** init SHALL still ask whether to enable local AI reviews
- **AND** init SHALL show the reviewer CLI multi-select prompt if local AI reviews are enabled

#### Scenario: Comma-separated development CLI names supplied by flag
- **GIVEN** the user runs `agent-validate init --agents claude,codex`
- **AND** `claude` and `codex` are detected as available
- **WHEN** Phase 2 begins
- **THEN** init SHALL use `claude` and `codex` as the selected development CLIs

#### Scenario: Unknown development CLI name supplied by flag
- **GIVEN** the user runs `agent-validate init --agents missing-agent`
- **AND** `missing-agent` is not detected as available
- **WHEN** Phase 2 begins
- **THEN** init SHALL fail with an error naming the unknown or unavailable development agent
- **AND** init SHALL NOT install plugins or scaffold `.validator/config.yml`

#### Scenario: Installation scope prompt
- **GIVEN** the user runs `agent-validate init`
- **WHEN** the user has selected development CLIs in Phase 2
- **THEN** the user SHALL be prompted to choose installation scope: local (project) or global (user)

#### Scenario: Development CLI with hook support
- **GIVEN** the user selects `claude` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** `claude` SHALL be marked for plugin installation (hooks are now part of the plugin)

#### Scenario: Review CLI multi-select prompt
- **GIVEN** the user runs `agent-validate init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **AND** the user enables local AI reviews
- **WHEN** review configuration begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Local AI review opt-out skips reviewer prompts
- **GIVEN** the user runs `agent-validate init`
- **WHEN** the user declines local AI reviews and confirms the opt-out
- **THEN** init SHALL NOT show the review CLI multi-select prompt
- **AND** init SHALL NOT ask how many review CLIs should run on every review

#### Scenario: Claude review CLI shows programmatic billing disclosure
- **WHEN** the review CLI multi-select prompt is rendered
- **AND** `claude` is an available option
- **THEN** the `claude` option SHALL include a visible disclosure that programmatic use may be billed at API rates

#### Scenario: Review CLIs set default_preference
- **GIVEN** the user selects `claude` and `codex` as review CLIs
- **WHEN** the config is generated
- **THEN** `cli.default_preference` SHALL contain `["claude", "codex"]` (in the user's selection order)

#### Scenario: Single review CLI sets num_reviews automatically
- **GIVEN** the user selects exactly 1 review CLI
- **WHEN** Phase 3 completes
- **THEN** `num_reviews` SHALL be set to `1` in each review config entry
- **AND** no prompt for `num_reviews` SHALL be shown

#### Scenario: Multiple review CLIs prompt for num_reviews
- **GIVEN** the user selects 3 review CLIs
- **WHEN** Phase 3 completes
- **THEN** the user SHALL be prompted: "How many of these CLIs would you like to run on every review?"
- **AND** the valid range SHALL be 1 to 3
- **AND** the selected value SHALL be written as `num_reviews` in each review config entry

#### Scenario: Automatic review configuration selection
- **GIVEN** the user runs `agent-validate init`
- **AND** local AI reviews are enabled
- **WHEN** review CLI and num_reviews selection completes
- **THEN** review configuration SHALL be selected automatically by `selectReviewConfig()` based on detected reviewer CLIs
- **AND** if `github-copilot` is among the selected review CLIs, the primary config SHALL be used: two-pass hybrid with `code-quality` (Sonnet) and `security-and-errors` (GPT)
- **AND** if `codex` is among the selected review CLIs (without `github-copilot`), the secondary config SHALL be used: single `all-reviewers` pass (GPT)
- **AND** otherwise, the fallback config SHALL be used: `all-reviewers` with no model override
- **AND** the selected reviews SHALL be written as inline review definitions under the root entry point in `config.yml`

#### Scenario: No base branch prompt
- **GIVEN** the user runs `agent-validate init`
- **WHEN** the init command runs
- **THEN** base branch SHALL be auto-detected from the git remote (falling back to `origin/main` if detection fails)
- **AND** no prompt for base branch SHALL be shown

#### Scenario: No lint or test command prompts
- **GIVEN** the user runs `agent-validate init`
- **WHEN** the init command runs
- **THEN** no prompts for lint or test commands SHALL be shown
- **AND** no check YAML files SHALL be created by init

### Requirement: --yes flag skips all interactive prompts with defaults

When `--yes` is passed, `init` SHALL skip all interactive prompts and apply default selections.

#### Scenario: --yes selects all detected CLIs as development CLIs
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 2 runs
- **THEN** all detected CLIs SHALL be selected as development CLIs without prompting

#### Scenario: --yes defaults to global scope
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 2 runs
- **THEN** installation scope SHALL default to global (user) without prompting

#### Scenario: --yes enables local AI reviews and selects all detected CLIs as review CLIs
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 3 runs
- **THEN** local AI reviews SHALL be enabled without prompting
- **AND** all detected CLIs SHALL be added to `cli.default_preference`
- **AND** `num_reviews` SHALL be set to the number of detected CLIs

#### Scenario: --yes applies auto-selected review configuration
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 3 runs
- **THEN** the auto-selected review configuration SHALL be applied without prompting
- **AND** the review config SHALL be determined by `selectReviewConfig()` based on detected CLIs

#### Scenario: --yes auto-confirms plugin installation
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 5 runs
- **THEN** init SHALL run the agent-plugin dry-run without prompting
- **AND** init SHALL run the real agent-plugin install with `--yes`

### Requirement: Phase 4 scaffold skips when .validator/ exists

When `.validator/` already exists, Phase 4 SHALL skip entirely without modifying any files inside the directory.

#### Scenario: Fresh init creates .validator/ directory with selected reviews
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/` directory exists
- **AND** local AI reviews are enabled
- **WHEN** Phase 4 runs
- **THEN** `.validator/` SHALL be created with `config.yml` containing the root entry point and inline review entries chosen by reviewer recommendation logic
- **AND** the project-root `.gitignore` SHALL be updated to include `validator_logs`
- **AND** `.validator/reviews/` and `.validator/checks/` SHALL NOT be created

#### Scenario: Re-run skips .validator/ scaffolding
- **GIVEN** the user runs `agent-validate init`
- **AND** `.validator/` directory already exists
- **WHEN** Phase 4 runs
- **THEN** no files inside `.validator/` SHALL be created or modified
- **AND** init SHALL delegate to update logic (not run Phase 5 directly)

### Requirement: Init delegates development plugin installation to agent-plugin

When development CLIs are selected, init SHALL pass the selected agents to `agent-plugin add Codagent-AI/agent-validator` instead of running adapter-specific install methods or copying skill files directly.

#### Scenario: Selected agents are passed to agent-plugin
- **GIVEN** the user selects `claude`, `codex`, and `cursor` as development CLIs
- **AND** the user selects local scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator`
- **AND** SHALL pass `--agent claude`, `--agent codex`, and `--agent cursor`
- **AND** SHALL pass `--project`

#### Scenario: Global scope omits project flag
- **GIVEN** the user selects any development CLI
- **AND** the user selects global scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL invoke `agent-plugin add Codagent-AI/agent-validator`
- **AND** SHALL NOT pass `--project`

#### Scenario: Codex install is delegated
- **GIVEN** the user selects `codex` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** init SHALL pass `--agent codex` to agent-plugin
- **AND** init SHALL NOT copy files directly into `.agents/skills/` or `$HOME/.agents/skills/`

#### Scenario: GitHub Copilot agent name mapping
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** Phase 5 invokes agent-plugin
- **THEN** init SHALL pass `--agent copilot`

### Requirement: CodexAdapter reports project skill directory

`CodexAdapter.getProjectSkillDir()` SHALL return `.agents/skills` so the adapter system correctly reflects Codex's native skill location.

#### Scenario: CodexAdapter returns .agents/skills for project skill dir
- **GIVEN** a `CodexAdapter` instance exists
- **WHEN** `getProjectSkillDir()` is called
- **THEN** it SHALL return `.agents/skills`

### Requirement: Re-run delegates to update

When `.validator/` already exists, the init command SHALL skip interactive phases and delegate to the update logic.

#### Scenario: Re-run skips prompts and calls update
- **GIVEN** a user runs `agent-validate init`
- **AND** the `.validator/` directory already exists
- **WHEN** Phase 1 completes CLI detection
- **THEN** Phases 2-4 SHALL be skipped
- **AND** init SHALL execute the same logic as `agent-validate update`

#### Scenario: Re-run with --yes flag
- **GIVEN** `.validator/` already exists
- **WHEN** `agent-validate init --yes` runs
- **THEN** Phases 2-4 SHALL be skipped
- **AND** update logic SHALL run with changed files overwritten without prompting

### Requirement: Init scaffolds model defaults for proxy adapters
The `init` command SHALL include a `model` field in the adapter configuration defaults for Cursor and GitHub Copilot adapters. These adapters proxy requests to upstream LLMs and benefit from an explicit model default. Adapters that are themselves LLM providers (Claude, Codex, Gemini) SHALL NOT have a `model` default.

#### Scenario: Cursor adapter default includes model
- **GIVEN** a user runs `agent-validate init`
- **AND** `cursor` is selected as a review CLI
- **WHEN** `.validator/config.yml` is generated
- **THEN** the `cli.adapters.cursor` section SHALL include `model: codex`

#### Scenario: GitHub Copilot adapter default includes model
- **GIVEN** a user runs `agent-validate init`
- **AND** `github-copilot` is selected as a review CLI
- **WHEN** `.validator/config.yml` is generated
- **THEN** the `cli.adapters.github-copilot` section SHALL include `model: codex`

#### Scenario: Claude adapter does not include model default
- **GIVEN** a user runs `agent-validate init`
- **AND** `claude` is selected as a review CLI
- **WHEN** `.validator/config.yml` is generated
- **THEN** the `cli.adapters.claude` section SHALL NOT include a `model` field

#### Scenario: Codex adapter does not include model default
- **GIVEN** a user runs `agent-validate init`
- **AND** `codex` is selected as a review CLI
- **WHEN** `.validator/config.yml` is generated
- **THEN** the `cli.adapters.codex` section SHALL NOT include a `model` field

#### Scenario: Gemini adapter does not include model default
- **GIVEN** a user runs `agent-validate init`
- **AND** `gemini` is selected as a review CLI
- **WHEN** `.validator/config.yml` is generated
- **THEN** the `cli.adapters.gemini` section SHALL NOT include a `model` field

### Requirement: Non-native CLIs are delegated to agent-plugin

CLIs that do not have local hook support SHALL still use the centralized agent-plugin installation path during init.

#### Scenario: Gemini selected uses agent-plugin
- **GIVEN** the user selects `gemini` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** init SHALL pass `--agent gemini` to agent-plugin
- **AND** init SHALL NOT copy skill files directly

#### Scenario: Cursor selected uses agent-plugin
- **GIVEN** the user selects `cursor` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** init SHALL pass `--agent cursor` to agent-plugin
- **AND** init SHALL NOT call the Cursor adapter's `installPlugin()` method directly

#### Scenario: Already-installed handling belongs to agent-plugin
- **GIVEN** the user selects a development CLI whose plugin may already be installed
- **WHEN** Phase 5 runs
- **THEN** init SHALL still include that agent in the agent-plugin invocation
- **AND** init SHALL NOT skip the agent based on adapter-specific plugin detection

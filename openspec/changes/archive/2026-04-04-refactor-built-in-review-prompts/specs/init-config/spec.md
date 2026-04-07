## MODIFIED Requirements

### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL write review entries inline in `config.yml` under the top-level `reviews` map for each built-in review the user selects. Each entry SHALL reference the built-in by name with `builtin: <name>` and `num_reviews: 1`. The `init` command SHALL NOT create `.validator/reviews/` directory files, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

#### Scenario: Default init writes all selected built-in reviews inline
- **WHEN** a user runs `agent-validate init`
- **AND** the user accepts the default selection of all three built-in reviews
- **THEN** `config.yml` SHALL contain a `reviews` map with entries for `code-quality`, `security`, and `error-handling`
- **AND** each entry SHALL have `builtin: <name>` and `num_reviews: 1`
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Init with subset of built-in reviews selected
- **WHEN** a user runs `agent-validate init`
- **AND** the user deselects `error-handling` from the built-in review prompt
- **THEN** `config.yml` SHALL contain a `reviews` map with entries for `code-quality` and `security` only
- **AND** no `error-handling` entry SHALL be present

#### Scenario: Init with --yes flag writes all built-in reviews inline
- **WHEN** a user runs `agent-validate init --yes`
- **THEN** `config.yml` SHALL contain a `reviews` map with entries for `code-quality`, `security`, and `error-handling`
- **AND** no separate review file SHALL be created

#### Scenario: Init re-run preserves existing inline reviews
- **WHEN** `config.yml` already contains a `reviews` map
- **AND** the user runs `agent-validate init`
- **THEN** the existing `reviews` map SHALL be preserved (not overwritten)

#### Scenario: Init re-run does not add new built-in reviews
- **GIVEN** `config.yml` contains only a `code-quality` review entry
- **AND** a newer version of agent-validator ships `security` and `error-handling` built-ins
- **WHEN** the user runs `agent-validate init`
- **THEN** the existing `reviews` map SHALL be preserved as-is
- **AND** `security` and `error-handling` SHALL NOT be added automatically

### Requirement: Init uses non-interactive config defaults
The `init` command SHALL present interactive prompts for development CLI selection, installation scope (local vs global), review CLI selection, `num_reviews` configuration, and built-in review selection. All other config values SHALL remain non-interactive with auto-detected defaults.

#### Scenario: Development CLI multi-select prompt
- **GIVEN** the user runs `agent-validate init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 2 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your development CLI(s). These are the main tools you work in."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Installation scope prompt
- **GIVEN** the user runs `agent-validate init`
- **WHEN** the user has selected development CLIs in Phase 2
- **THEN** the user SHALL be prompted to choose installation scope: local (project) or global (user)

#### Scenario: Development CLI with hook support
- **GIVEN** the user selects `claude` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** `claude` SHALL be marked for plugin installation (hooks are now part of the plugin)

#### Scenario: Development CLI without hook support
- **GIVEN** the user selects `codex` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** the output SHALL display a warning: "[CLI] doesn't support hooks yet, skipping hook installation"
- **AND** no hook installation SHALL be queued for that CLI

#### Scenario: Review CLI multi-select prompt
- **GIVEN** the user runs `agent-validate init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 3 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your reviewer CLI(s). These are the CLIs that will be used for AI code reviews."
- **AND** at least one CLI must be selected to proceed

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

#### Scenario: Built-in review selection prompt
- **GIVEN** the user runs `agent-validate init`
- **WHEN** Phase 3 completes (after review CLI and num_reviews selection)
- **THEN** the user SHALL be presented with a multi-select prompt listing all available built-in reviews: `code-quality`, `security`, `error-handling`
- **AND** all built-in reviews SHALL be pre-selected by default
- **AND** the user MAY deselect any reviews they do not want

#### Scenario: Zero built-in reviews selected requires confirmation
- **GIVEN** the user runs `agent-validate init`
- **AND** the user deselects all built-in reviews
- **WHEN** the selection is submitted
- **THEN** the user SHALL be prompted with a confirmation: "No reviews selected. Are you sure you want to continue without any built-in reviews?"
- **AND** if the user confirms, `config.yml` SHALL contain an empty `reviews` map
- **AND** if the user cancels, the built-in review selection prompt SHALL be shown again

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

#### Scenario: --yes defaults to local scope
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 2 runs
- **THEN** installation scope SHALL default to local (project) without prompting

#### Scenario: --yes selects all detected CLIs as review CLIs
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 3 runs
- **THEN** all detected CLIs SHALL be added to `cli.default_preference`
- **AND** `num_reviews` SHALL be set to the number of detected CLIs

#### Scenario: --yes selects all built-in reviews
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** Phase 3 runs
- **THEN** all built-in reviews (code-quality, security, error-handling) SHALL be selected without prompting

#### Scenario: --yes overwrites changed files without asking
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** a Codex skill file exists with a different checksum
- **WHEN** Phase 5 runs
- **THEN** the file SHALL be overwritten without prompting

### Requirement: Phase 4 scaffold skips when .validator/ exists
When `.validator/` already exists, Phase 4 SHALL skip entirely without modifying any files inside the directory.

#### Scenario: Fresh init creates .validator/ directory with selected reviews
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/` directory exists
- **AND** the user selects code-quality and security built-in reviews
- **WHEN** Phase 4 runs
- **THEN** `.validator/` SHALL be created with `config.yml` containing inline review entries for `code-quality` and `security`, and empty `entry_points`
- **AND** the project-root `.gitignore` SHALL be updated to include `validator_logs`
- **AND** `.validator/reviews/` and `.validator/checks/` SHALL NOT be created

#### Scenario: Re-run skips .validator/ scaffolding
- **GIVEN** the user runs `agent-validate init`
- **AND** `.validator/` directory already exists
- **WHEN** Phase 4 runs
- **THEN** no files inside `.validator/` SHALL be created or modified
- **AND** init SHALL delegate to update logic (not run Phase 5 directly)

# init-config Specification

## Purpose
Configuration generation during `agent-validate init`. Covers config file creation, review config setup, and post-init guidance.
## Requirements
### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL write a `code-quality` review entry inline in `config.yml` under the top-level `reviews` map, referencing the built-in code-quality prompt. The `init` command SHALL NOT create `.validator/reviews/code-quality.yml`, SHALL NOT create the `.validator/reviews/` directory, and SHALL NOT create the `.validator/checks/` directory.

#### Scenario: Default init writes code-quality review inline
- **WHEN** a user runs `agent-validate init`
- **THEN** `config.yml` SHALL contain a `reviews` map with `code-quality: {builtin: code-quality, num_reviews: 1}`
- **AND** `.validator/reviews/code-quality.yml` SHALL NOT be created
- **AND** `.validator/reviews/` SHALL NOT be created
- **AND** `.validator/checks/` SHALL NOT be created

#### Scenario: Init with --yes flag writes code-quality inline
- **WHEN** a user runs `agent-validate init --yes`
- **THEN** `config.yml` SHALL contain a `reviews` map with `code-quality: {builtin: code-quality, num_reviews: 1}`
- **AND** no separate review file SHALL be created

#### Scenario: Init re-run preserves existing inline reviews
- **WHEN** `config.yml` already contains a `reviews` map
- **AND** the user runs `agent-validate init`
- **THEN** the existing `reviews` map SHALL be preserved (not overwritten)

#### Scenario: Init re-run does not delete existing reviews or checks directories
- **WHEN** `.validator/reviews/` or `.validator/checks/` already exist
- **AND** the user runs `agent-validate init`
- **THEN** both directories SHALL be left as-is

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor, GitHub Copilot) SHALL receive `/validator-setup` slash-command instructions. Non-native CLI users SHALL receive `@file_path` reference instructions. Codex users SHALL receive Codex-native `.agents/skills/` path references.

#### Scenario: Claude Code user instructions
- **GIVEN** the user selected `claude` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: Cursor user instructions
- **GIVEN** the user selected `cursor` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: GitHub Copilot user instructions
- **GIVEN** the user selected `github-copilot` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/validator-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Validator will run."

#### Scenario: Codex user instructions
- **GIVEN** the user selected `codex` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL reference skills using `.agents/skills/` paths
- **AND** the output SHALL list all available skills with `.agents/skills/<skill-name>/SKILL.md` syntax

#### Scenario: Non-native non-codex CLI user instructions
- **GIVEN** the user selected a non-native, non-codex CLI (e.g., `gemini`) as a development CLI
- **AND** the user did NOT select `claude`, `cursor`, `github-copilot`, or `codex`
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include `@.claude/skills/` path references (existing behavior)

#### Scenario: Mixed CLI selection instructions
- **GIVEN** the user selected both `claude` and `codex` as development CLIs
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include BOTH the `/validator-setup` instructions AND the Codex `.agents/skills/` instructions
- **AND** the instructions SHALL be grouped by CLI type

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-validate init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)

### Requirement: Init config skeleton with empty entry_points

The `init` command SHALL generate a `config.yml` with an empty `entry_points` array and `cli.default_preference` populated from review CLI selection. Entry point configuration SHALL be delegated to the `/validator-setup` skill.

#### Scenario: Config generated with empty entry_points
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/config.yml` exists
- **WHEN** `.validator/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the config SHALL include `base_branch`, `log_dir`, and `cli` sections
- **AND** the config SHALL NOT include any check or review references in entry_points

#### Scenario: Init re-run preserves existing config
- **GIVEN** `.validator/config.yml` already exists
- **WHEN** the user runs `agent-validate init` (with or without `--yes`)
- **THEN** the existing `config.yml` SHALL be preserved entirely (not overwritten)

#### Scenario: Config with --yes flag
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** no `.validator/config.yml` exists
- **WHEN** `.validator/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the `cli.default_preference` SHALL include all detected CLIs

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL present interactive prompts for development CLI selection, installation scope (local vs global), review CLI selection, and `num_reviews` configuration. All other config values SHALL remain non-interactive with auto-detected defaults.

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
- **THEN** `num_reviews` SHALL be set to `1` in the default review config
- **AND** no prompt for `num_reviews` SHALL be shown

#### Scenario: Multiple review CLIs prompt for num_reviews
- **GIVEN** the user selects 3 review CLIs
- **WHEN** Phase 3 completes
- **THEN** the user SHALL be prompted: "How many of these CLIs would you like to run on every review?"
- **AND** the valid range SHALL be 1 to 3
- **AND** the selected value SHALL be written as `num_reviews` in the default review config

#### Scenario: Built-in reviewer announcement
- **GIVEN** the user runs `agent-validate init`
- **WHEN** Phase 3 completes
- **THEN** the output SHALL display: "Agent Validator's built-in code quality reviewer will be installed."

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

#### Scenario: --yes overwrites changed files without asking
- **GIVEN** the user runs `agent-validate init --yes`
- **AND** a Codex skill file exists with a different checksum
- **WHEN** Phase 5 runs
- **THEN** the file SHALL be overwritten without prompting

### Requirement: Phase 4 scaffold skips when .validator/ exists

When `.validator/` already exists, Phase 4 SHALL skip entirely without modifying any files inside the directory.

#### Scenario: Fresh init creates .validator/ directory
- **GIVEN** the user runs `agent-validate init`
- **AND** no `.validator/` directory exists
- **WHEN** Phase 4 runs
- **THEN** `.validator/` SHALL be created with full scaffolding (directory structure, config.yml, default review, .gitignore entry)

#### Scenario: Re-run skips .validator/ scaffolding
- **GIVEN** the user runs `agent-validate init`
- **AND** `.validator/` directory already exists
- **WHEN** Phase 4 runs
- **THEN** no files inside `.validator/` SHALL be created or modified
- **AND** init SHALL delegate to update logic (not run Phase 5 directly)

### Requirement: Init installs Claude plugin instead of copying skills

When Claude is a selected development CLI, init SHALL install the agent-validator Claude plugin instead of copying skill files to `.claude/skills/`.

#### Scenario: Claude selected installs plugin at local scope
- **GIVEN** the user selects `claude` as a development CLI
- **AND** the user selects local scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL run `claude plugin marketplace add Codagent-AI/agent-validator`
- **AND** init SHALL run `claude plugin install agent-validator --scope project`
- **AND** no skill files SHALL be copied to `.claude/skills/`

#### Scenario: Claude selected installs plugin at global scope
- **GIVEN** the user selects `claude` as a development CLI
- **AND** the user selects global scope
- **WHEN** Phase 5 runs
- **THEN** init SHALL run `claude plugin install agent-validator --scope user`
- **AND** no skill files SHALL be copied to `.claude/skills/`

### Requirement: Init installs Codex skills based on scope

When Codex is a selected development CLI, init SHALL install skills to the appropriate directory based on the selected scope.

#### Scenario: Codex selected with local scope
- **GIVEN** the user selects `codex` as a development CLI
- **AND** the user selects local scope
- **WHEN** Phase 5 runs
- **THEN** gauntlet skills SHALL be copied to `.agents/skills/<skill-name>/`

#### Scenario: Codex selected with global scope
- **GIVEN** the user selects `codex` as a development CLI
- **AND** the user selects global scope
- **WHEN** Phase 5 runs
- **THEN** gauntlet skills SHALL be copied to `$HOME/.agents/skills/<skill-name>/`

#### Scenario: Codex skill checksum matches skips update
- **GIVEN** a skill already exists at the target Codex skill location
- **WHEN** its checksum matches the source skill
- **THEN** the skill SHALL be skipped without prompting

#### Scenario: Codex skill checksum differs prompts for overwrite
- **GIVEN** a skill already exists at the target Codex skill location
- **WHEN** its checksum differs from the source skill
- **THEN** the user SHALL be prompted to overwrite (unless `--yes` is passed)

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

### Requirement: Non-Claude non-Codex CLIs keep current behavior

CLIs that are not Claude, Codex, Cursor, or GitHub Copilot SHALL continue using the existing skill-copy installation approach during init.

#### Scenario: Gemini selected copies skills to .claude/skills/
- **GIVEN** the user selects `gemini` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL be copied to `.claude/skills/` with `@file_path` references (existing behavior)

#### Scenario: Cursor selected copies skills only (no hooks)
- **GIVEN** the user selects `cursor` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL be installed using the existing Cursor adapter behavior
- **AND** no Cursor hook configuration SHALL be performed (Cursor hook support is deferred)

#### Scenario: GitHub Copilot is NOT in the file-copy bucket
- **GIVEN** the user selects `github-copilot` as a development CLI
- **WHEN** Phase 5 runs
- **THEN** skills SHALL NOT be copied to `.claude/skills/` or `.github/skills/` via file copy
- **AND** the plugin install mechanism SHALL be used instead


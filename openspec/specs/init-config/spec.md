# init-config Specification

## Purpose
Configuration generation during `agent-gauntlet init`. Covers config file creation, review config setup, and post-init guidance.
## Requirements
### Requirement: Init generates YAML review config with built-in reference
The `init` command SHALL generate a `.gauntlet/reviews/code-quality.yml` file that references the built-in code-quality review prompt.

#### Scenario: Default init creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 1`)

#### Scenario: Init with --yes flag creates YAML review config
- **GIVEN** a user runs `agent-gauntlet init --yes`
- **WHEN** the `.gauntlet/` directory is scaffolded
- **THEN** `.gauntlet/reviews/code-quality.yml` SHALL be created with content referencing `builtin: code-quality`
- **AND** the YAML file SHALL include default settings (`num_reviews: 1`)

#### Scenario: Init re-run preserves existing review config
- **GIVEN** `.gauntlet/reviews/code-quality.yml` already exists
- **WHEN** the user runs `agent-gauntlet init`
- **THEN** the existing review config SHALL be preserved (not overwritten)

### Requirement: Init outputs next-step message

After completing setup, `init` SHALL print context-aware instructions based on the selected development CLIs. Native CLI users (Claude Code, Cursor) SHALL receive `/gauntlet-setup` slash-command instructions. Non-native CLI users SHALL receive `@file_path` reference instructions. Codex users SHALL receive Codex-native `.agents/skills/` path references.

#### Scenario: Claude Code user instructions
- **GIVEN** the user selected `claude` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Cursor user instructions
- **GIVEN** the user selected `cursor` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include: "To complete setup, run `/gauntlet-setup` in your CLI. This will guide you through configuring the static checks (unit tests, linters, etc) that Agent Gauntlet will run."

#### Scenario: Codex user instructions
- **GIVEN** the user selected `codex` as a development CLI
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL reference skills using `.agents/skills/` paths
- **AND** the output SHALL list all available skills with `.agents/skills/<skill-name>/SKILL.md` syntax

#### Scenario: Non-native non-codex CLI user instructions
- **GIVEN** the user selected a non-native, non-codex CLI (e.g., `gemini`) as a development CLI
- **AND** the user did NOT select `claude`, `cursor`, or `codex`
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include `@.claude/skills/` path references (existing behavior)

#### Scenario: Mixed CLI selection instructions
- **GIVEN** the user selected both `claude` and `codex` as development CLIs
- **WHEN** the init command completes (Phase 6)
- **THEN** the output SHALL include BOTH the `/gauntlet-setup` instructions AND the Codex `.agents/skills/` instructions
- **AND** the instructions SHALL be grouped by CLI type

#### Scenario: --yes flag still shows instructions
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **WHEN** the init command completes (Phase 6)
- **THEN** the post-init instructions SHALL still be displayed (instructions are never skipped)

### Requirement: Init config skeleton with empty entry_points

The `init` command SHALL generate a `config.yml` with an empty `entry_points` array and `cli.default_preference` populated from review CLI selection. Entry point configuration SHALL be delegated to the `/gauntlet-setup` skill.

#### Scenario: Config generated with empty entry_points
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** no `.gauntlet/config.yml` exists
- **WHEN** `.gauntlet/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the config SHALL include `base_branch`, `log_dir`, and `cli` sections
- **AND** the config SHALL NOT include any check or review references in entry_points

#### Scenario: Init re-run preserves existing config
- **GIVEN** `.gauntlet/config.yml` already exists
- **WHEN** the user runs `agent-gauntlet init` (with or without `--yes`)
- **THEN** the existing `config.yml` SHALL be preserved entirely (not overwritten)

#### Scenario: Config with --yes flag
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** no `.gauntlet/config.yml` exists
- **WHEN** `.gauntlet/config.yml` is created
- **THEN** the config SHALL include `entry_points: []`
- **AND** the `cli.default_preference` SHALL include all detected CLIs

### Requirement: Init uses non-interactive config defaults

The `init` command SHALL present interactive prompts for development CLI selection, review CLI selection, and `num_reviews` configuration. All other config values (base branch, log directory, lint/test commands) SHALL remain non-interactive with auto-detected defaults.

#### Scenario: Development CLI multi-select prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected as available
- **WHEN** Phase 2 begins
- **THEN** the user SHALL be presented with a multi-select prompt listing all detected CLIs
- **AND** the prompt SHALL include the explanation: "Select your development CLI(s). These are the main tools you work in."
- **AND** at least one CLI must be selected to proceed

#### Scenario: Development CLI with hook support
- **GIVEN** the user selects `claude` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** `claude` SHALL be marked for hook installation in Phase 5

#### Scenario: Development CLI without hook support
- **GIVEN** the user selects `codex` as a development CLI
- **WHEN** Phase 2 completes
- **THEN** the output SHALL display a warning: "[CLI] doesn't support hooks yet, skipping hook installation"
- **AND** no hook installation SHALL be queued for that CLI

#### Scenario: Review CLI multi-select prompt
- **GIVEN** the user runs `agent-gauntlet init`
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
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** Phase 3 completes
- **THEN** the output SHALL display: "Agent Gauntlet's built-in code quality reviewer will be installed."

#### Scenario: No base branch prompt
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** base branch SHALL be auto-detected from the git remote (falling back to `origin/main` if detection fails)
- **AND** no prompt for base branch SHALL be shown

#### Scenario: No lint or test command prompts
- **GIVEN** the user runs `agent-gauntlet init`
- **WHEN** the init command runs
- **THEN** no prompts for lint or test commands SHALL be shown
- **AND** no check YAML files SHALL be created by init

### Requirement: --yes flag skips all interactive prompts with defaults

When `--yes` is passed, `init` SHALL skip all interactive prompts and apply default selections.

#### Scenario: --yes selects all detected CLIs as development CLIs
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 2 runs
- **THEN** all detected CLIs SHALL be selected as development CLIs without prompting

#### Scenario: --yes selects all detected CLIs as review CLIs
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** CLIs `claude`, `codex`, and `gemini` are detected
- **WHEN** Phase 3 runs
- **THEN** all detected CLIs SHALL be added to `cli.default_preference`
- **AND** `num_reviews` SHALL be set to the number of detected CLIs

#### Scenario: --yes overwrites changed files without asking
- **GIVEN** the user runs `agent-gauntlet init --yes`
- **AND** a skill file exists with a different checksum
- **WHEN** Phase 5 runs
- **THEN** the file SHALL be overwritten without prompting

### Requirement: Phase 4 scaffold skips when .gauntlet/ exists

When `.gauntlet/` already exists, Phase 4 SHALL skip entirely without modifying any files inside the directory.

#### Scenario: Fresh init creates .gauntlet/ directory
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** no `.gauntlet/` directory exists
- **WHEN** Phase 4 runs
- **THEN** `.gauntlet/` SHALL be created with full scaffolding (directory structure, config.yml, default review, .gitignore entry)

#### Scenario: Re-run skips .gauntlet/ scaffolding
- **GIVEN** the user runs `agent-gauntlet init`
- **AND** `.gauntlet/` directory already exists
- **WHEN** Phase 4 runs
- **THEN** no files inside `.gauntlet/` SHALL be created or modified
- **AND** Phase 5 SHALL still run for external files (skills, hooks)

### Requirement: Init installs skills to Codex skill directory

When codex is selected as a development CLI, `init` SHALL install gauntlet skills to `.agents/skills/` in addition to `.claude/skills/`. The same source skills, checksum logic, and overwrite prompts SHALL apply to both directories.

#### Scenario: Codex selected as dev CLI installs skills to .agents/skills/
- **WHEN** the user selects `codex` as a development CLI
- **AND** init reaches the skill installation phase
- **THEN** all gauntlet skills SHALL be copied to `.agents/skills/<skill-name>/`
- **AND** each skill directory SHALL contain the same files as the `.claude/skills/` copy

#### Scenario: Codex not selected skips .agents/skills/ installation
- **WHEN** the user does not select `codex` as a development CLI
- **THEN** no `.agents/skills/` directory SHALL be created

#### Scenario: Codex skill checksum matches skips update
- **WHEN** a skill already exists in `.agents/skills/<skill-name>/`
- **AND** its checksum matches the source skill
- **THEN** the skill SHALL be skipped without prompting

#### Scenario: Codex skill checksum differs prompts for overwrite
- **WHEN** a skill already exists in `.agents/skills/<skill-name>/`
- **AND** its checksum differs from the source skill
- **THEN** the user SHALL be prompted to overwrite (unless `--yes` is passed)

#### Scenario: --yes flag overwrites changed Codex skills without asking
- **WHEN** the user runs `agent-gauntlet init --yes`
- **AND** a Codex skill exists with a different checksum
- **THEN** the skill SHALL be overwritten without prompting

### Requirement: CodexAdapter reports project skill directory

`CodexAdapter.getProjectSkillDir()` SHALL return `.agents/skills` so the adapter system correctly reflects Codex's native skill location.

#### Scenario: CodexAdapter returns .agents/skills for project skill dir
- **WHEN** `getProjectSkillDir()` is called on a `CodexAdapter` instance
- **THEN** it SHALL return `.agents/skills`

### Requirement: Skill overwrite prompt supports update-all option

The skill overwrite prompt SHALL offer an "update all" option that accepts all remaining skill updates without further prompting. This applies across all skill directories in a single init run.

#### Scenario: User selects update-all on first changed skill
- **WHEN** multiple skills have changed checksums
- **AND** the user selects "update all" on the first overwrite prompt
- **THEN** all remaining changed skills SHALL be overwritten without further prompts

#### Scenario: User answers individually then selects update-all
- **WHEN** the user answers "yes" or "no" to individual skill prompts
- **AND** then selects "update all" on a subsequent prompt
- **THEN** all remaining changed skills after that point SHALL be overwritten without further prompts

#### Scenario: Update-all carries across skill directories
- **WHEN** the user selects "update all" during `.claude/skills/` installation
- **AND** codex is selected with `.agents/skills/` installation pending
- **THEN** the update-all state SHALL carry forward to the `.agents/skills/` directory
- **AND** no further overwrite prompts SHALL be shown

